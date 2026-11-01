import playlistsHandler from '@/pages/api/music/me/playlists';
import playlistHandler from '@/pages/api/music/me/playlists/[id]';
import tracksHandler from '@/pages/api/music/me/playlists/[id]/tracks';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { signMusicToken } from '@/utils/musicUser';
import { NextApiRequest } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		$transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
		musicPlaylist: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
		musicPlaylistTrack: {
			findMany: vi.fn(),
			findFirst: vi.fn(),
			count: vi.fn(),
			createMany: vi.fn(),
			updateMany: vi.fn(),
			update: vi.fn(),
			deleteMany: vi.fn(),
		},
	},
}));

vi.mock('@/utils/musicRows', () => ({
	resolveMusicRows: vi.fn(async (refs: unknown[]) =>
		refs.map((_, i) => ({ track: null, album: i === 0 ? { coverUrl: 'cover.jpg' } : null }))
	),
	playlistSummaries: vi.fn(async (rows: { id: string; name: string }[]) =>
		rows.map((row) => ({ id: row.id, name: row.name }))
	),
}));

import { prisma } from '@/utils/prisma';

const db = vi.mocked(prisma, true);

const USER = 'user12345678';
const HASH = 'a'.repeat(40);
const MBID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const AT = new Date('2026-11-01T10:00:00Z');
const REF = { hash: HASH, fileId: 3, mbid: MBID };
const PLAYLIST = {
	id: 'p1',
	userId: USER,
	name: 'Mix',
	description: null,
	createdAt: AT,
	updatedAt: AT,
};

let token: string;
const authed = (overrides: Partial<NextApiRequest> = {}) =>
	createMockRequest({ ...overrides, headers: { 'x-dmm-music-token': token } });

async function call(handler: (req: any, res: any) => unknown, req: NextApiRequest) {
	const res = createMockResponse();
	await handler(req, res);
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
	token = signMusicToken(USER).token;
	db.musicPlaylist.findUnique.mockResolvedValue(PLAYLIST);
});

afterEach(() => {
	delete process.env.DMM_SPONSOR_SECRET;
});

describe('auth and ownership', () => {
	it.each([
		['playlists', playlistsHandler, 'GET'],
		['playlist', playlistHandler, 'GET'],
		['tracks', tracksHandler, 'POST'],
	] as const)('%s answers 401 without a token', async (_name, handler, method) => {
		const res = await call(handler, createMockRequest({ method, query: { id: 'p1' } }));
		expect(res._getStatusCode()).toBe(401);
	});

	it.each([
		['GET', playlistHandler, {}],
		['PATCH', playlistHandler, { name: 'x' }],
		['DELETE', playlistHandler, {}],
		['POST', tracksHandler, { tracks: [REF] }],
		['DELETE', tracksHandler, { trackIds: ['t1'] }],
		['PUT', tracksHandler, { order: ['t1'] }],
	] as const)(
		"%s answers 404 for another user's playlist and changes nothing",
		async (method, handler, body) => {
			db.musicPlaylist.findUnique.mockResolvedValue({ ...PLAYLIST, userId: 'someoneelse1' });
			const res = await call(handler, authed({ method, query: { id: 'p1' }, body }));
			expect(res._getStatusCode()).toBe(404);
			expect(db.$transaction).not.toHaveBeenCalled();
			expect(db.musicPlaylist.update).not.toHaveBeenCalled();
		}
	);

	it('answers 404 for a playlist that does not exist', async () => {
		db.musicPlaylist.findUnique.mockResolvedValue(null);
		const res = await call(playlistHandler, authed({ query: { id: 'nope' } }));
		expect(res._getStatusCode()).toBe(404);
	});

	it.each([
		[playlistsHandler, 'PUT'],
		[playlistHandler, 'POST'],
		[tracksHandler, 'GET'],
	] as const)('answers 405 to unsupported methods', async (handler, method) => {
		const res = await call(handler, authed({ method, query: { id: 'p1' } }));
		expect(res._getStatusCode()).toBe(405);
	});
});

describe('/api/music/me/playlists', () => {
	it('lists the caller’s playlists, most recently updated first', async () => {
		db.musicPlaylist.findMany.mockResolvedValue([PLAYLIST]);
		const res = await call(playlistsHandler, authed());
		expect(res._getData()).toEqual({ playlists: [{ id: 'p1', name: 'Mix' }] });
		expect(db.musicPlaylist.findMany).toHaveBeenCalledWith({
			where: { userId: USER },
			orderBy: { updatedAt: 'desc' },
		});
	});

	it('creates a playlist', async () => {
		db.musicPlaylist.create.mockResolvedValue(PLAYLIST);
		const res = await call(
			playlistsHandler,
			authed({ method: 'POST', body: { name: ' Mix ', description: 'd' } })
		);
		expect(res._getStatusCode()).toBe(201);
		expect(db.musicPlaylist.create).toHaveBeenCalledWith({
			data: { userId: USER, name: 'Mix', description: 'd' },
		});
	});

	it.each([[{}], [{ name: '' }], [{ name: 'x'.repeat(201) }], [{ name: 'a', description: 5 }]])(
		'answers 400 for %j',
		async (body) => {
			const res = await call(playlistsHandler, authed({ method: 'POST', body }));
			expect(res._getStatusCode()).toBe(400);
			expect(db.musicPlaylist.create).not.toHaveBeenCalled();
		}
	);
});

describe('/api/music/me/playlists/[id]', () => {
	it('returns the playlist with its tracks in order', async () => {
		db.musicPlaylistTrack.findMany.mockResolvedValue([
			{ id: 't1', playlistId: 'p1', position: 0, ...REF, addedAt: AT },
			{ id: 't2', playlistId: 'p1', position: 5, ...REF, addedAt: AT },
		]);
		const res = await call(playlistHandler, authed({ query: { id: 'p1' } }));
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			id: 'p1',
			name: 'Mix',
			description: null,
			trackCount: 2,
			coverUrl: 'cover.jpg',
			updatedAt: AT.toISOString(),
			tracks: [
				{
					id: 't1',
					position: 0,
					addedAt: AT.toISOString(),
					...REF,
					track: null,
					album: { coverUrl: 'cover.jpg' },
				},
				{
					id: 't2',
					position: 5,
					addedAt: AT.toISOString(),
					...REF,
					track: null,
					album: null,
				},
			],
		});
		expect(db.musicPlaylistTrack.findMany).toHaveBeenCalledWith({
			where: { playlistId: 'p1' },
			orderBy: { position: 'asc' },
		});
	});

	it('renames and clears the description', async () => {
		db.musicPlaylist.update.mockResolvedValue({ ...PLAYLIST, name: 'New' });
		const res = await call(
			playlistHandler,
			authed({
				method: 'PATCH',
				query: { id: 'p1' },
				body: { name: 'New', description: null },
			})
		);
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ id: 'p1', name: 'New' });
		expect(db.musicPlaylist.update).toHaveBeenCalledWith({
			where: { id: 'p1' },
			data: { name: 'New', description: null },
		});
	});

	it('answers 400 to an empty PATCH', async () => {
		const res = await call(playlistHandler, authed({ method: 'PATCH', query: { id: 'p1' } }));
		expect(res._getStatusCode()).toBe(400);
	});

	it('deletes the playlist and its tracks together', async () => {
		const res = await call(playlistHandler, authed({ method: 'DELETE', query: { id: 'p1' } }));
		expect(res._getStatusCode()).toBe(204);
		expect(db.$transaction).toHaveBeenCalledTimes(1);
		expect(db.musicPlaylistTrack.deleteMany).toHaveBeenCalledWith({
			where: { playlistId: 'p1' },
		});
		expect(db.musicPlaylist.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
	});
});

describe('/api/music/me/playlists/[id]/tracks', () => {
	const post = (body: unknown) => authed({ method: 'POST', query: { id: 'p1' }, body });

	it('appends after the last position', async () => {
		db.musicPlaylistTrack.count.mockResolvedValue(2);
		db.musicPlaylistTrack.findFirst.mockResolvedValue({ position: 7 } as any);

		const res = await call(tracksHandler, post({ tracks: [REF, { ...REF, fileId: 4 }] }));

		expect(res._getStatusCode()).toBe(201);
		expect(res._getData()).toEqual({ trackCount: 4 });
		expect(db.musicPlaylistTrack.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ orderBy: { position: 'desc' }, skip: 0 })
		);
		expect(db.musicPlaylistTrack.updateMany).not.toHaveBeenCalled();
		expect(db.musicPlaylistTrack.createMany).toHaveBeenCalledWith({
			data: [
				{ playlistId: 'p1', position: 8, ...REF },
				{ playlistId: 'p1', position: 9, ...REF, fileId: 4 },
			],
		});
		expect(db.musicPlaylist.update).toHaveBeenCalledWith({
			where: { id: 'p1' },
			data: { updatedAt: expect.any(Date) },
		});
	});

	it('appends from 0 to an empty playlist', async () => {
		db.musicPlaylistTrack.count.mockResolvedValue(0);
		db.musicPlaylistTrack.findFirst.mockResolvedValue(null);
		await call(tracksHandler, post({ tracks: [REF], position: 0 }));
		expect(db.musicPlaylistTrack.createMany).toHaveBeenCalledWith({
			data: [{ playlistId: 'p1', position: 0, ...REF }],
		});
	});

	it('inserts at an index and shifts the rest in one transaction', async () => {
		db.musicPlaylistTrack.count.mockResolvedValue(3);
		db.musicPlaylistTrack.findFirst.mockResolvedValue({ position: 4 } as any);

		const res = await call(tracksHandler, post({ tracks: [REF, REF], position: 1 }));

		expect(res._getStatusCode()).toBe(201);
		expect(db.musicPlaylistTrack.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ orderBy: { position: 'asc' }, skip: 1 })
		);
		expect(db.musicPlaylistTrack.updateMany).toHaveBeenCalledWith({
			where: { playlistId: 'p1', position: { gte: 4 } },
			data: { position: { increment: 2 } },
		});
		expect(db.musicPlaylistTrack.createMany).toHaveBeenCalledWith({
			data: [
				{ playlistId: 'p1', position: 4, ...REF },
				{ playlistId: 'p1', position: 5, ...REF },
			],
		});
		expect(db.$transaction).toHaveBeenCalledTimes(1);
		expect((db.$transaction.mock.calls[0][0] as unknown as unknown[]).length).toBe(3);
	});

	it('refuses to grow a playlist past 10,000 tracks', async () => {
		db.musicPlaylistTrack.count.mockResolvedValue(10_000);
		const res = await call(tracksHandler, post({ tracks: [REF] }));
		expect(res._getStatusCode()).toBe(400);
		expect(db.musicPlaylistTrack.createMany).not.toHaveBeenCalled();
	});

	it.each([
		[{}],
		[{ tracks: [] }],
		[{ tracks: [{ ...REF, hash: 'short' }] }],
		[{ tracks: [REF], position: -1 }],
		[{ tracks: [REF], position: 1.5 }],
	])('answers 400 for %j', async (body) => {
		const res = await call(tracksHandler, post(body));
		expect(res._getStatusCode()).toBe(400);
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it('removes entries by id', async () => {
		const res = await call(
			tracksHandler,
			authed({ method: 'DELETE', query: { id: 'p1' }, body: { trackIds: ['t1', 't2'] } })
		);
		expect(res._getStatusCode()).toBe(204);
		expect(db.musicPlaylistTrack.deleteMany).toHaveBeenCalledWith({
			where: { playlistId: 'p1', id: { in: ['t1', 't2'] } },
		});
	});

	it.each([[{}], [{ trackIds: [] }], [{ trackIds: [5] }]])(
		'answers 400 to DELETE with %j',
		async (body) => {
			const res = await call(
				tracksHandler,
				authed({ method: 'DELETE', query: { id: 'p1' }, body })
			);
			expect(res._getStatusCode()).toBe(400);
		}
	);

	describe('reorder', () => {
		const put = (order: unknown) =>
			authed({ method: 'PUT', query: { id: 'p1' }, body: { order } });

		beforeEach(() => {
			db.musicPlaylistTrack.findMany.mockResolvedValue([
				{ id: 't1', position: 0 },
				{ id: 't2', position: 1 },
				{ id: 't3', position: 5 },
			] as any);
		});

		it('rewrites only the positions that change, in one transaction', async () => {
			const res = await call(tracksHandler, put(['t1', 't3', 't2']));
			expect(res._getStatusCode()).toBe(204);
			expect(db.musicPlaylistTrack.update.mock.calls).toEqual([
				[{ where: { id: 't3' }, data: { position: 1 } }],
				[{ where: { id: 't2' }, data: { position: 2 } }],
			]);
			expect(db.$transaction).toHaveBeenCalledTimes(1);
		});

		it.each([
			['a missing id', ['t2', 't1']],
			['a duplicate', ['t1', 't1', 't2']],
			['an unknown id', ['t1', 't2', 'tX']],
			['an extra id', ['t1', 't2', 't3', 'tX']],
			['not a list', 't1'],
		])('answers 400 for %s', async (_label, order) => {
			const res = await call(tracksHandler, put(order));
			expect(res._getStatusCode()).toBe(400);
			expect(db.$transaction).not.toHaveBeenCalled();
		});
	});
});
