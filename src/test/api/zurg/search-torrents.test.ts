import handler from '@/pages/api/zurg/search-torrents';
import { repository } from '@/services/repository';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/repository');

const HASH = 'f0ec5bc0e0a8d1cdfe6bc0c5ce4c5be39a9e2c6a';
const TITLE = 'The.Matrix.1999.2160p.UHD.BluRay.REMUX.HDR.HEVC.TrueHD.7.1.Atmos-FGT';

describe('POST /api/zurg/search-torrents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue({
			isSponsor: true,
			sources: ['github'],
			shortId: 'ZP1M',
			githubUsername: 'someone',
			keyVersion: 1,
		});
		vi.mocked(repository.getScrapedTrueResults).mockResolvedValue([
			{ title: TITLE, fileSize: 80000, hash: HASH },
		] as any);
		vi.mocked(repository.getScrapedResults).mockResolvedValue([] as any);
		vi.mocked(repository.getReportedHashes).mockResolvedValue([]);
		vi.mocked(repository.checkAvailabilityByHashes).mockResolvedValue([{ hash: HASH }] as any);
	});

	it('answers what each release name says beside its title, size and hash', async () => {
		const req = createMockRequest({
			method: 'POST',
			headers: { 'x-api-key': 'a'.repeat(64) },
			body: { imdbId: 'tt0133093', mediaType: 'movie' },
		});
		const res = createMockResponse();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(200);
		const { results } = vi.mocked(res.json).mock.calls[0][0];
		expect(results[0]).toMatchObject({
			title: TITLE,
			fileSize: 80000,
			hash: HASH,
			parsed: {
				resolution: '2160p',
				source: 'bluray',
				remux: true,
				hdr: 'HDR',
				group: 'FGT',
			},
		});
	});
});
