import { _resetStoreForTest, putStoredObject } from '@/services/newznab/store';
import { albumArtUrl } from '@/utils/posterHost';
import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canMirrorAlbumArt, mirrorAlbumArt } from './albumArt';

const MONKEES = '48e8b712-4f5d-34e0-9492-22f936854662';
const CAA = `https://coverartarchive.org/release-group/${MONKEES}/front-500`;
const API_URL = 'https://api001.backblazeb2.com';
const COVER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const auth = (allowed = {}) =>
	Response.json({
		authorizationToken: 'account-token',
		apiUrl: API_URL,
		downloadUrl: 'https://f001.backblazeb2.com',
		accountId: 'account',
		allowed,
	});
const buckets = () =>
	Response.json({
		buckets: [
			{ bucketId: 'nzb-bucket', bucketName: 'dmm-nzbs' },
			{ bucketId: 'posters-bucket', bucketName: 'posters' },
		],
	});
const uploadUrl = () =>
	Response.json({ uploadUrl: 'https://pod-1.backblazeb2.com/upload', authorizationToken: 'up' });

const fetchMock = vi.fn();
const calls = () => fetchMock.mock.calls.map(([url, init]) => [String(url), init] as const);

beforeEach(() => {
	_resetStoreForTest();
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
	process.env.B2_KEY_ID = 'key';
	process.env.B2_APP_KEY = 'secret';
	delete process.env.B2_BUCKET;
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.B2_KEY_ID;
	delete process.env.B2_APP_KEY;
	delete process.env.B2_BUCKET;
});

describe('mirrorAlbumArt', () => {
	it('copies the archive cover into the posters bucket and answers its posters URL', async () => {
		fetchMock
			.mockResolvedValueOnce(
				new Response(COVER, { headers: { 'Content-Type': 'image/jpeg' } })
			)
			.mockResolvedValueOnce(auth())
			.mockResolvedValueOnce(buckets())
			.mockResolvedValueOnce(uploadUrl())
			.mockResolvedValueOnce(new Response('{}'));

		// The NZB bucket's variable is not needed: the key is.
		expect(canMirrorAlbumArt()).toBe(true);
		expect(await mirrorAlbumArt(MONKEES, CAA)).toBe(albumArtUrl(MONKEES));

		const [download, , list, , upload] = calls();
		expect(download[0]).toBe(CAA);
		expect(download[1].signal).toBeInstanceOf(AbortSignal);
		expect(JSON.parse(list[1].body)).toEqual({ accountId: 'account', bucketName: 'posters' });
		expect(upload[0]).toBe('https://pod-1.backblazeb2.com/upload');
		expect(upload[1].headers).toMatchObject({
			Authorization: 'up',
			'X-Bz-File-Name': `metahub-music-${MONKEES}.jpg`,
			'Content-Type': 'image/jpeg',
			'X-Bz-Content-Sha1': createHash('sha1').update(COVER).digest('hex'),
		});
		expect(Buffer.from(upload[1].body)).toEqual(COVER);
	});

	it('copies nothing when the archive has no cover, times out, or the upload fails', async () => {
		fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
		expect(await mirrorAlbumArt(MONKEES, CAA)).toBeNull();
		fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
		expect(await mirrorAlbumArt(MONKEES, CAA)).toBeNull();
		fetchMock.mockResolvedValueOnce(
			new Response('<html>', { headers: { 'Content-Type': 'text/html' } })
		);
		expect(await mirrorAlbumArt(MONKEES, CAA)).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(3);

		fetchMock
			.mockResolvedValueOnce(
				new Response(COVER, { headers: { 'Content-Type': 'image/jpeg' } })
			)
			.mockResolvedValueOnce(auth())
			.mockResolvedValueOnce(buckets())
			.mockResolvedValueOnce(uploadUrl())
			.mockResolvedValueOnce(new Response('{}', { status: 503 }));
		expect(await mirrorAlbumArt(MONKEES, CAA)).toBeNull();
	});

	it('is off without the B2 key', () => {
		delete process.env.B2_APP_KEY;
		expect(canMirrorAlbumArt()).toBe(false);
	});
});

describe('the B2 store with more than one bucket', () => {
	it('resolves each bucket by its own name, not the NZB one it resolved first', async () => {
		process.env.B2_BUCKET = 'dmm-nzbs';
		fetchMock
			.mockResolvedValueOnce(auth())
			.mockResolvedValueOnce(buckets())
			.mockResolvedValueOnce(uploadUrl())
			.mockResolvedValueOnce(new Response('{}'))
			.mockResolvedValueOnce(buckets())
			.mockResolvedValueOnce(uploadUrl())
			.mockResolvedValueOnce(new Response('{}'));

		expect(await putStoredObject('plugins/a.zip', COVER, 'application/zip')).toBe(true);
		expect(await putStoredObject('metahub-music-x.jpg', COVER, 'image/jpeg', 'posters')).toBe(
			true
		);

		const uploadUrls = calls().filter(([url]) => url.endsWith('/b2_get_upload_url'));
		expect(uploadUrls.map(([, init]) => JSON.parse(init.body).bucketId)).toEqual([
			'nzb-bucket',
			'posters-bucket',
		]);
	});

	it('refuses another bucket than the one a scoped key may write', async () => {
		fetchMock.mockResolvedValueOnce(auth({ bucketId: 'nzb-bucket', bucketName: 'dmm-nzbs' }));
		expect(await putStoredObject('metahub-music-x.jpg', COVER, 'image/jpeg', 'posters')).toBe(
			false
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
