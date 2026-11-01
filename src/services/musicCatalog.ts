import { ImdbSearchService } from '@/services/database/imdbSearch';
import { getBlocklist } from '@/services/takedown/blocklist';
import {
	extractTrackNumber,
	formatTrackTitle,
	getDirectory,
	getFilename,
	isAudioPath,
	matchTrackMetadata,
} from '@/utils/musicTracks';
import { prisma } from '@/utils/prisma';
import { Prisma } from '@prisma/client';

export interface MusicTrack {
	id: string;
	hash: string;
	fileId: number;
	link: string;
	path: string;
	bytes: number;
	trackNumber: number | null;
	filename: string;
	// Optional in the type only so older callers that build tracks by hand still
	// compile; the API always sets them.
	/** The MusicBrainz title when the file was matched to its tracklist, else the filename's. */
	title?: string;
	durationMs?: number | null;
}

export interface MusicAlbum {
	hash: string;
	mbid: string;
	artist: string;
	album: string;
	/** The year of MusicBrainz's first release date when known, else the stored year. */
	year: number | null;
	coverUrl: string | null;
	tracks: MusicTrack[];
	totalBytes: number;
	trackCount: number;
	/** Album, Single, EP, Compilation, Other… as MusicBrainz has it, null until enriched. */
	primaryType?: string | null;
	genres?: string[];
	/** Tracks on the MusicBrainz release, null until enriched. */
	mbTrackCount?: number | null;
	/** At least twice as many audio files as the release has tracks: a box set or discography. */
	pack?: boolean;
}

export type MusicSortOption = 'recent' | 'name' | 'artist' | 'year';
export type MusicAlbumType = 'album' | 'ep' | 'single' | 'compilation';

export const MUSIC_ALBUM_TYPES: Record<MusicAlbumType, string> = {
	album: 'Album',
	ep: 'EP',
	single: 'Single',
	compilation: 'Compilation',
};

// Leading punctuation and an article do not decide where a name sorts:
// "¡Tré!" files under T, "...And Justice for All" under A, "The Wall" under W.
// A literal, not a bound value: MySQL compiles a pattern it cannot see at
// prepare time once per row, which took a name sort of 5,800 albums from 15 ms
// to 3 s on MySQL 8.0.36 (measured 2026-11-01).
const SORT_KEY_PATTERN = Prisma.raw(`'(?i)^[^[:alnum:]]*((the|an?)[[:space:]]+)?'`);
const sortKey = (column: Prisma.Sql) =>
	Prisma.sql`REGEXP_REPLACE(${column}, ${SORT_KEY_PATTERN}, '')`;
const ALBUM_KEY = sortKey(Prisma.sql`COALESCE(md.album, b.filename)`);
const ARTIST_KEY = sortKey(Prisma.sql`COALESCE(md.artist, 'Unknown Artist')`);
const YEAR = Prisma.sql`COALESCE(CAST(LEFT(md.firstReleaseDate, 4) AS UNSIGNED), md.year)`;

export const MUSIC_SORTS: Record<MusicSortOption, Prisma.Sql> = {
	recent: Prisma.sql`b.latest DESC, b.mbid`,
	name: Prisma.sql`${ALBUM_KEY}, ${ARTIST_KEY}, b.mbid`,
	artist: Prisma.sql`${ARTIST_KEY}, ${ALBUM_KEY}, b.mbid`,
	year: Prisma.sql`${YEAR} IS NULL, ${YEAR} DESC, ${ALBUM_KEY}, b.mbid`,
};

const like = (query: string) => `%${query.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * The fulltext keyword for a query, or null when it has no word the index
 * holds (under three characters, or only stopwords), which LIKE has to scan.
 */
function fulltextKeyword(query: string): string | null {
	return /[\p{L}\p{N}]{3}/u.test(query) ? ImdbSearchService.fulltextKeyword(query) : null;
}

/** Matches `md` (MusicMetadata) on artist or album. */
export function albumSearchSql(query: string): Prisma.Sql {
	const keyword = fulltextKeyword(query);
	return keyword
		? Prisma.sql`MATCH(md.artist, md.album) AGAINST (${keyword} IN BOOLEAN MODE)`
		: Prisma.sql`(md.artist LIKE ${like(query)} OR md.album LIKE ${like(query)})`;
}

/** Matches `t` (MusicTrackMetadata) on title. */
export function trackSearchSql(query: string): Prisma.Sql {
	const keyword = fulltextKeyword(query);
	return keyword
		? Prisma.sql`MATCH(t.title) AGAINST (${keyword} IN BOOLEAN MODE)`
		: Prisma.sql`t.title LIKE ${like(query)}`;
}

/**
 * `best`: one row per release group in the catalog, the unblocked torrent with
 * the most files (`rn` = 1), with its file count and when the group last got a
 * torrent. Only `hash` when given.
 */
async function bestCte(hash?: string): Promise<Prisma.Sql> {
	const blocked = [...(await getBlocklist()).hashes];
	return Prisma.sql`WITH best AS (
		SELECT m.hash, m.mbid, m.filename, m.bytes, f.fileCount,
			MAX(m.ended) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS latest,
			ROW_NUMBER() OVER w AS rn
		FROM AvailableMusic m
		JOIN (
			SELECT hash, COUNT(*) AS fileCount FROM AvailableMusicFile
			${hash ? Prisma.sql`WHERE hash = ${hash}` : Prisma.empty}
			GROUP BY hash
		) f ON f.hash = m.hash
		WHERE ${blocked.length ? Prisma.sql`m.hash NOT IN (${Prisma.join(blocked)})` : Prisma.sql`TRUE`}
		WINDOW w AS (PARTITION BY m.mbid ORDER BY f.fileCount DESC, m.hash)
	)`;
}

const where = (filters: Prisma.Sql[]) => Prisma.join([Prisma.sql`b.rn = 1`, ...filters], ' AND ');

type AlbumRow = {
	hash: string;
	mbid: string;
	filename: string;
	bytes: bigint;
	fileCount: bigint;
	artist: string | null;
	album: string | null;
	year: bigint | number | null;
	coverUrl: string | null;
	primaryType: string | null;
	genres: unknown;
	mbTrackCount: number | null;
	totalAlbums: bigint;
	totalTracks: bigint | null;
};

const isPack = (audioFiles: number, mbTrackCount: number | null | undefined) =>
	!!mbTrackCount && audioFiles >= 2 * mbTrackCount;

/**
 * Album summaries (no tracks; `trackCount` is every file), paged and ordered in
 * SQL, with the totals of every album the filters match. A page past the end
 * has no row to carry them, so its totals read 0.
 */
export async function queryAlbums({
	filters = [],
	order,
	limit,
	offset = 0,
	hash,
}: {
	filters?: Prisma.Sql[];
	order: Prisma.Sql;
	limit: number;
	offset?: number;
	hash?: string;
}): Promise<{ albums: MusicAlbum[]; totalAlbums: number; totalTracks: number }> {
	const rows = await prisma.$queryRaw<AlbumRow[]>(Prisma.sql`${await bestCte(hash)}
		SELECT b.hash, b.mbid, b.filename, b.bytes, b.fileCount, md.artist, md.album,
			${YEAR} AS year, md.coverUrl, md.primaryType, md.genres, md.mbTrackCount,
			COUNT(*) OVER () AS totalAlbums, SUM(b.fileCount) OVER () AS totalTracks
		FROM best b
		LEFT JOIN MusicMetadata md ON md.mbid = b.mbid
		WHERE ${where(filters)}
		ORDER BY ${order}
		LIMIT ${limit} OFFSET ${offset}`);
	const albums = rows.map((row) => ({
		hash: row.hash,
		mbid: row.mbid,
		artist: row.artist ?? 'Unknown Artist',
		album: row.album ?? row.filename,
		year: row.year === null ? null : Number(row.year),
		coverUrl: row.coverUrl,
		tracks: [],
		totalBytes: Number(row.bytes),
		trackCount: Number(row.fileCount),
		primaryType: row.primaryType,
		genres: Array.isArray(row.genres) ? row.genres : [],
		mbTrackCount: row.mbTrackCount,
		pack: false,
	}));
	return {
		albums,
		totalAlbums: Number(rows[0]?.totalAlbums ?? 0),
		totalTracks: Number(rows[0]?.totalTracks ?? 0),
	};
}

/** The totals alone, for a page past the end. */
export async function countAlbums(
	filters: Prisma.Sql[] = []
): Promise<{ totalAlbums: number; totalTracks: number }> {
	const [row] = await prisma.$queryRaw<{ totalAlbums: bigint; totalTracks: bigint | null }[]>(
		Prisma.sql`${await bestCte()}
		SELECT COUNT(DISTINCT b.mbid) AS totalAlbums, SUM(b.fileCount) AS totalTracks
		FROM best b
		LEFT JOIN MusicMetadata md ON md.mbid = b.mbid
		WHERE ${where(filters)}`
	);
	return {
		totalAlbums: Number(row?.totalAlbums ?? 0),
		totalTracks: Number(row?.totalTracks ?? 0),
	};
}

export type MusicArtistHit = {
	mbid: string;
	name: string;
	albumCount: number;
	coverUrl: string | null;
};

/**
 * The artists of the albums `search` (an `albumSearchSql`) matches, each with
 * every album of theirs in the catalog counted, best match first.
 */
export async function searchArtists(search: Prisma.Sql, limit: number): Promise<MusicArtistHit[]> {
	// The matching artists first, so MATCH runs once against the index rather
	// than per row of a semijoin (1.6 s against 0.2 s on 5,800 albums).
	const rows = await prisma.$queryRaw<
		{ mbid: string; name: string; albumCount: bigint; coverUrl: string | null }[]
	>(Prisma.sql`${await bestCte()}, hits AS (
			SELECT md.artistMbid, MAX(${search}) AS relevance
			FROM MusicMetadata md
			WHERE ${search} AND md.artistMbid IS NOT NULL
			GROUP BY md.artistMbid
		)
		SELECT h.artistMbid AS mbid, COALESCE(ma.name, MAX(md.artist)) AS name,
			COUNT(*) AS albumCount, MAX(md.coverUrl) AS coverUrl
		FROM hits h
		JOIN MusicMetadata md ON md.artistMbid = h.artistMbid
		JOIN best b ON b.mbid = md.mbid AND b.rn = 1
		LEFT JOIN MusicArtist ma ON ma.mbid = h.artistMbid
		GROUP BY h.artistMbid, h.relevance, ma.name
		ORDER BY h.relevance DESC, albumCount DESC, h.artistMbid
		LIMIT ${limit}`);
	return rows.map((row) => ({
		mbid: row.mbid,
		name: row.name,
		albumCount: Number(row.albumCount),
		coverUrl: row.coverUrl,
	}));
}

/**
 * Flags packs among summaries. Every file stands in for an audio file until a
 * summary looks like a pack; only those have their sidecars (scans, logs) left
 * out of the count before they are called one.
 */
export async function withPackFlags(albums: MusicAlbum[]): Promise<MusicAlbum[]> {
	const suspects = albums.filter((album) => isPack(album.trackCount, album.mbTrackCount));
	if (!suspects.length) return albums;
	const files = await prisma.availableMusicFile.findMany({
		where: { hash: { in: suspects.map((album) => album.hash) } },
		select: { hash: true, path: true, file_id: true },
	});
	return albums.map((album) => {
		if (!suspects.includes(album)) return album;
		const audio = new Set(
			files
				.filter((file) => file.hash === album.hash && isAudioPath(file.path))
				.map((file) => file.file_id)
		);
		return { ...album, pack: isPack(audio.size, album.mbTrackCount) };
	});
}

/**
 * The albums with their audio tracks in album order (disc folder, then track
 * number, then name), titled and timed from MusicBrainz where a file matches
 * the stored tracklist. Albums without an audio file are dropped.
 */
export async function withTracks(albums: MusicAlbum[]): Promise<MusicAlbum[]> {
	if (!albums.length) return albums;
	const [files, tracklists] = await Promise.all([
		prisma.availableMusicFile.findMany({
			where: { hash: { in: albums.map((album) => album.hash) } },
		}),
		prisma.musicTrackMetadata.findMany({
			where: { mbid: { in: albums.map((album) => album.mbid) } },
		}),
	]);

	return albums
		.map((album) => {
			const audio = files
				.filter((file) => file.hash === album.hash && isAudioPath(file.path))
				.filter((file, i, all) => all.findIndex((x) => x.file_id === file.file_id) === i)
				.map((file) => ({
					file,
					filename: getFilename(file.path),
					number: file.trackNumber ?? extractTrackNumber(getFilename(file.path)),
				}))
				.sort(
					(a, b) =>
						getDirectory(a.file.path).localeCompare(
							getDirectory(b.file.path),
							undefined,
							{
								numeric: true,
							}
						) ||
						(a.number ?? 999) - (b.number ?? 999) ||
						a.filename.localeCompare(b.filename)
				);
			const tracks: MusicTrack[] = audio.map(({ file, filename, number }, index) => ({
				id: `${album.hash}-${file.file_id}`,
				hash: album.hash,
				fileId: file.file_id,
				link: file.link,
				path: file.path,
				bytes: Number(file.bytes),
				trackNumber: number ?? index + 1,
				filename,
			}));
			const matches = matchTrackMetadata(
				tracks,
				tracklists.filter((track) => track.mbid === album.mbid)
			);
			tracks.forEach((track, i) => {
				track.title = matches[i]?.title ?? formatTrackTitle(track.filename);
				track.durationMs = matches[i]?.lengthMs ?? null;
			});
			return {
				...album,
				tracks,
				trackCount: tracks.length,
				pack: isPack(tracks.length, album.mbTrackCount),
			};
		})
		.filter((album) => album.trackCount > 0);
}
