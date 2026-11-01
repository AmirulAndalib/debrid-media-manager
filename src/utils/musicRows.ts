import type { MusicTrack } from '@/pages/api/music/library';
import { albumTracks } from '@/services/musicCatalog';
import { getBlocklist, isHashBlockedIn } from '@/services/takedown/blocklist';
import type { MusicTrackRef } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';

export interface MusicAlbumSummary {
	/** null when no release of the album is left in the catalog. */
	hash: string | null;
	mbid: string;
	artistMbid: string | null;
	artist: string;
	album: string;
	year: number | null;
	coverUrl: string | null;
	trackCount: number;
}

export interface MusicTrackRow {
	/** null when the file is gone or its torrent is blocked: show it as unavailable. */
	track: MusicTrack | null;
	album: MusicAlbumSummary | null;
}

export interface MusicPlaylistSummary {
	id: string;
	name: string;
	description: string | null;
	trackCount: number;
	coverUrl: string | null;
	updatedAt: string;
}

type Release = { hash: string; mbid: string; filename: string; _count: { files: number } };
type Meta = {
	mbid: string;
	artistMbid: string | null;
	artist: string;
	album: string;
	year: number | null;
	coverUrl: string | null;
};

const releaseSelect = {
	hash: true,
	mbid: true,
	filename: true,
	_count: { select: { files: true } },
};
const metaSelect = {
	mbid: true,
	artistMbid: true,
	artist: true,
	album: true,
	year: true,
	coverUrl: true,
};

function summarize(
	mbid: string,
	release: Release | undefined,
	meta: Meta | undefined
): MusicAlbumSummary | null {
	if (!release && !meta) return null;
	return {
		hash: release?.hash ?? null,
		mbid,
		artistMbid: meta?.artistMbid ?? null,
		artist: meta?.artist ?? 'Unknown Artist',
		album: meta?.album ?? release?.filename ?? '',
		year: meta?.year ?? null,
		coverUrl: meta?.coverUrl ?? null,
		trackCount: release?._count.files ?? 0,
	};
}

/**
 * Resolves stored track refs to playable rows, in input order, with one query
 * per table. Each track is numbered, titled and timed as its album page has it.
 */
export async function resolveMusicRows(refs: MusicTrackRef[]): Promise<MusicTrackRow[]> {
	if (refs.length === 0) return [];
	const blocklist = await getBlocklist();
	const hashes = [...new Set(refs.map((ref) => ref.hash))].filter(
		(hash) => !isHashBlockedIn(blocklist, hash)
	);
	// Every file of each album: the tracklist is matched against the whole album.
	const [files, releases] =
		hashes.length === 0
			? [[], []]
			: await Promise.all([
					prisma.availableMusicFile.findMany({ where: { hash: { in: hashes } } }),
					prisma.availableMusic.findMany({
						where: { hash: { in: hashes } },
						select: releaseSelect,
					}),
				]);
	const releaseByHash = new Map(releases.map((r) => [r.hash.toLowerCase(), r]));
	const mbidOf = (ref: MusicTrackRef) =>
		releaseByHash.get(ref.hash.toLowerCase())?.mbid ?? ref.mbid;
	const mbids = [...new Set([...refs.map(mbidOf), ...releases.map((r) => r.mbid)])];
	const [metas, tracklists] = await Promise.all([
		prisma.musicMetadata.findMany({ where: { mbid: { in: mbids } }, select: metaSelect }),
		files.length === 0
			? []
			: prisma.musicTrackMetadata.findMany({ where: { mbid: { in: mbids } } }),
	]);
	const metaByMbid = new Map(metas.map((m) => [m.mbid, m]));

	const tracksByHash = new Map<string, MusicTrack[]>();
	const tracksOf = (hash: string, mbid: string) => {
		const key = hash.toLowerCase();
		if (!tracksByHash.has(key)) {
			tracksByHash.set(
				key,
				albumTracks(
					files.filter((file) => file.hash.toLowerCase() === key),
					tracklists.filter((track) => track.mbid === mbid)
				)
			);
		}
		return tracksByHash.get(key)!;
	};

	return refs.map((ref) => {
		const release = releaseByHash.get(ref.hash.toLowerCase());
		const mbid = mbidOf(ref);
		return {
			track: tracksOf(ref.hash, mbid).find((track) => track.fileId === ref.fileId) ?? null,
			album: summarize(mbid, release, metaByMbid.get(mbid)),
		};
	});
}

/** Each album's summary from its release with the most files, or from metadata alone. */
export async function resolveAlbumSummaries(
	mbids: string[]
): Promise<Map<string, MusicAlbumSummary>> {
	if (mbids.length === 0) return new Map();
	const [blocklist, releases, metas] = await Promise.all([
		getBlocklist(),
		prisma.availableMusic.findMany({ where: { mbid: { in: mbids } }, select: releaseSelect }),
		prisma.musicMetadata.findMany({ where: { mbid: { in: mbids } }, select: metaSelect }),
	]);
	const best = new Map<string, Release>();
	for (const release of releases) {
		if (isHashBlockedIn(blocklist, release.hash)) continue;
		if (release._count.files > (best.get(release.mbid)?._count.files ?? 0)) {
			best.set(release.mbid, release);
		}
	}
	const metaByMbid = new Map(metas.map((m) => [m.mbid, m]));
	const summaries = new Map<string, MusicAlbumSummary>();
	for (const mbid of mbids) {
		const summary = summarize(mbid, best.get(mbid), metaByMbid.get(mbid));
		if (summary) summaries.set(mbid, summary);
	}
	return summaries;
}

/** Track count and cover (first track's album art) for each playlist row. */
export async function playlistSummaries(
	playlists: { id: string; name: string; description: string | null; updatedAt: Date }[]
): Promise<MusicPlaylistSummary[]> {
	if (playlists.length === 0) return [];
	const groups = await prisma.musicPlaylistTrack.groupBy({
		by: ['playlistId'],
		where: { playlistId: { in: playlists.map((p) => p.id) } },
		_count: { _all: true },
		_min: { position: true },
	});
	const firsts =
		groups.length === 0
			? []
			: await prisma.musicPlaylistTrack.findMany({
					where: {
						OR: groups.map((g) => ({
							playlistId: g.playlistId,
							position: g._min.position ?? 0,
						})),
					},
					select: { playlistId: true, mbid: true },
				});
	const covers =
		firsts.length === 0
			? []
			: await prisma.musicMetadata.findMany({
					where: { mbid: { in: [...new Set(firsts.map((f) => f.mbid))] } },
					select: { mbid: true, coverUrl: true },
				});
	const countById = new Map(groups.map((g) => [g.playlistId, g._count._all]));
	const coverByMbid = new Map(covers.map((c) => [c.mbid, c.coverUrl]));
	const coverById = new Map(firsts.map((f) => [f.playlistId, coverByMbid.get(f.mbid) ?? null]));
	return playlists.map((p) => ({
		id: p.id,
		name: p.name,
		description: p.description,
		trackCount: countById.get(p.id) ?? 0,
		coverUrl: coverById.get(p.id) ?? null,
		updatedAt: p.updatedAt.toISOString(),
	}));
}
