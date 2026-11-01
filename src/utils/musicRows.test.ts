import { enrichment, MbRelease, MbReleaseGroup } from '@/services/musicBrainz';
import { resetBlocklistForTests, setBlocklistForTests } from '@/services/takedown/blocklist';
import monkees from '@/test/fixtures/music/library-dc925f67cd67936b4a8fbeb17d6decb648fd3479.json';
import monkeesRelease from '@/test/fixtures/musicbrainz/release-0c6324c1-5968-4675-84bc-8f20b44cabc4.json';
import monkeesGroup from '@/test/fixtures/musicbrainz/release-group-48e8b712-4f5d-34e0-9492-22f936854662.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		availableMusicFile: { findMany: vi.fn() },
		availableMusic: { findMany: vi.fn() },
		musicMetadata: { findMany: vi.fn() },
		musicTrackMetadata: { findMany: vi.fn() },
		musicPlaylistTrack: { groupBy: vi.fn(), findMany: vi.fn() },
	},
}));

import { prisma } from '@/utils/prisma';
import { playlistSummaries, resolveAlbumSummaries, resolveMusicRows } from './musicRows';

const mocked = vi.mocked(prisma, true);

const H1 = '1'.repeat(40);
const H2 = 'b'.repeat(40);
const GONE = '3'.repeat(40);
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const M3 = '33333333-3333-4333-8333-333333333333';

const file = (hash: string, file_id: number, path: string, trackNumber: number | null = null) => ({
	link: `https://real-debrid.com/d/${hash.slice(0, 4)}${file_id}`,
	file_id,
	hash,
	path,
	bytes: BigInt(1000 + file_id),
	trackNumber,
});
const release = (hash: string, mbid: string, files: number) => ({
	hash,
	mbid,
	filename: `Release ${hash.slice(0, 1)}`,
	_count: { files },
});
const ARTIST = '084308bd-1654-436f-ba03-df6697104e19';
const meta = (mbid: string, album: string) => ({
	mbid,
	artistMbid: ARTIST,
	artist: 'Artist',
	album,
	year: 2001,
	coverUrl: `https://covers.example/${album}.jpg`,
});

describe('resolveMusicRows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetBlocklistForTests();
		setBlocklistForTests([]);
		mocked.musicTrackMetadata.findMany.mockResolvedValue([]);
	});

	it('resolves every ref with one query per table, in input order', async () => {
		mocked.availableMusicFile.findMany.mockResolvedValue([
			file(H1, 1, 'Album/01 - One.flac', 1),
			file(H1, 2, 'Album/02 - Two.flac'),
			file(H2, 5, 'Other/Track 07.mp3'),
		] as any);
		mocked.availableMusic.findMany.mockResolvedValue([
			release(H1, M1, 12),
			release(H2, M2, 9),
		] as any);
		mocked.musicMetadata.findMany.mockResolvedValue([
			meta(M1, 'First'),
			meta(M2, 'Second'),
		] as any);

		const rows = await resolveMusicRows([
			{ hash: H2, fileId: 5, mbid: M2 },
			{ hash: H1, fileId: 2, mbid: M1 },
			{ hash: H1, fileId: 1, mbid: M1 },
		]);

		expect(mocked.availableMusicFile.findMany).toHaveBeenCalledTimes(1);
		expect(mocked.availableMusic.findMany).toHaveBeenCalledTimes(1);
		expect(mocked.musicMetadata.findMany).toHaveBeenCalledTimes(1);
		expect(mocked.availableMusicFile.findMany).toHaveBeenCalledWith({
			where: { hash: { in: [H2, H1] } },
		});
		expect(mocked.musicTrackMetadata.findMany).toHaveBeenCalledTimes(1);
		expect(rows.map((r) => r.track?.id)).toEqual([`${H2}-5`, `${H1}-2`, `${H1}-1`]);
		expect(rows[1]).toEqual({
			track: {
				id: `${H1}-2`,
				hash: H1,
				fileId: 2,
				link: `https://real-debrid.com/d/11112`,
				path: 'Album/02 - Two.flac',
				bytes: 1002,
				trackNumber: 2,
				filename: '02 - Two.flac',
				disc: null,
				title: null,
				durationMs: null,
			},
			album: {
				hash: H1,
				mbid: M1,
				artistMbid: ARTIST,
				artist: 'Artist',
				album: 'First',
				year: 2001,
				coverUrl: 'https://covers.example/First.jpg',
				trackCount: 12,
			},
		});
		expect(rows[0].track?.trackNumber).toBe(7);
	});

	it("titles, numbers and times a track as its album's page does, never from its file", async () => {
		// The Monkees' 4-disc deluxe set, enriched with the 12-track 1966 album.
		const { tracks } = enrichment(
			monkees.mbid,
			monkeesGroup as unknown as MbReleaseGroup,
			monkeesRelease as unknown as MbRelease
		);
		mocked.availableMusicFile.findMany.mockResolvedValue(
			monkees.files.map((f) => ({
				...f,
				hash: monkees.hash,
				link: '',
				bytes: BigInt(f.bytes),
			}))
		);
		mocked.availableMusic.findMany.mockResolvedValue([
			release(monkees.hash, monkees.mbid, 61),
		] as any);
		mocked.musicMetadata.findMany.mockResolvedValue([meta(monkees.mbid, 'The Monkees')] as any);
		mocked.musicTrackMetadata.findMany.mockResolvedValue(tracks as any);

		// "/Disc 01/01_05 - Papa Gene's Blues…" and "/Disc 04/04_14 - Of You…".
		const rows = await resolveMusicRows([
			{ hash: monkees.hash, fileId: 6, mbid: monkees.mbid },
			{ hash: monkees.hash, fileId: 61, mbid: monkees.mbid },
		]);

		expect(mocked.musicTrackMetadata.findMany).toHaveBeenCalledWith({
			where: { mbid: { in: [monkees.mbid] } },
		});
		expect(rows.map((row) => row.track)).toMatchObject([
			{ title: "Papa Jean's Blues", trackNumber: 5, disc: 1, durationMs: 115000 },
			{ title: null, trackNumber: 14, disc: 4, durationMs: null },
		]);
	});

	it('returns track null with the metadata album when the torrent is gone', async () => {
		mocked.availableMusicFile.findMany.mockResolvedValue([]);
		mocked.availableMusic.findMany.mockResolvedValue([release(H1, M1, 12)] as any);
		mocked.musicMetadata.findMany.mockResolvedValue([
			meta(M1, 'First'),
			meta(M3, 'Third'),
		] as any);

		const rows = await resolveMusicRows([
			{ hash: GONE, fileId: 1, mbid: M3 },
			{ hash: H1, fileId: 99, mbid: M1 },
			{ hash: GONE, fileId: 2, mbid: M2 },
		]);

		expect(rows[0]).toEqual({
			track: null,
			album: {
				hash: null,
				mbid: M3,
				artistMbid: ARTIST,
				artist: 'Artist',
				album: 'Third',
				year: 2001,
				coverUrl: 'https://covers.example/Third.jpg',
				trackCount: 0,
			},
		});
		// File removed but the release is still there: the album keeps its hash.
		expect(rows[1].track).toBeNull();
		expect(rows[1].album?.hash).toBe(H1);
		// Neither a file nor metadata.
		expect(rows[2]).toEqual({ track: null, album: null });
	});

	it('resolves blocked hashes to track null without querying their files', async () => {
		setBlocklistForTests([H2]);
		mocked.availableMusicFile.findMany.mockResolvedValue([file(H1, 1, '01.flac')] as any);
		mocked.availableMusic.findMany.mockResolvedValue([release(H1, M1, 1)] as any);
		mocked.musicMetadata.findMany.mockResolvedValue([meta(M2, 'Second')] as any);

		const rows = await resolveMusicRows([
			{ hash: H1, fileId: 1, mbid: M1 },
			{ hash: H2.toUpperCase(), fileId: 1, mbid: M2 },
		]);

		expect(mocked.availableMusicFile.findMany).toHaveBeenCalledWith({
			where: { hash: { in: [H1] } },
		});
		expect(rows[0].track).not.toBeNull();
		expect(rows[1].track).toBeNull();
		expect(rows[1].album?.hash).toBeNull();
	});

	it('skips the file queries when every hash is blocked, and does nothing for no refs', async () => {
		setBlocklistForTests([H1]);
		mocked.musicMetadata.findMany.mockResolvedValue([]);
		expect(await resolveMusicRows([{ hash: H1, fileId: 1, mbid: M1 }])).toEqual([
			{ track: null, album: null },
		]);
		expect(mocked.availableMusicFile.findMany).not.toHaveBeenCalled();
		expect(await resolveMusicRows([])).toEqual([]);
	});
});

describe('resolveAlbumSummaries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetBlocklistForTests();
		setBlocklistForTests([H2]);
	});

	it('uses the unblocked release with the most files, else metadata alone', async () => {
		mocked.availableMusic.findMany.mockResolvedValue([
			release(H1, M1, 10),
			release(H2, M1, 30), // blocked
			release(GONE, M1, 0),
		] as any);
		mocked.musicMetadata.findMany.mockResolvedValue([
			meta(M1, 'First'),
			meta(M3, 'Third'),
		] as any);

		const summaries = await resolveAlbumSummaries([M1, M2, M3]);

		expect(summaries.get(M1)).toMatchObject({
			hash: H1,
			trackCount: 10,
			album: 'First',
			artistMbid: ARTIST,
		});
		expect(summaries.has(M2)).toBe(false);
		expect(summaries.get(M3)).toMatchObject({ hash: null, trackCount: 0, album: 'Third' });
		expect(mocked.availableMusic.findMany).toHaveBeenCalledTimes(1);
	});
});

describe('playlistSummaries', () => {
	beforeEach(() => vi.clearAllMocks());

	it('counts tracks and takes the cover from the first track', async () => {
		const updatedAt = new Date('2026-11-01T00:00:00Z');
		mocked.musicPlaylistTrack.groupBy.mockResolvedValue([
			{ playlistId: 'p1', _count: { _all: 3 }, _min: { position: 4 } },
		] as any);
		mocked.musicPlaylistTrack.findMany.mockResolvedValue([
			{ playlistId: 'p1', mbid: M1 },
		] as any);
		mocked.musicMetadata.findMany.mockResolvedValue([
			{ mbid: M1, coverUrl: 'https://covers.example/1.jpg' },
		] as any);

		const summaries = await playlistSummaries([
			{ id: 'p1', name: 'One', description: null, updatedAt },
			{ id: 'p2', name: 'Empty', description: 'd', updatedAt },
		]);

		expect(mocked.musicPlaylistTrack.findMany).toHaveBeenCalledWith({
			where: { OR: [{ playlistId: 'p1', position: 4 }] },
			select: { playlistId: true, mbid: true },
		});
		expect(summaries).toEqual([
			{
				id: 'p1',
				name: 'One',
				description: null,
				trackCount: 3,
				coverUrl: 'https://covers.example/1.jpg',
				updatedAt: updatedAt.toISOString(),
			},
			{
				id: 'p2',
				name: 'Empty',
				description: 'd',
				trackCount: 0,
				coverUrl: null,
				updatedAt: updatedAt.toISOString(),
			},
		]);
	});
});
