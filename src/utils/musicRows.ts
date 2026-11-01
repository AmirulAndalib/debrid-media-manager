import type { MusicTrack } from '@/pages/api/music/library';
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
const fileKey = (hash: string, fileId: number) => `${hash.toLowerCase()}-${fileId}`;

// Same patterns as library.ts's extractTrackNumber, which it does not export.
function extractTrackNumber(filename: string): number | null {
	const match =
		filename.match(/^(\d{1,3})\s*[-_.]\s*/) ??
		filename.match(/^track\s*(\d{1,3})/i) ??
		filename.match(/^\[(\d{1,3})\]/) ??
		filename.match(/^(\d{1,3})\)/);
	return match ? parseInt(match[1], 10) : null;
}

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

/** Resolves stored track refs to playable rows, in input order, with one query per table. */
export async function resolveMusicRows(refs: MusicTrackRef[]): Promise<MusicTrackRow[]> {
	if (refs.length === 0) return [];
	const blocklist = await getBlocklist();
	const hashes = [...new Set(refs.map((ref) => ref.hash))].filter(
		(hash) => !isHashBlockedIn(blocklist, hash)
	);
	const fileIds = [...new Set(refs.map((ref) => ref.fileId))];
	const [files, releases] =
		hashes.length === 0
			? [[], []]
			: await Promise.all([
					prisma.availableMusicFile.findMany({
						where: { hash: { in: hashes }, file_id: { in: fileIds } },
					}),
					prisma.availableMusic.findMany({
						where: { hash: { in: hashes } },
						select: releaseSelect,
					}),
				]);
	const mbids = [...new Set([...refs.map((ref) => ref.mbid), ...releases.map((r) => r.mbid)])];
	const metas = await prisma.musicMetadata.findMany({
		where: { mbid: { in: mbids } },
		select: metaSelect,
	});

	const fileByKey = new Map<string, (typeof files)[number]>();
	for (const file of files) {
		const key = fileKey(file.hash, file.file_id);
		if (!fileByKey.has(key)) fileByKey.set(key, file);
	}
	const releaseByHash = new Map(releases.map((r) => [r.hash.toLowerCase(), r]));
	const metaByMbid = new Map(metas.map((m) => [m.mbid, m]));

	return refs.map((ref) => {
		const file = fileByKey.get(fileKey(ref.hash, ref.fileId));
		const release = releaseByHash.get(ref.hash.toLowerCase());
		const mbid = release?.mbid ?? ref.mbid;
		const filename = file ? file.path.split('/').pop() || file.path : '';
		return {
			track: file
				? {
						id: `${file.hash}-${file.file_id}`,
						hash: file.hash,
						fileId: file.file_id,
						link: file.link,
						path: file.path,
						bytes: Number(file.bytes),
						trackNumber: file.trackNumber ?? extractTrackNumber(filename),
						filename,
					}
				: null,
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
