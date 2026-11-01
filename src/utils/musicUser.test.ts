import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MUSIC_TOKEN_TTL_MS,
	parsePlaylistFields,
	parseTrackRef,
	queryInt,
	requireMusicUser,
	signMusicToken,
	verifyMusicToken,
} from './musicUser';
import { SPONSOR_TOKEN_TTL_SECONDS, signSponsorToken, verifySponsorToken } from './sponsorToken';

const HASH = 'a'.repeat(40);
const MBID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('musicUser tokens', () => {
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
	});

	afterEach(() => {
		delete process.env.DMM_SPONSOR_SECRET;
		vi.useRealTimers();
	});

	it('round-trips the userId and expires after seven days', () => {
		const before = Date.now();
		const { token, exp } = signMusicToken('user12345678');
		expect(exp).toBeGreaterThanOrEqual(before + MUSIC_TOKEN_TTL_MS);
		expect(verifyMusicToken(token)).toBe('user12345678');
	});

	it('rejects an expired token', () => {
		vi.useFakeTimers();
		const { token } = signMusicToken('user12345678');
		vi.setSystemTime(Date.now() + MUSIC_TOKEN_TTL_MS + 1);
		expect(verifyMusicToken(token)).toBeNull();
	});

	it('rejects a sponsor token', () => {
		const sponsor = signSponsorToken({
			shortId: 'ZP1M',
			githubUsername: 'sponsor',
			sources: ['github'],
			keyVersion: 1,
			exp: Date.now() + SPONSOR_TOKEN_TTL_SECONDS * 1000,
		});
		expect(verifySponsorToken(sponsor)).not.toBeNull();
		expect(verifyMusicToken(sponsor)).toBeNull();
	});

	it('is never accepted as a sponsor token', () => {
		expect(verifySponsorToken(signMusicToken('user12345678').token)).toBeNull();
	});

	it('rejects a token signed with another secret, edited, or malformed', () => {
		const { token } = signMusicToken('user12345678');
		const [body, signature] = token.split('.');
		const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
		claims.userId = 'someoneelse1';
		expect(
			verifyMusicToken(
				`${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`
			)
		).toBeNull();
		expect(verifyMusicToken('garbage')).toBeNull();
		expect(verifyMusicToken(undefined)).toBeNull();
		process.env.DMM_SPONSOR_SECRET = 'another-secret';
		expect(verifyMusicToken(token)).toBeNull();
	});
});

describe('requireMusicUser', () => {
	beforeEach(() => {
		process.env.DMM_SPONSOR_SECRET = 'test-sponsor-secret';
	});

	afterEach(() => {
		delete process.env.DMM_SPONSOR_SECRET;
		vi.useRealTimers();
	});

	it('returns the userId of a valid header', () => {
		const res = createMockResponse();
		const req = createMockRequest({
			headers: { 'x-dmm-music-token': signMusicToken('user12345678').token },
		});
		expect(requireMusicUser(req, res)).toBe('user12345678');
		expect(res.status).not.toHaveBeenCalled();
	});

	it.each([
		['missing', undefined],
		['malformed', 'not-a-token'],
	])('answers 401 when the header is %s', (_label, header) => {
		const res = createMockResponse();
		const req = createMockRequest({
			headers: header ? { 'x-dmm-music-token': header } : {},
		});
		expect(requireMusicUser(req, res)).toBeNull();
		expect(res._getStatusCode()).toBe(401);
	});

	it('answers 401 when the token expired', () => {
		vi.useFakeTimers();
		const { token } = signMusicToken('user12345678');
		vi.setSystemTime(Date.now() + MUSIC_TOKEN_TTL_MS + 1);
		const res = createMockResponse();
		expect(
			requireMusicUser(createMockRequest({ headers: { 'x-dmm-music-token': token } }), res)
		).toBeNull();
		expect(res._getStatusCode()).toBe(401);
	});
});

describe('request validators', () => {
	it('parseTrackRef accepts a hash, a non-negative integer fileId and a UUID mbid', () => {
		expect(parseTrackRef({ hash: HASH, fileId: 3, mbid: MBID, extra: 1 })).toEqual({
			hash: HASH,
			fileId: 3,
			mbid: MBID,
		});
		expect(parseTrackRef({ hash: 'abc', fileId: 3, mbid: MBID })).toBeNull();
		expect(parseTrackRef({ hash: HASH, fileId: -1, mbid: MBID })).toBeNull();
		expect(parseTrackRef({ hash: HASH, fileId: 1.5, mbid: MBID })).toBeNull();
		expect(parseTrackRef({ hash: HASH, fileId: '3', mbid: MBID })).toBeNull();
		expect(parseTrackRef({ hash: HASH, fileId: 3, mbid: 'not-an-mbid' })).toBeNull();
		expect(parseTrackRef(null)).toBeNull();
	});

	it('parsePlaylistFields requires a name on create and at least one field on update', () => {
		expect(parsePlaylistFields({ name: '  Mix  ' }, false)).toEqual({ name: 'Mix' });
		expect(parsePlaylistFields({ description: 'x' }, false)).toBeNull();
		expect(parsePlaylistFields({ name: '   ' }, false)).toBeNull();
		expect(parsePlaylistFields({ name: 'x'.repeat(201) }, false)).toBeNull();
		expect(parsePlaylistFields({ description: null }, true)).toEqual({ description: null });
		expect(parsePlaylistFields({ description: 'x'.repeat(1001) }, true)).toBeNull();
		expect(parsePlaylistFields({}, true)).toBeNull();
	});

	it('queryInt falls back on junk and caps at max', () => {
		expect(queryInt('5', 1, 10)).toBe(5);
		expect(queryInt('500', 1, 10)).toBe(10);
		expect(queryInt('0', 7, 10)).toBe(7);
		expect(queryInt('abc', 7, 10)).toBe(7);
		expect(queryInt(['2'], 7, 10)).toBe(7);
	});
});
