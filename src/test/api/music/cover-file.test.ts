// @vitest-environment node
import handler from '@/pages/api/music/cover/[file]';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: { musicMetadata: { findUnique: vi.fn() } },
}));

const redis = vi.hoisted(() => ({ getBuffer: vi.fn(), set: vi.fn() }));
vi.mock('ioredis', () => ({
	default: class {
		getBuffer = redis.getBuffer;
		set = redis.set;
		on() {
			return this;
		}
	},
}));

import { prisma } from '@/utils/prisma';

const mockedPrisma = vi.mocked(prisma, true);

const MBID = '4853b957-05f2-457b-ba47-18b2565abc69';
const CAA = `https://coverartarchive.org/release-group/${MBID}/front-500`;
// The hops measured on 2026-11-01: the archive, then one of archive.org's nodes.
const DOWNLOAD = `https://archive.org/download/mbid-${MBID}/mbid-${MBID}-1_thumb500.jpg`;
const NODE = `https://ia800300.us.archive.org/1/items/mbid-${MBID}/mbid-${MBID}-1_thumb500.jpg`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

const redirect = (status: number, location: string) =>
	new Response(null, { status, headers: { location } });
const image = (body: Buffer = JPEG, type = 'image/jpeg') =>
	new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': type } });

async function get(file: unknown, method = 'GET') {
	const res = createMockResponse();
	await handler(createMockRequest({ method, query: { file } as any }), res);
	return res;
}

const fetchedUrls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));

describe('/api/music/cover/[file]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('REDIS_URL', 'redis://redis:6379');
		global.fetch = vi.fn();
		redis.getBuffer.mockResolvedValue(null);
		redis.set.mockResolvedValue('OK');
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue({ coverUrl: CAA } as any);
	});
	afterEach(() => vi.unstubAllEnvs());

	it('serves the archive cover through every hop, cacheable for a year, and keeps a copy', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(redirect(307, DOWNLOAD))
			.mockResolvedValueOnce(redirect(302, NODE))
			.mockResolvedValueOnce(image());

		const res = await get(`${MBID}.jpg`);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getHeaders()).toMatchObject({
			'Content-Type': 'image/jpeg',
			'Content-Length': JPEG.length,
			'Cache-Control': 'public, max-age=31536000, immutable',
		});
		expect(res._getData()).toEqual(JPEG);
		expect(mockedPrisma.musicMetadata.findUnique).toHaveBeenCalledWith({
			where: { mbid: MBID },
			select: { coverUrl: true },
		});
		expect(fetchedUrls()).toEqual([CAA, DOWNLOAD, NODE]);
		expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
		expect(redis.getBuffer).toHaveBeenCalledWith(`music:cover:${MBID}`);
		expect(redis.set).toHaveBeenCalledWith(
			`music:cover:${MBID}`,
			Buffer.concat([Buffer.from('image/jpeg\n'), JPEG]),
			'EX',
			30 * 24 * 60 * 60
		);
	});

	it('serves a cached cover without asking the database or the archive', async () => {
		redis.getBuffer.mockResolvedValue(Buffer.concat([Buffer.from('image/png\n'), JPEG]));

		const res = await get(`${MBID}.jpg`);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getHeaders()).toMatchObject({
			'Content-Type': 'image/png',
			'Content-Length': JPEG.length,
			'Cache-Control': 'public, max-age=31536000, immutable',
		});
		expect(res._getData()).toEqual(JPEG);
		expect(fetch).not.toHaveBeenCalled();
		expect(mockedPrisma.musicMetadata.findUnique).not.toHaveBeenCalled();
	});

	it('serves from the archive when Redis is down, and says so once', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		redis.getBuffer.mockRejectedValue(new Error('Connection is closed.'));
		redis.set.mockRejectedValue(new Error('Connection is closed.'));
		vi.mocked(fetch).mockImplementation(async () => image());

		expect((await get(`${MBID}.jpg`))._getData()).toEqual(JPEG);
		const again = await get(`${MBID}.jpg`);

		expect(again._getStatusCode()).toBe(200);
		expect(again._getData()).toEqual(JPEG);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('serves a cover over 1 MB without caching it', async () => {
		const big = Buffer.alloc(1024 * 1024 + 1);
		vi.mocked(fetch).mockResolvedValue(image(big));

		const res = await get(`${MBID}.jpg`);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getHeaders()['Content-Length']).toBe(big.length);
		expect(redis.set).not.toHaveBeenCalled();
	});

	it('refuses a redirect off the allowlist without following it', async () => {
		vi.mocked(fetch).mockResolvedValue(redirect(302, 'https://archive.org.evil.example/x.jpg'));

		const res = await get(`${MBID}.jpg`);

		expect(res._getStatusCode()).toBe(404);
		expect(res._getHeaders()['Cache-Control']).toBe('public, max-age=300');
		expect(fetchedUrls()).toEqual([CAA]);
		expect(redis.set).not.toHaveBeenCalled();
	});

	it('refuses a stored URL off the allowlist', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue({
			coverUrl: 'https://evil.example/cover.jpg',
		} as any);

		expect((await get(`${MBID}.jpg`))._getStatusCode()).toBe(404);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('serves a stored iTunes cover from its CDN', async () => {
		const itunes = 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg';
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue({ coverUrl: itunes } as any);
		vi.mocked(fetch).mockResolvedValue(image());

		expect((await get(`${MBID}.jpg`))._getStatusCode()).toBe(200);
		expect(fetchedUrls()).toEqual([itunes]);
	});

	it('answers 404, cached five minutes, when there is no cover or no image', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValueOnce(null);
		const none = await get(`${MBID}.jpg`);
		expect(none._getStatusCode()).toBe(404);
		expect(none._getHeaders()['Cache-Control']).toBe('public, max-age=300');
		expect(fetch).not.toHaveBeenCalled();

		vi.mocked(fetch).mockResolvedValueOnce(
			new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
		);
		expect((await get(`${MBID}.jpg`))._getStatusCode()).toBe(404);

		vi.mocked(fetch).mockResolvedValueOnce(new Response('gone', { status: 503 }));
		expect((await get(`${MBID}.jpg`))._getStatusCode()).toBe(404);
		expect(redis.set).not.toHaveBeenCalled();
	});

	it('gives up on the archive after 10 seconds', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		vi.mocked(fetch).mockImplementation(async (_url, init) => {
			expect(init?.signal).toBe(timeout.mock.results[0].value);
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		const res = await get(`${MBID}.jpg`);

		expect(timeout).toHaveBeenCalledWith(10_000);
		expect(res._getStatusCode()).toBe(404);
		expect(res._getHeaders()['Cache-Control']).toBe('public, max-age=300');
		error.mockRestore();
		timeout.mockRestore();
	});

	it('takes only GET and a release group id with .jpg', async () => {
		expect((await get(`${MBID}.jpg`, 'POST'))._getStatusCode()).toBe(405);
		expect((await get('not-an-mbid.jpg'))._getStatusCode()).toBe(400);
		expect((await get(MBID))._getStatusCode()).toBe(400);
		expect((await get([`${MBID}.jpg`]))._getStatusCode()).toBe(400);
		expect(mockedPrisma.musicMetadata.findUnique).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});
});
