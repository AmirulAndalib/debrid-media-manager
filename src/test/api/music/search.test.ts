import handler from '@/pages/api/music/search';
import { enrichment, MbRelease, MbReleaseGroup } from '@/services/musicBrainz';
import { setBlocklistForTests } from '@/services/takedown/blocklist';
import catalog from '@/test/fixtures/musicbrainz/catalog-2026-11-01.json';
import release from '@/test/fixtures/musicbrainz/release-08205eae-c9e3-4174-8d69-2a67d742a19c.json';
import group from '@/test/fixtures/musicbrainz/release-group-4853b957-05f2-457b-ba47-18b2565abc69.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		$queryRaw: vi.fn(),
		availableMusicFile: { findMany: vi.fn() },
		musicTrackMetadata: { findMany: vi.fn() },
	},
}));

import { prisma } from '@/utils/prisma';

const mockedPrisma = vi.mocked(prisma, true);

const TRE_HASH = '3237449d26653635ed3b3a0afb563b1087d5597b';
const TRE_MBID = '4853b957-05f2-457b-ba47-18b2565abc69';
const GREEN_DAY = '084308bd-1654-436f-ba03-df6697104e19';
const tracklist = enrichment(
	TRE_MBID,
	group as unknown as MbReleaseGroup,
	release as unknown as MbRelease
).tracks;

const treRow = {
	hash: TRE_HASH,
	mbid: TRE_MBID,
	filename: 'Green Day - ¡Tré!',
	bytes: BigInt(300000000),
	fileCount: BigInt(12),
	artistMbid: GREEN_DAY,
	artist: 'Green Day',
	album: '¡Tré!',
	year: BigInt(2012),
	coverUrl: null,
	primaryType: 'Album',
	genres: ['pop punk'],
	mbTrackCount: 12,
};

/** Routes each raw query by what it reads. */
function serve({ albums = [] as unknown[], artists = [] as unknown[], tracks = [] as unknown[] }) {
	mockedPrisma.$queryRaw.mockImplementation((async (query: Prisma.Sql) => {
		if (query.sql.includes('FROM MusicTrackMetadata t')) return tracks;
		if (query.sql.includes('AS albumCount')) return artists;
		return albums;
	}) as any);
}

const queries = () =>
	mockedPrisma.$queryRaw.mock.calls.map(([query]) => query as unknown as Prisma.Sql);

async function search(query: Record<string, string>) {
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'GET', query }), res);
	return res;
}

describe('/api/music/search', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setBlocklistForTests([]);
		serve({});
		mockedPrisma.availableMusicFile.findMany.mockResolvedValue(
			catalog.files[TRE_HASH].map((file) => ({
				link: `https://example.com/${file.fileId}`,
				file_id: file.fileId,
				hash: TRE_HASH,
				path: file.path,
				bytes: BigInt(file.bytes),
				trackNumber: file.trackNumber,
			})) as any
		);
		mockedPrisma.musicTrackMetadata.findMany.mockResolvedValue(tracklist as any);
	});

	it('rejects non-GET methods and an empty query', async () => {
		const post = createMockResponse();
		await handler(createMockRequest({ method: 'POST' }), post);
		expect(post._getStatusCode()).toBe(405);
		expect((await search({ q: '  ' }))._getStatusCode()).toBe(400);
	});

	it('finds artists, albums and tracks with the fulltext indexes', async () => {
		serve({
			albums: [treRow],
			artists: [
				{ mbid: GREEN_DAY, name: 'Green Day', albumCount: BigInt(3), coverUrl: 'x.jpg' },
			],
			tracks: [
				{ mbid: TRE_MBID, title: 'Brutal Love', lengthMs: 294746 },
				// A hit whose album is not served (blocked or gone) is dropped.
				{ mbid: 'gone', title: 'Brutal Love', lengthMs: 1 },
			],
		});

		const res = await search({ q: 'brutal love' });
		const data = res._getData() as any;

		expect(res._getStatusCode()).toBe(200);
		expect(data.artists).toEqual([
			{ mbid: GREEN_DAY, name: 'Green Day', albumCount: 3, coverUrl: 'x.jpg' },
		]);
		expect(data.albums).toHaveLength(1);
		expect(data.albums[0]).toMatchObject({
			album: '¡Tré!',
			artistMbid: GREEN_DAY,
			primaryType: 'Album',
			tracks: [],
		});
		expect(data.tracks).toHaveLength(1);
		expect(data.tracks[0].track).toMatchObject({
			title: 'Brutal Love',
			durationMs: 294746,
			path: '/01.Brutal Love.flac',
			hash: TRE_HASH,
		});
		expect(data.tracks[0].album).toMatchObject({
			mbid: TRE_MBID,
			artistMbid: GREEN_DAY,
			tracks: [],
		});

		const sql = queries().map((query) => query.sql);
		expect(
			sql.some((s) => s.includes('MATCH(md.artist, md.album) AGAINST (? IN BOOLEAN MODE)'))
		).toBe(true);
		expect(sql.some((s) => s.includes('MATCH(t.title) AGAINST (? IN BOOLEAN MODE)'))).toBe(
			true
		);
		expect(queries().every((query) => !query.values.includes('brutal love'))).toBe(true);
		expect(queries().some((query) => query.values.includes('+brutal* +love*'))).toBe(true);
	});

	it('falls back to LIKE under three characters', async () => {
		await search({ q: 'u2' });

		const sql = queries().map((query) => query.sql);
		expect(sql.some((s) => s.includes('(md.artist LIKE ? OR md.album LIKE ?)'))).toBe(true);
		expect(sql.some((s) => s.includes('t.title LIKE ?'))).toBe(true);
		expect(sql.some((s) => s.includes('MATCH('))).toBe(false);
	});

	it('caps the limit', async () => {
		await search({ q: 'love', limit: '500' });

		for (const query of queries()) expect(query.values.at(-1)).not.toBe(500);
		expect(queries().some((query) => query.values.at(-1) === 50)).toBe(true);
	});
});
