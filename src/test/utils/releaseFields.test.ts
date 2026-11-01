import { releaseFields } from '@/utils/releaseFields';
import { describe, expect, it } from 'vitest';

describe('releaseFields', () => {
	it('reads a remux film name', () => {
		expect(
			releaseFields(
				'The.Matrix.1999.2160p.UHD.BluRay.REMUX.HDR.HEVC.TrueHD.7.1.Atmos-FGT',
				false
			)
		).toEqual({
			resolution: '2160p',
			source: 'bluray',
			remux: true,
			videoCodec: 'x265',
			hdr: 'HDR',
			audioCodec: 'Dolby TrueHD',
			audioChannels: '7.1',
			group: 'FGT',
			proper: false,
			seasons: [],
			episodes: [],
			complete: false,
		});
	});

	it('prefers Dolby Vision over HDR and reads the episode', () => {
		const f = releaseFields(
			'Severance.S02E03.1080p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX',
			true
		);
		expect(f).toMatchObject({ hdr: 'DV', source: 'webdl', seasons: [2], episodes: [3] });
	});

	it('marks multi-season packs complete', () => {
		expect(
			releaseFields('Breaking.Bad.S01-S05.COMPLETE.1080p.BluRay.x264-ROVERS', true)
		).toMatchObject({ seasons: [1, 2, 3, 4, 5], episodes: [], complete: true, remux: false });
	});

	it('flags PROPER and REPACK', () => {
		expect(releaseFields('Movie.2020.PROPER.1080p.WEB.H264-GRP', false).proper).toBe(true);
		expect(releaseFields('Show.S03.REPACK.720p.HDTV.x264-GRP', true).proper).toBe(true);
	});

	it('answers null rather than guessing for a name that says nothing', () => {
		expect(releaseFields('Some random name', false)).toMatchObject({
			resolution: null,
			source: null,
			videoCodec: null,
			hdr: null,
			group: null,
		});
	});
});
