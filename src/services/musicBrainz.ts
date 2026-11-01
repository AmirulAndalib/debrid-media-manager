import { getDirectory, normalizeTitle, similarTitle } from '@/utils/musicTracks';
import * as v from '@badrap/valita';

// MusicBrainz asks for one request a second and a User-Agent that names the
// application: https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
export const MUSICBRAINZ_USER_AGENT = 'DebridMediaManager/1.0 (https://debridmediamanager.com)';
const API = 'https://musicbrainz.org/ws/2';
// Lidarr's public metadata server: MusicBrainz's data, every release's
// tracklist in one answer, and no one-a-second limit. Asked at most twice a second.
const LIDARR = 'https://api.lidarr.audio/api/v0.4';

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isMbid = (value: unknown): value is string =>
	typeof value === 'string' && MBID.test(value);

/** `MusicMetadata.mbid` is a release group, so its art is the release group's. */
export const caaCoverUrl = (mbid: string) =>
	`https://coverartarchive.org/release-group/${mbid}/front-500`;

const CAA_COVER = /^https:\/\/coverartarchive\.org\/release-group\/([0-9a-f-]{36})\//;

/**
 * The cover URL the API hands out. An archive cover takes three hops, about
 * 1.7 s, so it is served through DMM's cached copy instead; others as stored.
 */
export const servedCoverUrl = (url: string | null): string | null => {
	const mbid = url?.match(CAA_COVER)?.[1];
	return mbid ? `/api/music/cover/${mbid}.jpg` : url;
};

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
			media: v
				.array(
					v.object({
						'track-count': v.number(),
						format: v.string().nullable().optional(),
					})
				)
				.optional(),
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

/** A queue that lets one request through every `interval` ms. */
function pacer(interval: number) {
	let nextSlot = 0;
	return async () => {
		const wait = nextSlot - Date.now();
		nextSlot = Math.max(Date.now(), nextSlot) + interval;
		if (wait > 0) await sleep(wait);
	};
}
const musicBrainzSlot = pacer(1000);
const lidarrSlot = pacer(500);

/** One paced request; null on 404. A 503 or 429 is asked once more after its Retry-After (at most a minute). */
async function get(path: string): Promise<unknown | null> {
	for (let attempt = 0; ; attempt++) {
		await musicBrainzSlot();
		const response = await fetch(`${API}/${path}`, {
			headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT, Accept: 'application/json' },
		});
		if (response.status === 404) return null;
		if ((response.status === 503 || response.status === 429) && attempt === 0) {
			const retryAfter = Number(response.headers.get('retry-after'));
			await sleep(Math.min(retryAfter > 0 ? retryAfter : 1, 60) * 1000);
			continue;
		}
		if (!response.ok) throw new Error(`MusicBrainz answered ${response.status} for ${path}`);
		return response.json();
	}
}

const Browse = v.object({
	'release-count': v.number(),
	releases: ReleaseGroup.shape.releases,
});
// A release-group lookup lists at most this many of its releases.
const LOOKUP_RELEASES = 25;

/** The group, with every one of its releases: a lookup lists 25, the rest are browsed 100 at a time. */
export async function fetchReleaseGroup(mbid: string): Promise<MbReleaseGroup | null> {
	const json = await get(
		`release-group/${mbid}?inc=releases+media+artist-credits+genres&fmt=json`
	);
	if (json === null) return null;
	const group = ReleaseGroup.parse(json, { mode: 'strip' });
	if (group.releases.length < LOOKUP_RELEASES) return group;
	const releases: MbReleaseGroup['releases'] = [];
	for (;;) {
		const page = await get(
			`release?release-group=${mbid}&inc=media&limit=100&offset=${releases.length}&fmt=json`
		);
		const { releases: more, 'release-count': count } = Browse.parse(page, { mode: 'strip' });
		releases.push(...more);
		if (!more.length || releases.length >= count) return { ...group, releases };
	}
}

export async function fetchRelease(id: string): Promise<MbRelease | null> {
	const json = await get(`release/${id}?inc=recordings+artist-credits&fmt=json`);
	return json === null ? null : Release.parse(json, { mode: 'strip' });
}

const LidarrArtist = v.object({
	id: v.string(),
	artistname: v.string(),
	sortname: v.string().nullable().optional(),
	artistaliases: v.array(v.string()).nullable().optional(),
});
const LidarrAlbum = v.object({
	id: v.string(),
	title: v.string(),
	type: v.string().nullable().optional(),
	secondarytypes: v.array(v.string()).nullable().optional(),
	releasedate: v.string().nullable().optional(),
	artistid: v.string(),
	genres: v.array(v.string()).nullable().optional(),
	images: v
		.array(v.object({ CoverType: v.string().nullable().optional(), Url: v.string() }))
		.nullable()
		.optional(),
	artists: v.array(LidarrArtist),
	Releases: v.array(
		v.object({
			Id: v.string(),
			Status: v.string().nullable().optional(),
			ReleaseDate: v.string().nullable().optional(),
			Media: v.array(
				v.object({ Format: v.string().nullable().optional(), Position: v.number() })
			),
			Tracks: v.array(
				v.object({
					TrackName: v.string(),
					TrackPosition: v.number(),
					MediumNumber: v.number(),
					DurationMs: v.number().nullable().optional(),
					RecordingId: v.string(),
					ArtistId: v.string().nullable().optional(),
				})
			),
		})
	),
});
export type LidarrAlbum = v.Infer<typeof LidarrAlbum>;

/** One paced request to Lidarr's metadata server; null on 404. */
async function lidarr(path: string): Promise<unknown | null> {
	await lidarrSlot();
	const response = await fetch(`${LIDARR}/${path}`, {
		headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT, Accept: 'application/json' },
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Lidarr answered ${response.status} for ${path}`);
	return response.json();
}

/** The release group with every release's tracklist, as Lidarr caches it; null when it has none. */
export async function fetchLidarrAlbum(mbid: string): Promise<LidarrAlbum | null> {
	const json = await lidarr(`album/${mbid}`);
	return json === null ? null : LidarrAlbum.parse(json, { mode: 'strip' });
}

const LidarrDiscography = v.object({
	Albums: v.array(
		v.object({
			Id: v.string(),
			Title: v.string(),
			Type: v.string().nullable().optional(),
			SecondaryTypes: v.array(v.string()).nullable().optional(),
			ReleaseStatuses: v.array(v.string()).nullable().optional(),
			ReleaseDate: v.string().nullable().optional(),
		})
	),
});
export type LidarrArtistAlbum = v.Infer<typeof LidarrDiscography>['Albums'][number];

/** The artist's release groups as Lidarr lists them, without tracks; null when it has none. */
export async function fetchLidarrArtist(mbid: string): Promise<LidarrArtistAlbum[] | null> {
	const json = await lidarr(`artist/${mbid}`);
	return json === null ? null : LidarrDiscography.parse(json, { mode: 'strip' }).Albums;
}

/** Lidarr's album search, for a group MusicBrainz no longer has. */
export async function searchLidarrAlbums(query: string): Promise<LidarrAlbum[]> {
	const json = await lidarr(`search?type=album&query=${encodeURIComponent(query)}`);
	return v.array(LidarrAlbum).parse(json ?? [], { mode: 'strip' });
}

// Lidarr writes "0001-01-01" for no date.
const lidarrDate = (date?: string | null) =>
	date && !date.startsWith('0001') ? date.slice(0, 10) : undefined;

/** A Lidarr album as MusicBrainz shapes it: the group, and every release with its tracks. */
export function fromLidarr(album: LidarrAlbum): { group: MbReleaseGroup; releases: MbRelease[] } {
	const credit = (id?: string | null) =>
		album.artists
			.filter((artist) => artist.id === id)
			.map((artist) => ({
				name: artist.artistname,
				artist: {
					id: artist.id,
					name: artist.artistname,
					'sort-name': artist.sortname || artist.artistname,
				},
			}));
	const media = (release: LidarrAlbum['Releases'][number]) =>
		[...release.Media]
			.sort((a, b) => a.Position - b.Position)
			.map((medium) => ({
				medium,
				tracks: release.Tracks.filter(
					(track) => track.MediumNumber === medium.Position
				).sort((a, b) => a.TrackPosition - b.TrackPosition),
			}));
	return {
		group: {
			id: album.id,
			title: album.title,
			'primary-type': album.type ?? null,
			'secondary-types': album.secondarytypes ?? [],
			'first-release-date': lidarrDate(album.releasedate),
			// Most relevant first, as MusicBrainz counts would sort them; its names are lower case.
			genres: (album.genres ?? []).map((name, i, all) => ({
				name: name.toLowerCase(),
				count: all.length - i,
			})),
			'artist-credit': credit(album.artistid),
			releases: album.Releases.map((release) => ({
				id: release.Id,
				status: release.Status ?? null,
				date: lidarrDate(release.ReleaseDate),
				media: media(release).map(({ medium, tracks }) => ({
					'track-count': tracks.length,
					format: medium.Format ?? null,
				})),
			})),
		},
		releases: album.Releases.map((release) => ({
			id: release.Id,
			media: media(release).map(({ medium, tracks }) => ({
				position: medium.Position,
				tracks: tracks.map((track) => ({
					position: track.TrackPosition,
					title: track.TrackName,
					length: track.DurationMs ?? null,
					recording: { id: track.RecordingId },
					'artist-credit': credit(track.ArtistId),
				})),
			})),
		})),
	};
}

/** The URL of a Lidarr album's front cover in Lidarr's image cache: the same art the Cover Art Archive serves, answered in a fraction of the time. */
export const lidarrCoverUrl = (album: LidarrAlbum): string | null =>
	album.images?.find((image) => image.CoverType === 'Cover')?.Url ?? null;

/** The release id of a Lidarr album's front cover, from its cached Cover Art Archive image. */
export const lidarrCoverRelease = (album: LidarrAlbum): string | null =>
	album.images
		?.find((image) => image.CoverType === 'Cover')
		?.Url.match(/coverartarchive\.org\/release\/([0-9a-f-]{36})\//)?.[1] ?? null;

const plainName = (name: string) =>
	name
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/^the\s+/, '')
		.trim();

/**
 * The search hit that is the catalog's album: its title, and its artist by id
 * or by a name or alias, alike once case, accents and a leading "the" are set aside.
 */
export function findLidarrAlbum(
	albums: LidarrAlbum[],
	wanted: { artist: string; album: string; artistMbid: string | null }
): LidarrAlbum | null {
	const same = (a: string, b: string) => plainName(a) === plainName(b);
	return (
		albums.find(
			(album) =>
				same(album.title, wanted.album) &&
				album.artists.some(
					(artist) =>
						artist.id === wanted.artistMbid ||
						[artist.artistname, ...(artist.artistaliases ?? [])].some((name) =>
							same(name, wanted.artist)
						)
				)
		) ?? null
	);
}

const discCounts = (release: MbReleaseGroup['releases'][number]) =>
	(release.media ?? []).map((medium) => medium['track-count']);
const sum = (counts: number[]) => counts.reduce((total, count) => total + count, 0);

/** How many of the files the release's titles name (see `similarTitle`). */
const named = (release: MbRelease, filenames: string[]) => {
	const tracks = release.media.flatMap((medium) =>
		(medium.tracks ?? []).map((track) => ({ ...track, disc: medium.position }))
	);
	return filenames.filter((filename) => similarTitle(filename, tracks)).length;
};

/**
 * Whether a release found by name rather than by id is the catalog's album:
 * its titles name at least half the files. A composer and a title ("Chopin,
 * Les Nocturnes") fit many recordings, whose tracks run in other orders.
 */
export const namesFiles = (release: MbRelease, filenames: string[]) =>
	named(release, filenames) * 2 >= filenames.length && filenames.length > 0;

const date = (release: MbReleaseGroup['releases'][number]) => release.date || '9999';
// Torrents are ripped from these, not from vinyl or tape.
const digital = (release: MbReleaseGroup['releases'][number]) =>
	release.media?.length && release.media.every((medium) => /CD|Digital/.test(medium.format ?? ''))
		? 0
		: 1;
const preferred = <R extends MbReleaseGroup['releases'][number]>(releases: R[]) =>
	[...releases].sort((a, b) => digital(a) - digital(b) || date(a).localeCompare(date(b)));

export type PickRule = 'layout' | 'count' | 'titles' | 'earliest';

/**
 * The release whose tracklist stands for the group, and the rule that chose
 * it: of the official releases, then of any, (layout) one with as many tracks
 * per disc as the catalog has audio files per disc (`perDisc`, see
 * `discTrackCounts`), else (count) as many tracks in all, else (titles) the one
 * with at least that many whose titles fit the most `filenames`, smallest first;
 * a CD or digital release over vinyl, then the earliest. Else (earliest) the
 * earliest official release, else the earliest of any. Titles are only read
 * from `tracklists` (every release's, which Lidarr gives and MusicBrainz does not).
 */
export function pickRelease(
	group: MbReleaseGroup,
	perDisc: number[],
	filenames: string[] = [],
	tracklists: MbRelease[] = []
): (MbReleaseGroup['releases'][number] & { rule: PickRule }) | null {
	type Candidate = MbReleaseGroup['releases'][number];
	const files = sum(perDisc);
	const covered = (release: Candidate) => {
		const tracklist = tracklists.find((other) => other.id === release.id);
		return tracklist ? named(tracklist, filenames) : 0;
	};
	const rules: [PickRule, (releases: Candidate[]) => Candidate | undefined][] = [
		[
			'layout',
			(releases) =>
				preferred(releases.filter((r) => discCounts(r).join() === perDisc.join()))[0],
		],
		['count', (releases) => preferred(releases.filter((r) => sum(discCounts(r)) === files))[0]],
		[
			'titles',
			(releases) =>
				preferred(releases.filter((r) => sum(discCounts(r)) >= files))
					.map((release) => ({ release, covered: covered(release) }))
					.sort(
						(a, b) =>
							b.covered - a.covered ||
							sum(discCounts(a.release)) - sum(discCounts(b.release))
					)[0]?.release,
		],
	];
	const official = group.releases.filter((release) => release.status === 'Official');
	for (const releases of [official, group.releases]) {
		for (const [rule, find] of rules) {
			const found = find(releases);
			if (found) return { ...found, rule };
		}
	}
	const earliest = [...(official.length ? official : group.releases)].sort(
		(a, b) => date(a).localeCompare(date(b)) || digital(a) - digital(b)
	)[0];
	return earliest ? { ...earliest, rule: 'earliest' } : null;
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

/**
 * Disc 0: every other title the group's releases give its recordings, once
 * each, for files the chosen release does not title (see `matchTrackMetadata`),
 * numbered from `after` + 1.
 */
export function titlePool(
	mbid: string,
	group: MbReleaseGroup,
	releases: MbRelease[],
	chosen: { title: string }[],
	after = 0
) {
	const seen = new Set(chosen.map((track) => normalizeTitle(track.title)));
	return releases
		.flatMap((release) => enrichment(mbid, group, release).tracks)
		.filter((track) => {
			const key = normalizeTitle(track.title);
			return !seen.has(key) && !!seen.add(key);
		})
		.map((track, i) => ({ ...track, disc: 0, position: after + i + 1 }));
}

// Each costs a Lidarr request, half a second.
const ARTIST_POOL_ALBUMS = 40;

/**
 * Whether a torrent's audio files are likely a pack of its artist's albums
 * filed under one group: more than a few beyond the chosen release's tracks,
 * and an artist to ask for, not Various Artists.
 */
export const isArtistPack = (
	files: number,
	tracks: number,
	artist: { mbid: string | null; name: string }
) => files > tracks + 3 && !!artist.mbid && !/^various artists$/i.test(artist.name.trim());

/**
 * The ids of at most 40 of an artist's groups to title a pack of theirs from:
 * those whose title one of `names` holds (the album's titles, the pack's
 * folders: "Please Please Me / Ask Me Why", "(1971) - The Doors - Other
 * Voices") first, then official studio albums, then other official groups,
 * then the rest, each oldest first. Never `except`, the group itself.
 */
export function artistPoolAlbums(
	albums: LidarrArtistAlbum[],
	except: string,
	names: string[]
): string[] {
	const named = names.map(normalizeTitle).join('/');
	const rank = (album: LidarrArtistAlbum) => {
		const title = normalizeTitle(album.Title);
		if (title && named.includes(title)) return 0;
		if (!album.ReleaseStatuses?.includes('Official')) return 3;
		const studio =
			album.Type === 'Album' &&
			(album.SecondaryTypes ?? []).every((type) => type === 'Soundtrack');
		return studio ? 1 : 2;
	};
	return albums
		.filter((album) => album.Id !== except)
		.map((album) => ({
			id: album.Id,
			rank: rank(album),
			date: lidarrDate(album.ReleaseDate) ?? '9999',
		}))
		.sort((a, b) => a.rank - b.rank || a.date.localeCompare(b.date))
		.slice(0, ARTIST_POOL_ALBUMS)
		.map((album) => album.id);
}

/**
 * Every release of the artist's groups a pack filed under `album` may hold
 * (see `artistPoolAlbums`): Lidarr's artist, then each group, paced like every
 * Lidarr request. None when Lidarr has no such artist; a group that fails is
 * left out.
 */
export async function fetchArtistPoolReleases(
	artistMbid: string,
	album: { mbid: string; titles: string[] },
	paths: string[]
): Promise<MbRelease[]> {
	const albums = (await fetchLidarrArtist(artistMbid)) ?? [];
	const folders = [...new Set(paths.map(getDirectory))];
	const releases: MbRelease[] = [];
	for (const id of artistPoolAlbums(albums, album.mbid, [...album.titles, ...folders])) {
		const found = await fetchLidarrAlbum(id).catch(() => null);
		if (found) releases.push(...fromLidarr(found).releases);
	}
	return releases;
}
