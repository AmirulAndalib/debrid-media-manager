import albumsHandler from '@/pages/api/music/me/albums/[mbid]';
import artistsHandler from '@/pages/api/music/me/artists/[mbid]';
import historyHandler from '@/pages/api/music/me/history';
import libraryHandler from '@/pages/api/music/me/library';
import likesHandler from '@/pages/api/music/me/likes';
import stateHandler from '@/pages/api/music/me/state';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { signMusicToken } from '@/utils/musicUser';
import { NextApiRequest } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		musicSavedAlbum: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
		musicFollowedArtist: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
		musicPlaylist: { findMany: vi.fn() },
		musicMetadata: { findMany: vi.fn() },
		musicLike: { findMany: vi.fn(), count: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
		musicPlayHistory: { create: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
		availableMusic: { findUnique: vi.fn() },
		musicPlayerState: { findUnique: vi.fn(), upsert: vi.fn() },
	},
}));

vi.mock('@/utils/musicRows', () => ({
	resolveMusicRows: vi.fn(async (refs: unknown[]) =>
		refs.map(() => ({ track: null, album: null }))
	),
	resolveAlbumSummaries: vi.fn(async () => new Map()),
	playlistSummaries: vi.fn(async () => []),
}));

import { playlistSummaries, resolveAlbumSummaries, resolveMusicRows } from '@/utils/musicRows';
import { prisma } from '@/utils/prisma';

const db = vi.mocked(prisma, true);

const USER = 'user12345678';
const HASH = 'a'.repeat(40);
const MBID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ARTIST = '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const AT = new Date('2026-11-01T10:00:00Z');
const REF = { hash: HASH, fileId: 3, mbid: MBID };

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
});

afterEach(() => {
	delete process.env.DMM_SPONSOR_SECRET;
});

describe('every /me route needs a music token', () => {
	it.each([
		['library', libraryHandler, 'GET'],
		['albums', albumsHandler, 'PUT'],
		['artists', artistsHandler, 'DELETE'],
		['likes', likesHandler, 'GET'],
		['history', historyHandler, 'POST'],
		['state', stateHandler, 'GET'],
	] as const)('%s answers 401 without one', async (_name, handler, method) => {
		const res = await call(handler, createMockRequest({ method, query: { mbid: MBID } }));
		expect(res._getStatusCode()).toBe(401);
	});

	it.each([
		['library', libraryHandler, 'POST'],
		['albums', albumsHandler, 'GET'],
		['likes', likesHandler, 'POST'],
		['history', historyHandler, 'DELETE'],
		['state', stateHandler, 'POST'],
	] as const)('%s answers 405 to %s', async (_name, handler, method) => {
		const res = await call(handler, authed({ method }));
		expect(res._getStatusCode()).toBe(405);
	});
});

describe('/api/music/me/library', () => {
	it('returns saved albums, followed artists with names, and playlists', async () => {
		db.musicSavedAlbum.findMany.mockResolvedValue([
			{ userId: USER, mbid: MBID, createdAt: AT },
		]);
		db.musicFollowedArtist.findMany.mockResolvedValue([
			{ userId: USER, artistMbid: ARTIST, createdAt: AT },
			{ userId: USER, artistMbid: MBID, createdAt: AT },
		]);
		const playlistRows = [{ id: 'p1', name: 'Mix', description: null, updatedAt: AT }];
		db.musicPlaylist.findMany.mockResolvedValue(playlistRows as any);
		db.musicMetadata.findMany.mockResolvedValue([
			{ artistMbid: ARTIST, artist: 'The Artist' },
		] as any);
		const summary = { hash: HASH, mbid: MBID, artist: 'The Artist', album: 'LP' };
		vi.mocked(resolveAlbumSummaries).mockResolvedValue(new Map([[MBID, summary as any]]));
		const playlistSummary = { id: 'p1', name: 'Mix' };
		vi.mocked(playlistSummaries).mockResolvedValue([playlistSummary as any]);

		const res = await call(libraryHandler, authed());

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			albums: [{ mbid: MBID, savedAt: AT.toISOString(), album: summary }],
			artists: [
				{ artistMbid: ARTIST, name: 'The Artist', followedAt: AT.toISOString() },
				{ artistMbid: MBID, name: null, followedAt: AT.toISOString() },
			],
			playlists: [playlistSummary],
		});
		expect(db.musicSavedAlbum.findMany).toHaveBeenCalledWith({
			where: { userId: USER },
			orderBy: { createdAt: 'desc' },
		});
		expect(playlistSummaries).toHaveBeenCalledWith(playlistRows);
	});
});

describe('/api/music/me/albums/[mbid] and artists/[mbid]', () => {
	it('saves and unsaves an album idempotently', async () => {
		let res = await call(albumsHandler, authed({ method: 'PUT', query: { mbid: MBID } }));
		expect(res._getStatusCode()).toBe(204);
		expect(db.musicSavedAlbum.createMany).toHaveBeenCalledWith({
			data: { userId: USER, mbid: MBID },
			skipDuplicates: true,
		});
		res = await call(albumsHandler, authed({ method: 'DELETE', query: { mbid: MBID } }));
		expect(res._getStatusCode()).toBe(204);
		expect(db.musicSavedAlbum.deleteMany).toHaveBeenCalledWith({
			where: { userId: USER, mbid: MBID },
		});
	});

	it('follows and unfollows an artist', async () => {
		let res = await call(artistsHandler, authed({ method: 'PUT', query: { mbid: ARTIST } }));
		expect(res._getStatusCode()).toBe(204);
		expect(db.musicFollowedArtist.createMany).toHaveBeenCalledWith({
			data: { userId: USER, artistMbid: ARTIST },
			skipDuplicates: true,
		});
		res = await call(artistsHandler, authed({ method: 'DELETE', query: { mbid: ARTIST } }));
		expect(res._getStatusCode()).toBe(204);
		expect(db.musicFollowedArtist.deleteMany).toHaveBeenCalledWith({
			where: { userId: USER, artistMbid: ARTIST },
		});
	});

	it.each([albumsHandler, artistsHandler])('answers 400 for a bad mbid', async (handler) => {
		const res = await call(handler, authed({ method: 'PUT', query: { mbid: 'nope' } }));
		expect(res._getStatusCode()).toBe(400);
	});
});

describe('/api/music/me/likes', () => {
	it('lists likes newest first with resolved rows', async () => {
		db.musicLike.findMany.mockResolvedValue([{ userId: USER, ...REF, createdAt: AT }]);
		db.musicLike.count.mockResolvedValue(3);

		const res = await call(likesHandler, authed({ query: { page: '1', limit: '1' } }));

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			items: [{ ...REF, likedAt: AT.toISOString(), track: null, album: null }],
			total: 3,
			hasMore: true,
		});
		expect(db.musicLike.findMany).toHaveBeenCalledWith({
			where: { userId: USER },
			orderBy: { createdAt: 'desc' },
			skip: 0,
			take: 1,
		});
		expect(resolveMusicRows).toHaveBeenCalledTimes(1);
	});

	it('returns only ids for ?ids=1', async () => {
		db.musicLike.findMany.mockResolvedValue([{ hash: HASH, fileId: 3 }] as any);
		const res = await call(likesHandler, authed({ query: { ids: '1' } }));
		expect(res._getData()).toEqual({ ids: [`${HASH}-3`] });
		expect(resolveMusicRows).not.toHaveBeenCalled();
	});

	it('likes and unlikes a track', async () => {
		let res = await call(likesHandler, authed({ method: 'PUT', body: REF }));
		expect(res._getStatusCode()).toBe(204);
		expect(db.musicLike.createMany).toHaveBeenCalledWith({
			data: { userId: USER, ...REF },
			skipDuplicates: true,
		});
		res = await call(likesHandler, authed({ method: 'DELETE', body: REF }));
		expect(res._getStatusCode()).toBe(204);
		expect(db.musicLike.deleteMany).toHaveBeenCalledWith({
			where: { userId: USER, hash: HASH, fileId: 3 },
		});
	});

	it('answers 400 for a bad body', async () => {
		const res = await call(
			likesHandler,
			authed({ method: 'PUT', body: { ...REF, fileId: 'x' } })
		);
		expect(res._getStatusCode()).toBe(400);
		expect(db.musicLike.createMany).not.toHaveBeenCalled();
	});
});

describe('/api/music/me/history', () => {
	it('records a play of a known track', async () => {
		db.availableMusic.findUnique.mockResolvedValue({ mbid: MBID } as any);
		const res = await call(historyHandler, authed({ method: 'POST', body: REF }));
		expect(res._getStatusCode()).toBe(204);
		expect(db.musicPlayHistory.create).toHaveBeenCalledWith({ data: { userId: USER, ...REF } });
	});

	it.each([
		['an unknown hash', null],
		['another album', { mbid: ARTIST }],
	])('answers 400 for %s, so plays cannot be pinned on any artist', async (_label, release) => {
		db.availableMusic.findUnique.mockResolvedValue(release as any);
		const res = await call(historyHandler, authed({ method: 'POST', body: REF }));
		expect(res._getStatusCode()).toBe(400);
		expect(db.musicPlayHistory.create).not.toHaveBeenCalled();
	});

	it('answers 400 for a bad body', async () => {
		const res = await call(historyHandler, authed({ method: 'POST', body: { hash: HASH } }));
		expect(res._getStatusCode()).toBe(400);
	});

	it('lists recent plays newest first', async () => {
		db.musicPlayHistory.findMany.mockResolvedValue([{ ...REF, playedAt: AT }] as any);
		const res = await call(historyHandler, authed({ query: { limit: '500' } }));
		expect(res._getData()).toEqual({
			items: [{ ...REF, playedAt: AT.toISOString(), track: null, album: null }],
		});
		expect(db.musicPlayHistory.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { userId: USER },
				orderBy: { playedAt: 'desc' },
				take: 200,
			})
		);
	});

	it('groups recent plays by album', async () => {
		db.musicPlayHistory.groupBy.mockResolvedValue([
			{ mbid: MBID, _max: { playedAt: AT } },
		] as any);
		const summary = { mbid: MBID, album: 'LP' };
		vi.mocked(resolveAlbumSummaries).mockResolvedValue(new Map([[MBID, summary as any]]));

		const res = await call(historyHandler, authed({ query: { group: 'album' } }));

		expect(res._getData()).toEqual({
			items: [{ mbid: MBID, lastPlayedAt: AT.toISOString(), album: summary }],
		});
		expect(db.musicPlayHistory.groupBy).toHaveBeenCalledWith(
			expect.objectContaining({ where: { userId: USER }, take: 20 })
		);
	});
});

describe('/api/music/me/state', () => {
	it('answers nulls before the first save', async () => {
		db.musicPlayerState.findUnique.mockResolvedValue(null);
		const res = await call(stateHandler, authed());
		expect(res._getData()).toEqual({ state: null, updatedAt: null });
	});

	it('saves and returns the state', async () => {
		const state = { queue: [`${HASH}-3`], position: 12.5 };
		db.musicPlayerState.upsert.mockResolvedValue({ userId: USER, state, updatedAt: AT });
		const res = await call(stateHandler, authed({ method: 'PUT', body: { state } }));
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ state, updatedAt: AT.toISOString() });
		expect(db.musicPlayerState.upsert).toHaveBeenCalledWith({
			where: { userId: USER },
			create: { userId: USER, state },
			update: { state },
		});
	});

	it.each([[{}], [{ state: null }], [{ state: [1] }], [{ state: 'x' }]])(
		'answers 400 for %j',
		async (body) => {
			const res = await call(stateHandler, authed({ method: 'PUT', body }));
			expect(res._getStatusCode()).toBe(400);
		}
	);

	it('answers 413 above 200 KB', async () => {
		const state = { blob: 'x'.repeat(200 * 1024) };
		const res = await call(stateHandler, authed({ method: 'PUT', body: { state } }));
		expect(res._getStatusCode()).toBe(413);
		expect(db.musicPlayerState.upsert).not.toHaveBeenCalled();
	});
});
