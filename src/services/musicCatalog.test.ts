import {
	enrichment,
	fromLidarr,
	isArtistPack,
	LidarrAlbum,
	pickRelease,
	titlePool,
} from '@/services/musicBrainz';
import lz2Album from '@/test/fixtures/lidarr/album-33b4653d-006e-3cc1-8afb-386b15a6cd6e.json';
import monkeesAlbum from '@/test/fixtures/lidarr/album-48e8b712-4f5d-34e0-9492-22f936854662.json';
import adeleAlbum from '@/test/fixtures/lidarr/album-5537624c-3d2f-4f5c-8099-df916082c85c.json';
import ppmSingle from '@/test/fixtures/lidarr/album-7b1cac6e-dc17-427f-9c3a-a29a5e2b363c.json';
import ppmAlbum from '@/test/fixtures/lidarr/album-de208292-8db5-3aed-a14a-b37a84d8c521.json';
import chopin from '@/test/fixtures/music/library-0380fe617494cfc4a0b969639ad8a277ab366478.json';
import adele from '@/test/fixtures/music/library-454eb44cc1839dd1b35bf22b9a47edeacca69e67.json';
import lz2 from '@/test/fixtures/music/library-700d948d78ff200d34d643d4474365ea0b698fd7.json';
import ppm from '@/test/fixtures/music/library-b9c65409f9789626e007ccdd8b5675a0e0d34a73.json';
import monkees from '@/test/fixtures/music/library-dc925f67cd67936b4a8fbeb17d6decb648fd3479.json';
import { discTrackCounts, getFilename } from '@/utils/musicTracks';
import { describe, expect, it, vi } from 'vitest';
import { albumTracks, titleCensusReason } from './musicCatalog';

vi.mock('@/utils/prisma', () => ({ prisma: {} }));

type Library = {
	hash: string;
	mbid: string;
	artist?: string;
	files: { file_id: number; path: string; bytes: number; trackNumber: number | null }[];
};

/**
 * A torrent's real files as the album page serves them against `album`'s
 * stored rows, with `artistAlbums` as the artist pool's groups.
 */
function served(
	library: Library,
	album?: LidarrAlbum,
	releaseId?: string,
	artistAlbums: LidarrAlbum[] = []
) {
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
	const pool = titlePool(library.mbid, group, releases, tracks);
	const artistPool = isArtistPack(paths.length, tracks.length, {
		mbid: metadata.artistMbid,
		name: metadata.artist,
	})
		? titlePool(
				library.mbid,
				group,
				artistAlbums.flatMap((other) => fromLidarr(other).releases),
				[...tracks, ...pool],
				pool.length
			)
		: [];
	const rows = [...tracks, ...pool, ...artistPool];
	return {
		tracks: albumTracks(files, rows as Parameters<typeof albumTracks>[1], library.artist),
		mbTrackCount: metadata.mbTrackCount,
	};
}

const enriched = { enrichedAt: new Date('2026-11-01'), mbReleaseId: 'a-release' };

describe('albumTracks', () => {
	it('titles files named "<artist> - <title>" from the titles of other releases', () => {
		// Adele, 25: "12. Adele - Can't Let Go.flac"… stored with an 11-track
		// release; the 14-track CDs put 12 to 14 in the pool (census 2026-11-01).
		const album = served(
			adele,
			adeleAlbum as unknown as LidarrAlbum,
			'2b4c1e9c-1904-4155-9df6-d1681ddef130'
		);
		expect(album.mbTrackCount).toBe(11);
		expect(album.tracks.map((track) => track.title).slice(10)).toEqual([
			'Sweetest Devotion',
			'Can’t Let Go',
			'Lay Me Down',
			'Why Do You Love Me',
		]);
		expect(titleCensusReason(album, enriched)).toBe('titled');
	});

	it("titles a pack filed under a single by name only, then from the artist's other groups", () => {
		// The Beatles' Please Please Me, 14 files, filed under the 2-track single
		// Please Please Me / Ask Me Why. The census of 2026-11-01 counted 4 titled,
		// 01 "I Saw Her Standing There" and 02 "Misery" as the single's 1 and 2.
		const single = ppmSingle as unknown as LidarrAlbum;
		const before = served(ppm, single);
		expect(before.tracks.map((track) => track.title)).toEqual([
			...Array(5).fill(null),
			'Ask Me Why',
			'Please Please Me',
			...Array(7).fill(null),
		]);
		// Named like the single's first track, it is still the album's seventh.
		expect(before.tracks[6].trackNumber).toBe(7);
		expect(titleCensusReason(before, enriched)).toBe('files > tracks');

		const after = served(ppm, single, undefined, [ppmAlbum as unknown as LidarrAlbum]);
		const titles = after.tracks.map((track) => track.title);
		expect(after.mbTrackCount).toBe(2);
		expect(titles).toEqual([
			'I Saw Her Standing There',
			'Misery',
			'Anna (Go to Him)',
			'Chains',
			'Boys',
			'Ask Me Why',
			'Please Please Me',
			'Love Me Do',
			'P.S. I Love You',
			'Baby It’s You',
			'Do You Want to Know a Secret',
			'A Taste of Honey',
			'There’s a Place',
			'Twist and Shout',
		]);
		expect(titleCensusReason(after, enriched)).toBe('titled');
		const rows = after.tracks.filter((track) => track.title === 'Chains');
		expect(rows[0]).toMatchObject({ trackNumber: 4, durationMs: expect.any(Number) });
	});
});

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
