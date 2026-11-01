import handler from '@/pages/api/music/session';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { MUSIC_TOKEN_TTL_MS, verifyMusicToken } from '@/utils/musicUser';
import { verifySponsorToken } from '@/utils/sponsorToken';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/realDebrid', () => ({ getCurrentUser: vi.fn() }));

import { getCurrentUser } from '@/services/realDebrid';

const mockedGetCurrentUser = vi.mocked(getCurrentUser);

const post = (body: unknown) => createMockRequest({ method: 'POST', body });

const rdError = (status?: number) =>
	new AxiosError(
		'Request failed',
		status ? 'ERR_BAD_REQUEST' : 'ECONNRESET',
		undefined,
		undefined,
		status ? ({ status } as any) : undefined
	);

describe('/api/music/session', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
		process.env.DMMCAST_SALT = 'test-salt';
	});

	afterEach(() => {
		delete process.env.DMM_SPONSOR_SECRET;
		delete process.env.DMMCAST_SALT;
	});

	it('rejects non-POST methods', async () => {
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'GET' }), res);
		expect(res._getStatusCode()).toBe(405);
	});

	it.each([
		[{}],
		[{ accessToken: '' }],
		[{ accessToken: 42 }],
		[{ accessToken: 'x'.repeat(513) }],
	])('answers 400 for body %j', async (body) => {
		const res = createMockResponse();
		await handler(post(body), res);
		expect(res._getStatusCode()).toBe(400);
		expect(mockedGetCurrentUser).not.toHaveBeenCalled();
	});

	it('mints a token bound to the RD account', async () => {
		mockedGetCurrentUser.mockResolvedValue({ username: 'rduser' } as any);
		const before = Date.now();
		const res = createMockResponse();
		await handler(post({ accessToken: 'RDTOKEN' }), res);

		expect(res._getStatusCode()).toBe(200);
		const body = res._getData() as { token: string; userId: string; exp: number };
		expect(body.userId).toMatch(/^[A-Za-z0-9_-]{12}$/);
		expect(body.exp).toBeGreaterThanOrEqual(before + MUSIC_TOKEN_TTL_MS);
		expect(verifyMusicToken(body.token)).toBe(body.userId);
		expect(verifySponsorToken(body.token)).toBeNull();
		expect(mockedGetCurrentUser).toHaveBeenCalledWith('RDTOKEN');
	});

	it.each([401, 403])('answers 401 when RD answers %i', async (status) => {
		mockedGetCurrentUser.mockRejectedValue(rdError(status));
		const res = createMockResponse();
		await handler(post({ accessToken: 'RDTOKEN' }), res);
		expect(res._getStatusCode()).toBe(401);
	});

	it.each([
		['a 503', rdError(503)],
		['no response', rdError()],
		['a non-HTTP failure', new Error('boom')],
	])('answers 503 when RD gives %s', async (_label, error) => {
		mockedGetCurrentUser.mockRejectedValue(error);
		const res = createMockResponse();
		await handler(post({ accessToken: 'RDTOKEN' }), res);
		expect(res._getStatusCode()).toBe(503);
	});

	it('answers 500 when the user id cannot be derived', async () => {
		delete process.env.DMMCAST_SALT;
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockedGetCurrentUser.mockResolvedValue({ username: 'rduser' } as any);
		const res = createMockResponse();
		await handler(post({ accessToken: 'RDTOKEN' }), res);
		expect(res._getStatusCode()).toBe(500);
	});
});
