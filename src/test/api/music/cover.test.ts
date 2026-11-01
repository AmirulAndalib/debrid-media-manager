import handler from '@/pages/api/music/cover';
import { createMockRequest, createMockResponse, MockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		musicMetadata: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
	},
}));

import { prisma } from '@/utils/prisma';

const mockedPrisma = vi.mocked(prisma, true);

describe('/api/music/cover', () => {
	let res: MockResponse;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
		global.fetch = vi.fn();
	});

	it('rejects non-POST methods', async () => {
		const req = createMockRequest({ method: 'GET' });
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(405);
		expect(res._getData()).toEqual({ error: 'Method not allowed' });
	});

	it('returns 400 when mbid is missing', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(400);
		expect(res._getData()).toEqual({ error: 'Missing required fields: mbid, artist, album' });
	});

	it('returns 400 when artist is missing', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(400);
	});

	it('returns 400 when album is missing', async () => {
		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist' },
		});
		res = createMockResponse();
		await handler(req, res);
		expect(res._getStatusCode()).toBe(400);
	});

	it('returns cached cover when exists in DB', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue({
			coverUrl: 'https://example.com/cover.jpg',
		} as any);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			coverUrl: 'https://example.com/cover.jpg',
			source: 'cached',
		});
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('searches iTunes and returns cover when not cached', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);
		mockedPrisma.musicMetadata.update.mockResolvedValue({} as any);

		const itunesResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				resultCount: 1,
				results: [{ artworkUrl100: 'https://itunes.com/art100x100.jpg' }],
			}),
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(itunesResponse);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			coverUrl: 'https://itunes.com/art600x600.jpg',
			source: 'itunes',
		});
	});

	it('updates DB when cover found from iTunes', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);
		mockedPrisma.musicMetadata.update.mockResolvedValue({} as any);

		const itunesResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				resultCount: 1,
				results: [{ artworkUrl100: 'https://itunes.com/art100x100.jpg' }],
			}),
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(itunesResponse);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(mockedPrisma.musicMetadata.update).toHaveBeenCalledWith({
			where: { mbid: 'abc-123' },
			data: { coverUrl: 'https://itunes.com/art600x600.jpg', coverSource: 'itunes' },
		});
	});

	it('returns null coverUrl when iTunes has no results', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);

		const emptyResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({ resultCount: 0, results: [] }),
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(emptyResponse);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({ coverUrl: null });
	});

	it('falls back to album-only search when combined search has no results', async () => {
		mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);
		mockedPrisma.musicMetadata.update.mockResolvedValue({} as any);

		const emptyResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({ resultCount: 0, results: [] }),
		};
		const fallbackResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				resultCount: 1,
				results: [
					{
						artworkUrl100: 'https://itunes.com/fallback100x100.jpg',
						artistName: 'Artist Name',
					},
				],
			}),
		};
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(emptyResponse)
			.mockResolvedValueOnce(fallbackResponse);

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist Name', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(global.fetch).toHaveBeenCalledTimes(2);
		expect(res._getStatusCode()).toBe(200);
		expect(res._getData()).toEqual({
			coverUrl: 'https://itunes.com/fallback600x600.jpg',
			source: 'itunes',
		});
	});

	describe('Cover Art Archive', () => {
		// Radiohead, Hail to the Thief, whose stored iTunes cover was an
		// inauguration seal on 2026-11-01; the archive has its art.
		const MBID = '5c14fd50-a2f1-3672-9537-b0dad91bea2f';
		const CAA = `https://coverartarchive.org/release-group/${MBID}/front-500`;
		const body = { mbid: MBID, artist: 'Radiohead', album: 'Hail to the Thief' };
		const fetchMock = () => global.fetch as ReturnType<typeof vi.fn>;
		const post = async () => {
			const res = createMockResponse();
			await handler(createMockRequest({ method: 'POST', body }), res);
			return res;
		};

		it('takes the release group art over iTunes', async () => {
			mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);
			fetchMock().mockResolvedValue(new Response(null, { status: 307 }));

			const res = await post();

			expect(res._getData()).toEqual({ coverUrl: CAA, source: 'caa' });
			expect(fetchMock()).toHaveBeenCalledTimes(1);
			expect(fetchMock().mock.calls[0][0]).toBe(CAA);
			expect(fetchMock().mock.calls[0][1]).toMatchObject({
				method: 'HEAD',
				redirect: 'manual',
			});
			expect(mockedPrisma.musicMetadata.update).toHaveBeenCalledWith({
				where: { mbid: MBID },
				data: { coverUrl: CAA, coverSource: 'caa' },
			});
		});

		it('replaces a stored iTunes guess once the archive has art', async () => {
			mockedPrisma.musicMetadata.findUnique.mockResolvedValue({
				coverUrl:
					'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/4f/16/92/4f16923d-65a2-cc8c-1b49-8acb391f8a4d/0848129046826.jpg/600x600bb.jpg',
				coverSource: null,
			} as any);
			fetchMock().mockResolvedValue(new Response(null, { status: 307 }));

			expect((await post())._getData()).toEqual({ coverUrl: CAA, source: 'caa' });
		});

		it('keeps a stored iTunes cover while the archive has none', async () => {
			mockedPrisma.musicMetadata.findUnique.mockResolvedValue({
				coverUrl: 'https://is1-ssl.mzstatic.com/cover.jpg',
				coverSource: 'itunes',
			} as any);
			fetchMock().mockResolvedValue(new Response(null, { status: 404 }));

			expect((await post())._getData()).toEqual({
				coverUrl: 'https://is1-ssl.mzstatic.com/cover.jpg',
				source: 'cached',
			});
			expect(fetchMock()).toHaveBeenCalledTimes(1);
			expect(mockedPrisma.musicMetadata.update).not.toHaveBeenCalled();
		});

		it('asks iTunes when the archive has no art', async () => {
			mockedPrisma.musicMetadata.findUnique.mockResolvedValue(null);
			fetchMock()
				.mockResolvedValueOnce(new Response(null, { status: 404 }))
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({
						resultCount: 1,
						results: [{ artworkUrl100: 'https://itunes.com/art100x100.jpg' }],
					}),
				});

			expect((await post())._getData()).toEqual({
				coverUrl: 'https://itunes.com/art600x600.jpg',
				source: 'itunes',
			});
		});

		it('does not ask again once the cover comes from the archive', async () => {
			mockedPrisma.musicMetadata.findUnique.mockResolvedValue({
				coverUrl: CAA,
				coverSource: 'caa',
			} as any);

			expect((await post())._getData()).toEqual({ coverUrl: CAA, source: 'cached' });
			expect(fetchMock()).not.toHaveBeenCalled();
		});
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockedPrisma.musicMetadata.findUnique.mockRejectedValue(new Error('DB error'));

		const req = createMockRequest({
			method: 'POST',
			body: { mbid: 'abc-123', artist: 'Artist', album: 'Album' },
		});
		res = createMockResponse();
		await handler(req, res);

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ error: 'Failed to fetch cover' });
	});
});
