import handler from '@/pages/api/music/popular';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		musicMetadata: { findMany: vi.fn() },
		musicPlayHistory: { groupBy: vi.fn() },
	},
}));

vi.mock('@/utils/musicRows', () => ({ resolveMusicRows: vi.fn() }));

import { resolveMusicRows } from '@/utils/musicRows';
import { prisma } from '@/utils/prisma';

const db = vi.mocked(prisma, true);
const ARTIST = '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(40);

async function get(query: Record<string, string>, method = 'GET') {
	const res = createMockResponse();
	await handler(createMockRequest({ method, query }), res);
	return res;
}

describe('/api/music/popular', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T00:00:00Z') });
	});

	afterEach(() => vi.useRealTimers());

	it('rejects non-GET methods', async () => {
		expect((await get({ artistMbid: ARTIST }, 'POST'))._getStatusCode()).toBe(405);
	});

	it('answers 400 without a valid artistMbid', async () => {
		expect((await get({}))._getStatusCode()).toBe(400);
		expect((await get({ artistMbid: 'x' }))._getStatusCode()).toBe(400);
	});

	it("ranks the artist's tracks by plays in the last 90 days, skipping unplayable ones", async () => {
		db.musicMetadata.findMany.mockResolvedValue([{ mbid: M1 }, { mbid: M2 }] as any);
		db.musicPlayHistory.groupBy.mockResolvedValue([
			{ hash: HASH, fileId: 1, mbid: M1, _count: { _all: 9 } },
			{ hash: HASH, fileId: 2, mbid: M1, _count: { _all: 5 } },
			{ hash: HASH, fileId: 3, mbid: M2, _count: { _all: 2 } },
		] as any);
		vi.mocked(resolveMusicRows).mockResolvedValue([
			{ track: { id: `${HASH}-1` } as any, album: null },
			{ track: null, album: null },
			{ track: { id: `${HASH}-3` } as any, album: null },
		]);
		const res = await get({ artistMbid: ARTIST, limit: '2' });

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			items: [
				{
					hash: HASH,
					fileId: 1,
					mbid: M1,
					plays: 9,
					track: { id: `${HASH}-1` },
					album: null,
				},
				{
					hash: HASH,
					fileId: 3,
					mbid: M2,
					plays: 2,
					track: { id: `${HASH}-3` },
					album: null,
				},
			],
		});
		const args = db.musicPlayHistory.groupBy.mock.calls[0][0] as any;
		expect(args.where.mbid).toEqual({ in: [M1, M2] });
		expect(args.where.playedAt).toEqual({ gte: new Date('2026-08-03T00:00:00Z') });
		expect(args.orderBy).toEqual({ _count: { fileId: 'desc' } });
		expect(args.take).toBe(4);
	});

	it('answers an empty list for an artist with no albums', async () => {
		db.musicMetadata.findMany.mockResolvedValue([]);
		vi.mocked(resolveMusicRows).mockResolvedValue([]);
		const res = await get({ artistMbid: ARTIST });
		expect(res._getData()).toEqual({ items: [] });
		expect(db.musicPlayHistory.groupBy).not.toHaveBeenCalled();
	});
});
