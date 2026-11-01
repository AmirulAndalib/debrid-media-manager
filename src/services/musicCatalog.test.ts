import {
	enrichment,
	fromLidarr,
	LidarrAlbum,
	pickRelease,
	titlePool,
} from '@/services/musicBrainz';
import lz2Album from '@/test/fixtures/lidarr/album-33b4653d-006e-3cc1-8afb-386b15a6cd6e.json';
import monkeesAlbum from '@/test/fixtures/lidarr/album-48e8b712-4f5d-34e0-9492-22f936854662.json';
import chopin from '@/test/fixtures/music/library-0380fe617494cfc4a0b969639ad8a277ab366478.json';
import lz2 from '@/test/fixtures/music/library-700d948d78ff200d34d643d4474365ea0b698fd7.json';
import monkees from '@/test/fixtures/music/library-dc925f67cd67936b4a8fbeb17d6decb648fd3479.json';
import { discTrackCounts, getFilename } from '@/utils/musicTracks';
import { describe, expect, it, vi } from 'vitest';
import { albumTracks, titleCensusReason } from './musicCatalog';

vi.mock('@/utils/prisma', () => ({ prisma: {} }));

type Library = {
	hash: string;
	mbid: string;
	files: { file_id: number; path: string; bytes: number; trackNumber: number | null }[];
};

/** A torrent's real files as the album page serves them against `album`'s stored rows. */
function served(library: Library, album?: LidarrAlbum, releaseId?: string) {
	const files = library.files.map((file) => ({
		...file,
		hash: library.hash,
		link: `https://example.com/${file.file_id}`,
		bytes: BigInt(file.bytes),
	}));
	if (!album) return { tracks: albumTracks(files, []), mbTrackCount: null };
	// As the backfill stores it: the picked release, and every other title on disc 0.
	const { group, releases } = fromLidarr(album);
	const paths = library.files.map((file) => file.path);
	const id =
		releaseId ??
		pickRelease(group, discTrackCounts(paths), paths.map(getFilename), releases)!.id;
	const { metadata, tracks } = enrichment(
		library.mbid,
		group,
		releases.find((r) => r.id === id)!
	);
	const rows = [...tracks, ...titlePool(library.mbid, group, releases, tracks)];
	return {
		tracks: albumTracks(files, rows as Parameters<typeof albumTracks>[1]),
		mbTrackCount: metadata.mbTrackCount,
	};
}

const enriched = { enrichedAt: new Date('2026-11-01'), mbReleaseId: 'a-release' };

describe('titleCensusReason', () => {
	it("counts a deluxe edition titled from its own release's layout as titled", () => {
		// Led Zeppelin II's 9 + 8 files under the 2014 deluxe edition: every file its own name.
		const deluxe = served(lz2, lz2Album as unknown as LidarrAlbum);
		expect(titleCensusReason(deluxe, enriched)).toBe('titled');
		expect(deluxe.tracks.at(-1)?.title).toBe('La La (intro/outro rough mix)');
		// Under the 9-track 1969 album, as the old backfill chose (census 2026-11-01):
		// disc 2's rough mixes borrow the album's titles and "La La" has none.
		const album = served(
			lz2,
			lz2Album as unknown as LidarrAlbum,
			'dd235704-a182-415c-bb8e-9033bffe2817'
		);
		expect(album.tracks[9].title).toBe('Whole Lotta Love');
		expect(album.tracks.at(-1)?.title).toBeNull();
		expect(titleCensusReason(album, enriched)).toBe('files > tracks');
	});

	it('says why an album keeps untitled tracks', () => {
		const monkeesNow = served(monkees, monkeesAlbum as unknown as LidarrAlbum);
		// 61 files, 47 titled, of the 100-track super deluxe edition.
		expect(monkeesNow.tracks.filter((track) => track.title)).toHaveLength(47);
		expect(titleCensusReason(monkeesNow, enriched)).toBe('files < tracks');
		const monkeesBefore = served(
			monkees,
			monkeesAlbum as unknown as LidarrAlbum,
			'0c6324c1-5968-4675-84bc-8f20b44cabc4'
		);
		expect(titleCensusReason(monkeesBefore, enriched)).toBe('files > tracks');

		// Les Nocturnes: its group deleted, no source names its files.
		const nocturnes = served(chopin);
		expect(titleCensusReason(nocturnes, undefined)).toBe('not enriched');
		expect(titleCensusReason(nocturnes, { enrichedAt: null, mbReleaseId: null })).toBe(
			'not enriched'
		);
		expect(
			titleCensusReason(nocturnes, { enrichedAt: new Date('2026-11-01'), mbReleaseId: null })
		).toBe('no source');
	});
});
