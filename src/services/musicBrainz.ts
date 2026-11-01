import * as v from '@badrap/valita';

// MusicBrainz asks for one request a second and a User-Agent that names the
// application: https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
export const MUSICBRAINZ_USER_AGENT = 'DebridMediaManager/1.0 (https://debridmediamanager.com)';
const API = 'https://musicbrainz.org/ws/2';
const INTERVAL_MS = 1000;
const RETRIES = 5;

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isMbid = (value: unknown): value is string =>
	typeof value === 'string' && MBID.test(value);

/** `MusicMetadata.mbid` is a release group, so its art is the release group's. */
export const caaCoverUrl = (mbid: string) =>
	`https://coverartarchive.org/release-group/${mbid}/front-500`;

/**
 * The Cover Art Archive redirects to the image when there is one and answers
 * 404 when not. Unreachable counts as none: callers fall back and ask again later.
 */
export async function hasCaaCover(mbid: string): Promise<boolean> {
	if (!isMbid(mbid)) return false;
	try {
		const response = await fetch(caaCoverUrl(mbid), {
			method: 'HEAD',
			redirect: 'manual',
			headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT },
			signal: AbortSignal.timeout(5000),
		});
		return response.status >= 300 && response.status < 400;
	} catch {
		return false;
	}
}

const ArtistCredit = v.array(
	v.object({
		name: v.string(),
		joinphrase: v.string().optional(),
		artist: v.object({ id: v.string(), name: v.string(), 'sort-name': v.string() }),
	})
);

const ReleaseGroup = v.object({
	id: v.string(),
	title: v.string(),
	'primary-type': v.string().nullable().optional(),
	'secondary-types': v.array(v.string()).optional(),
	'first-release-date': v.string().optional(),
	genres: v.array(v.object({ name: v.string(), count: v.number() })).optional(),
	'artist-credit': ArtistCredit,
	releases: v.array(
		v.object({
			id: v.string(),
			status: v.string().nullable().optional(),
			date: v.string().optional(),
			media: v.array(v.object({ 'track-count': v.number() })).optional(),
		})
	),
});
export type MbReleaseGroup = v.Infer<typeof ReleaseGroup>;

const Release = v.object({
	id: v.string(),
	media: v.array(
		v.object({
			position: v.number(),
			tracks: v
				.array(
					v.object({
						position: v.number(),
						title: v.string(),
						length: v.number().nullable().optional(),
						recording: v.object({ id: v.string() }),
						'artist-credit': ArtistCredit.optional(),
					})
				)
				.optional(),
		})
	),
});
export type MbRelease = v.Infer<typeof Release>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let nextSlot = 0;

/** One paced request; null on 404. 503 and 429 back off (Retry-After, else 1, 2, 4… s). */
async function get(path: string): Promise<unknown | null> {
	for (let attempt = 0; ; attempt++) {
		const wait = nextSlot - Date.now();
		nextSlot = Math.max(Date.now(), nextSlot) + INTERVAL_MS;
		if (wait > 0) await sleep(wait);

		const response = await fetch(`${API}/${path}`, {
			headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT, Accept: 'application/json' },
		});
		if (response.status === 404) return null;
		if ((response.status === 503 || response.status === 429) && attempt < RETRIES) {
			const retryAfter = Number(response.headers.get('retry-after'));
			await sleep((retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000);
			continue;
		}
		if (!response.ok) throw new Error(`MusicBrainz answered ${response.status} for ${path}`);
		return response.json();
	}
}

export async function fetchReleaseGroup(mbid: string): Promise<MbReleaseGroup | null> {
	const json = await get(
		`release-group/${mbid}?inc=releases+media+artist-credits+genres&fmt=json`
	);
	return json === null ? null : ReleaseGroup.parse(json, { mode: 'strip' });
}

export async function fetchRelease(id: string): Promise<MbRelease | null> {
	const json = await get(`release/${id}?inc=recordings+artist-credits&fmt=json`);
	return json === null ? null : Release.parse(json, { mode: 'strip' });
}

const discCounts = (release: MbReleaseGroup['releases'][number]) =>
	(release.media ?? []).map((medium) => medium['track-count']);
const sum = (counts: number[]) => counts.reduce((total, count) => total + count, 0);

/**
 * The release whose tracklist stands for the group: an official one if any;
 * of those the one with as many tracks per disc as the catalog has audio files
 * per disc (`perDisc`, see `discTrackCounts`), else as many tracks in all, else
 * the earliest dated (undated last).
 */
export function pickRelease(
	group: MbReleaseGroup,
	perDisc: number[]
): MbReleaseGroup['releases'][number] | null {
	const official = group.releases.filter((release) => release.status === 'Official');
	const byDate = [...(official.length ? official : group.releases)].sort((a, b) =>
		(a.date || '9999').localeCompare(b.date || '9999')
	);
	return (
		byDate.find((release) => discCounts(release).join() === perDisc.join()) ??
		byDate.find((release) => sum(discCounts(release)) === sum(perDisc)) ??
		byDate[0] ??
		null
	);
}

type Credit = v.Infer<typeof ArtistCredit>;
const creditName = (credit: Credit) =>
	credit.map((part) => part.name + (part.joinphrase ?? '')).join('');
// By artist, not by name: a release may credit "David Bowie" as "Bowie".
const creditIds = (credit: Credit) => credit.map((part) => part.artist.id).join();

/** What one release group and its chosen release add to the catalog row `mbid`. */
export function enrichment(mbid: string, group: MbReleaseGroup, release: MbRelease | null) {
	const albumArtist = creditName(group['artist-credit']);
	const tracks = (release?.media ?? []).flatMap((medium) =>
		(medium.tracks ?? []).map((track) => {
			const credit = track['artist-credit'];
			return {
				mbid,
				disc: medium.position,
				position: track.position,
				title: track.title.slice(0, 500),
				lengthMs: track.length ?? null,
				recordingMbid: track.recording.id,
				artist:
					credit && creditIds(credit) !== creditIds(group['artist-credit'])
						? creditName(credit).slice(0, 500)
						: null,
			};
		})
	);
	return {
		metadata: {
			artist: albumArtist.slice(0, 500),
			album: group.title.slice(0, 500),
			artistMbid: group['artist-credit'][0]?.artist.id ?? null,
			// Spotify's grouping: a compilation is its own kind, whatever its primary type.
			primaryType: group['secondary-types']?.includes('Compilation')
				? 'Compilation'
				: (group['primary-type'] ?? null),
			genres: [...(group.genres ?? [])]
				.sort((a, b) => b.count - a.count)
				.map((genre) => genre.name),
			firstReleaseDate: group['first-release-date'] || null,
			mbTrackCount: release ? tracks.length : null,
			mbReleaseId: release?.id ?? null,
		},
		tracks,
		artists: group['artist-credit'].map(({ artist }) => ({
			mbid: artist.id,
			name: artist.name.slice(0, 500),
			sortName: artist['sort-name'].slice(0, 500),
		})),
	};
}
