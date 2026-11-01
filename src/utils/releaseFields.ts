import { filenameParse } from '@ctrl/video-filename-parser';

// What a release's name says about it, for API callers that would otherwise parse it
// themselves. Read from the name alone, never from the files. Languages are left out:
// the parser answers English for a name that names none.
export type ReleaseFields = {
	resolution: string | null;
	source: string | null;
	remux: boolean;
	videoCodec: string | null;
	hdr: 'DV' | 'HDR' | null;
	audioCodec: string | null;
	audioChannels: string | null;
	group: string | null;
	proper: boolean;
	seasons: number[];
	episodes: number[];
	complete: boolean;
};

export function releaseFields(name: string, isTv: boolean): ReleaseFields {
	const p = filenameParse(name, isTv) as ReturnType<typeof filenameParse> & {
		seasons?: number[];
		episodeNumbers?: number[];
		complete?: boolean;
		fullSeason?: boolean;
		modifier?: string;
	};
	const resolution = p.resolution ? p.resolution.toLowerCase() : null;
	return {
		resolution: resolution && resolution !== 'unknown' ? resolution : null,
		source: p.sources?.[0]?.toLowerCase() ?? null,
		remux: p.modifier === 'REMUX',
		videoCodec: p.videoCodec ?? null,
		hdr: p.edition?.dolbyVision ? 'DV' : p.edition?.hdr ? 'HDR' : null,
		audioCodec: p.audioCodec ?? null,
		audioChannels: p.audioChannels ?? null,
		group: p.group || null,
		proper: (p.revision?.version ?? 1) > 1,
		seasons: p.seasons ?? [],
		episodes: p.episodeNumbers ?? [],
		complete: Boolean(p.complete || p.fullSeason),
	};
}
