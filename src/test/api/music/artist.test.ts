import handler from '@/pages/api/music/artist';
import { setBlocklistForTests } from '@/services/takedown/blocklist';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		$queryRaw: vi.fn(),
		availableMusicFile: { findMany: vi.fn() },
		musicArtist: { findUnique: vi.fn() },
	},
}));

import { prisma } from '@/utils/prisma';

const mockedPrisma = vi.mocked(prisma, true);
const GREEN_DAY = '084308bd-1654-436f-ba03-df6697104e19';

const row = (mbid: string, album: string, year: number, primaryType: string) => ({
	hash: `hash-${mbid}`,
	mbid,
	filename: album,
	bytes: BigInt(1),
	fileCount: BigInt(12),
	artistMbid: GREEN_DAY,
	artist: 'Green Day',
	album,
	year: BigInt(year),
	coverUrl: null,
	primaryType,
	genres: null,
	mbTrackCount: null,
});

async function get(query: Record<string, string>) {
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'GET', query }), res);
	return res;
}

describe('/api/music/artist', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setBlocklistForTests([]);
		mockedPrisma.$queryRaw.mockResolvedValue([]);
		mockedPrisma.musicArtist.findUnique.mockResolvedValue(null);
	});

	it('refuses anything but a MusicBrainz id', async () => {
		expect((await get({ mbid: 'green day' }))._getStatusCode()).toBe(400);
		expect(mockedPrisma.$queryRaw).not.toHaveBeenCalled();
	});

	it('answers 404 for an artist with no album in the catalog', async () => {
		expect((await get({ mbid: GREEN_DAY }))._getStatusCode()).toBe(404);
	});

	it("lists the artist's albums newest first", async () => {
		mockedPrisma.musicArtist.findUnique.mockResolvedValue({
			mbid: GREEN_DAY,
			name: 'Green Day',
			sortName: 'Green Day',
			enrichedAt: null,
		});
		mockedPrisma.$queryRaw.mockResolvedValue([
			row('a', '¡Tré!', 2012, 'Album'),
			row('b', 'Dookie', 1994, 'Album'),
		] as any);

		const res = await get({ mbid: GREEN_DAY });
		const data = res._getData() as any;

		expect(res._getStatusCode()).toBe(200);
		expect(data.artist).toEqual({ mbid: GREEN_DAY, name: 'Green Day', sortName: 'Green Day' });
		expect(data.albums.map((a: any) => [a.album, a.year, a.primaryType, a.artistMbid])).toEqual(
			[
				['¡Tré!', 2012, 'Album', GREEN_DAY],
				['Dookie', 1994, 'Album', GREEN_DAY],
			]
		);
		const query = mockedPrisma.$queryRaw.mock.calls[0][0] as unknown as Prisma.Sql;
		expect(query.sql).toContain('md.artistMbid = ?');
		expect(query.values).toContain(GREEN_DAY);
		expect(query.sql).toMatch(/ORDER BY COALESCE\(.*\) IS NULL, COALESCE\(.*\) DESC/);
	});

	it('names an artist not yet enriched after their albums', async () => {
		mockedPrisma.$queryRaw.mockResolvedValue([row('a', '¡Tré!', 2012, 'Album')] as any);

		const data = (await get({ mbid: GREEN_DAY }))._getData() as any;

		expect(data.artist).toEqual({ mbid: GREEN_DAY, name: 'Green Day' });
	});
});
