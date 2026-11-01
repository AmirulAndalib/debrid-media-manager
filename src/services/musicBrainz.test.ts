import lz2Album from '@/test/fixtures/lidarr/album-33b4653d-006e-3cc1-8afb-386b15a6cd6e.json';
import monkeesAlbum from '@/test/fixtures/lidarr/album-48e8b712-4f5d-34e0-9492-22f936854662.json';
import bebeSearch from '@/test/fixtures/lidarr/search-bebe-rexha-the-lost-songs.json';
import chopinSearch from '@/test/fixtures/lidarr/search-chopin-les-nocturnes.json';
import chopin from '@/test/fixtures/music/library-0380fe617494cfc4a0b969639ad8a277ab366478.json';
import bebe from '@/test/fixtures/music/library-1f254b553c732b3ed3d76144f438835283728777.json';
import lz2 from '@/test/fixtures/music/library-700d948d78ff200d34d643d4474365ea0b698fd7.json';
import monkees from '@/test/fixtures/music/library-dc925f67cd67936b4a8fbeb17d6decb648fd3479.json';
import darkSidePage0 from '@/test/fixtures/musicbrainz/browse-release-f5093c06-23e3-404f-aeaa-40f72885ee3a-offset-0.json';
import darkSidePage100 from '@/test/fixtures/musicbrainz/browse-release-f5093c06-23e3-404f-aeaa-40f72885ee3a-offset-100.json';
import release from '@/test/fixtures/musicbrainz/release-08205eae-c9e3-4174-8d69-2a67d742a19c.json';
import dogsRelease from '@/test/fixtures/musicbrainz/release-99a48afd-1292-4076-a9b6-12818729eae8.json';
import dogsGroup from '@/test/fixtures/musicbrainz/release-group-0dc4835d-b21a-3612-bac6-ab1e782a1396.json';
import group from '@/test/fixtures/musicbrainz/release-group-4853b957-05f2-457b-ba47-18b2565abc69.json';
import monkeesGroup from '@/test/fixtures/musicbrainz/release-group-48e8b712-4f5d-34e0-9492-22f936854662.json';
import darkSideGroup from '@/test/fixtures/musicbrainz/release-group-f5093c06-23e3-404f-aeaa-40f72885ee3a.json';
import { discTrackCounts, getFilename, normalizeTitle } from '@/utils/musicTracks';
import { albumArtUrl } from '@/utils/posterHost';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	enrichment,
	fetchLidarrAlbum,
	fetchRelease,
	fetchReleaseGroup,
	findLidarrAlbum,
	fromLidarr,
	hasCaaCover,
	LidarrAlbum,
	lidarrCoverRelease,
	MbRelease,
	MbReleaseGroup,
	MUSICBRAINZ_USER_AGENT,
	namesFiles,
	pickRelease,
	searchLidarrAlbums,
	servedCoverUrl,
	titlePool,
} from './musicBrainz';

// Green Day, ¡Tré! (2012): seven official releases, all 12 tracks but the
// Japanese one (13), recorded from musicbrainz.org on 2026-11-01.
const TRE = '4853b957-05f2-457b-ba47-18b2565abc69';
const MONKEES = '48e8b712-4f5d-34e0-9492-22f936854662';
// Lidarr's album answers, recorded 2026-11-01: every release with its tracks.
const monkeesLidarr = fromLidarr(monkeesAlbum as unknown as LidarrAlbum);
const lz2Lidarr = fromLidarr(lz2Album as unknown as LidarrAlbum);
const pathsOf = (library: { files: { path: string }[] }) => library.files.map((file) => file.path);
/** What the backfill hands `pickRelease` for a torrent's files. */
const pick = (lidarr: ReturnType<typeof fromLidarr>, library: { files: { path: string }[] }) =>
	pickRelease(
		lidarr.group,
		discTrackCounts(pathsOf(library)),
		pathsOf(library).map(getFilename),
		lidarr.releases
	);
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});

// Requests are paced across calls, so each test starts its clock well after
// the last one's requests.
let clock = Date.now();

describe('fetching', () => {
	const fetchMock = vi.fn();
	beforeEach(() => {
		vi.useFakeTimers({ now: (clock += 3_600_000) });
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('reads a real release group and release, naming the application', async () => {
		fetchMock.mockResolvedValueOnce(json(group)).mockResolvedValueOnce(json(release));
		const done = Promise.all([
			fetchReleaseGroup(TRE),
			fetchRelease('08205eae-c9e3-4174-8d69-2a67d742a19c'),
		]);
		await vi.runAllTimersAsync();
		const [readGroup, readRelease] = await done;

		expect(readGroup?.releases).toHaveLength(7);
		expect(readRelease?.media[0].tracks).toHaveLength(12);
		expect(fetchMock.mock.calls[0][0]).toBe(
			`https://musicbrainz.org/ws/2/release-group/${TRE}?inc=releases+media+artist-credits+genres&fmt=json`
		);
		expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe(MUSICBRAINZ_USER_AGENT);
	});

	it('asks at most once a second', async () => {
		fetchMock.mockImplementation(async () => json(group));
		const start = Date.now();
		const done = Promise.all([fetchReleaseGroup(TRE), fetchReleaseGroup(TRE)]);
		await vi.advanceTimersByTimeAsync(10);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.runAllTimersAsync();
		await done;
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
	});

	it('waits out a 503 or 429 as long as its Retry-After says, at most a minute, once', async () => {
		fetchMock
			.mockResolvedValueOnce(
				new Response('', { status: 503, headers: { 'Retry-After': '3' } })
			)
			.mockResolvedValueOnce(json(group));
		const start = Date.now();
		const done = fetchReleaseGroup(TRE);
		await vi.advanceTimersByTimeAsync(2_900);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.runAllTimersAsync();
		expect((await done)?.id).toBe(TRE);
		expect(Date.now() - start).toBeGreaterThanOrEqual(3_000);

		fetchMock
			.mockResolvedValueOnce(
				new Response('', { status: 429, headers: { 'Retry-After': '3600' } })
			)
			.mockResolvedValueOnce(json(group));
		const capped = Date.now();
		const late = fetchReleaseGroup(TRE);
		await vi.runAllTimersAsync();
		expect((await late)?.id).toBe(TRE);
		expect(Date.now() - capped).toBeLessThanOrEqual(61_000);

		fetchMock
			.mockResolvedValueOnce(new Response('', { status: 503 }))
			.mockResolvedValueOnce(new Response('', { status: 503 }));
		const refused = fetchReleaseGroup(TRE).catch((error: Error) => error.message);
		await vi.runAllTimersAsync();
		expect(await refused).toMatch(/503/);
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	it('reads a 404 as not there and refuses other failures', async () => {
		fetchMock.mockResolvedValueOnce(json({ error: 'Not Found' }, 404));
		const missing = fetchReleaseGroup(TRE);
		await vi.runAllTimersAsync();
		expect(await missing).toBeNull();

		fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
		const failed = fetchReleaseGroup(TRE).catch((error: Error) => error.message);
		await vi.runAllTimersAsync();
		expect(await failed).toMatch(/500/);
	});

	it('browses every release of a group its lookup cuts off at 25, 100 at a time', async () => {
		// The Dark Side of the Moon: the lookup lists 25 of its 152 releases.
		const DARK_SIDE = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
		fetchMock
			.mockResolvedValueOnce(json(darkSideGroup))
			.mockResolvedValueOnce(json(darkSidePage0))
			.mockResolvedValueOnce(json(darkSidePage100));
		const done = fetchReleaseGroup(DARK_SIDE);
		await vi.runAllTimersAsync();
		const read = await done;

		expect(darkSideGroup.releases).toHaveLength(25);
		expect(read?.releases).toHaveLength(152);
		expect(new Set(read?.releases.map((release) => release.id)).size).toBe(152);
		expect(read?.title).toBe('The Dark Side of the Moon');
		expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
			`https://musicbrainz.org/ws/2/release?release-group=${DARK_SIDE}&inc=media&limit=100&offset=0&fmt=json`,
			`https://musicbrainz.org/ws/2/release?release-group=${DARK_SIDE}&inc=media&limit=100&offset=100&fmt=json`,
		]);
	});

	it("asks Lidarr's metadata server at most twice a second, naming the application", async () => {
		fetchMock.mockImplementation(async () => json(monkeesAlbum));
		const start = Date.now();
		const done = Promise.all([fetchLidarrAlbum(MONKEES), fetchLidarrAlbum(MONKEES)]);
		await vi.advanceTimersByTimeAsync(10);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.runAllTimersAsync();
		const [album] = await done;

		expect(Date.now() - start).toBeGreaterThanOrEqual(500);
		expect(album?.Releases).toHaveLength(59);
		expect(fetchMock.mock.calls[0][0]).toBe(
			`https://api.lidarr.audio/api/v0.4/album/${MONKEES}`
		);
		expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe(MUSICBRAINZ_USER_AGENT);
	});

	it('reads a group Lidarr does not have as none, and searches it by name', async () => {
		const DELETED = '8b53ab6b-21df-491a-8023-2c8d93976c9d';
		fetchMock
			.mockResolvedValueOnce(
				json({ error: `Couldn't find album ${DELETED}` }, 404) // as answered 2026-11-01
			)
			.mockResolvedValueOnce(json(chopinSearch.albums));
		const missing = fetchLidarrAlbum(DELETED);
		await vi.runAllTimersAsync();
		expect(await missing).toBeNull();

		const found = searchLidarrAlbums('Chopin Les Nocturnes');
		await vi.runAllTimersAsync();
		expect((await found).map((album) => album.title)[0]).toBe('Les nocturnes');
		expect(fetchMock.mock.calls[1][0]).toBe(
			'https://api.lidarr.audio/api/v0.4/search?type=album&query=Chopin%20Les%20Nocturnes'
		);

		fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }));
		const failed = fetchLidarrAlbum(MONKEES).catch((error: Error) => error.message);
		await vi.runAllTimersAsync();
		expect(await failed).toMatch(/502/);
	});

	it('finds Cover Art Archive art by its redirect', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 307 }));
		expect(await hasCaaCover(TRE)).toBe(true);
		expect(fetchMock.mock.calls[0][0]).toBe(
			`https://coverartarchive.org/release-group/${TRE}/front-500`
		);
		expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'HEAD', redirect: 'manual' });

		fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
		expect(await hasCaaCover(TRE)).toBe(false);
		fetchMock.mockRejectedValueOnce(new Error('timeout'));
		expect(await hasCaaCover(TRE)).toBe(false);
		expect(await hasCaaCover('abc-123')).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

describe('pickRelease', () => {
	const rg = group as unknown as MbReleaseGroup;

	it('takes the earliest official release with as many tracks as the catalog has files', () => {
		expect(pickRelease(rg, [12])?.id).toBe('08205eae-c9e3-4174-8d69-2a67d742a19c');
		expect(pickRelease(rg, [13])?.id).toBe('5f0eb95b-46e2-4e67-865c-a7a35f8cbde0');
	});

	it('takes the earliest official release when none has that many tracks', () => {
		expect(pickRelease(rg, [147])?.id).toBe('08205eae-c9e3-4174-8d69-2a67d742a19c');
	});

	it('prefers a release with as many tracks on each disc as the files', () => {
		// Diamond Dogs: eleven-track releases from 1974, the 2004 2CD edition with 11 and 8.
		const dogs = dogsGroup as unknown as MbReleaseGroup;
		expect(pickRelease(dogs, [11, 8])?.id).toBe('0600b408-8033-4baf-955f-da4253fb7418');
		// Over an earlier release with as many tracks in all, laid out otherwise.
		const reshaped = {
			...dogs,
			releases: dogs.releases.map((r) =>
				r.id === '54a293fc-d5bd-4925-94b3-62fd833d6c7b'
					? {
							...r,
							media: [
								{ 'track-count': 13, format: 'CD' },
								{ 'track-count': 6, format: 'CD' },
							],
						}
					: r
			),
		};
		expect(pickRelease(reshaped, [19])?.id).toBe('54a293fc-d5bd-4925-94b3-62fd833d6c7b');
		expect(pickRelease(reshaped, [11, 8])?.id).toBe('0600b408-8033-4baf-955f-da4253fb7418');
	});

	it('keeps the earliest album for a deluxe set no release lays out the same way', () => {
		// The Monkees' 4-disc set: 12, 16, 18 and 15 files. MusicBrainz lists 25
		// of the group's 60 releases, every one a 12-track 1966 or 1967 album.
		const perDisc = discTrackCounts(monkees.files.map((file) => file.path));
		expect(perDisc).toEqual([12, 16, 18, 15]);
		expect(pickRelease(monkeesGroup as unknown as MbReleaseGroup, perDisc)).toMatchObject({
			id: '0c6324c1-5968-4675-84bc-8f20b44cabc4',
			rule: 'earliest',
		});
	});

	it("takes the smallest release big enough whose titles name the most files, from Lidarr's every release", () => {
		// Lidarr lists all 59 releases with their tracks; the only one with 61 or
		// more is the 2014 3CD super deluxe edition, 100 tracks, which names the
		// stereo and mono mixes, TV versions and backing tracks the torrent holds.
		expect(pick(monkeesLidarr, monkees)).toMatchObject({
			id: '0e371fce-6068-4979-a312-3cd5251da630',
			rule: 'titles',
		});
	});

	it('takes a 2-disc deluxe edition laid out as the files, a CD over vinyl', () => {
		// Led Zeppelin II, Disc 1 with 9 files and Disc 2 with 8: the 2014
		// deluxe editions; the 9-track album was taken before (census 2026-11-01).
		expect(discTrackCounts(pathsOf(lz2))).toEqual([9, 8]);
		const picked = pick(lz2Lidarr, lz2);
		expect(picked).toMatchObject({
			id: 'a650ab1f-283d-4630-9e44-69d8d099144a',
			rule: 'layout',
		});
		expect(picked?.media?.map((medium) => medium.format)).toEqual(['CD', 'CD']);
		// Diamond Dogs' 11 tracks: the 1984 CD over the 1974 vinyl, which is earlier.
		expect(pickRelease(group as unknown as MbReleaseGroup, [12])?.rule).toBe('layout');
		expect(pickRelease(dogsGroup as unknown as MbReleaseGroup, [11])).toMatchObject({
			id: '4f00baf4-c11c-41dc-bdca-4267180077f7',
			date: '1984',
		});
	});

	it('takes a release with as many tracks in all when none is laid out the same', () => {
		const rg = group as unknown as MbReleaseGroup;
		const twoDiscs = {
			...rg,
			releases: rg.releases.map((r) =>
				r.id === '5f0eb95b-46e2-4e67-865c-a7a35f8cbde0'
					? {
							...r,
							media: [
								{ 'track-count': 6, format: 'CD' },
								{ 'track-count': 7, format: 'CD' },
							],
						}
					: r
			),
		};
		expect(pickRelease(twoDiscs, [13])).toMatchObject({
			id: '5f0eb95b-46e2-4e67-865c-a7a35f8cbde0',
			rule: 'count',
		});
	});

	it('takes an unofficial release laid out as the files over none', () => {
		// Bebe Rexha, The Lost Songs: one bootleg of 17 tracks.
		const found = fromLidarr(bebeSearch.albums[0] as unknown as LidarrAlbum);
		expect(pick(found, bebe)).toMatchObject({ status: 'Bootleg', rule: 'layout' });
	});

	it('takes an unofficial release only when there is no official one', () => {
		const bootlegs = {
			...rg,
			releases: rg.releases.map((r) => ({ ...r, status: 'Bootleg' })).reverse(),
		};
		expect(pickRelease(bootlegs, [147])?.id).toBe('08205eae-c9e3-4174-8d69-2a67d742a19c');
		expect(pickRelease({ ...rg, releases: [] }, [12])).toBeNull();
	});
});

describe('enrichment', () => {
	const rg = group as unknown as MbReleaseGroup;
	const rel = release as unknown as MbRelease;

	it('maps a real release group and release onto the catalog', () => {
		const { metadata, tracks, artists } = enrichment(TRE, rg, rel);
		expect(metadata).toEqual({
			artist: 'Green Day',
			album: '¡Tré!',
			artistMbid: '084308bd-1654-436f-ba03-df6697104e19',
			primaryType: 'Album',
			genres: ['pop punk', 'alternative rock', 'rock', 'power pop'],
			firstReleaseDate: '2012-12-04',
			mbTrackCount: 12,
			mbReleaseId: '08205eae-c9e3-4174-8d69-2a67d742a19c',
		});
		expect(tracks).toHaveLength(12);
		expect(tracks[0]).toEqual({
			mbid: TRE,
			disc: 1,
			position: 1,
			title: 'Brutal Love',
			lengthMs: 294746,
			recordingMbid: '3953235a-289b-4cdf-b184-42ce3af56c68',
			artist: null,
		});
		expect(artists).toEqual([
			{
				mbid: '084308bd-1654-436f-ba03-df6697104e19',
				name: 'Green Day',
				sortName: 'Green Day',
			},
		]);
	});

	it('files a compilation as one and credits a guest on the track', () => {
		const compilation = { ...rg, 'secondary-types': ['Compilation'] };
		const guest: MbRelease = JSON.parse(JSON.stringify(rel));
		guest.media[0].tracks![1]['artist-credit'] = [
			{ name: 'Green Day', joinphrase: ' feat. ', artist: rg['artist-credit'][0].artist },
			{
				name: 'Guest',
				artist: {
					id: '00000000-0000-0000-0000-000000000001',
					name: 'Guest',
					'sort-name': 'Guest',
				},
			},
		];
		const { metadata, tracks } = enrichment(TRE, compilation, guest);
		expect(metadata.primaryType).toBe('Compilation');
		expect(tracks[1].artist).toBe('Green Day feat. Guest');
	});

	it('credits a track to another artist only, not to another name for the same one', () => {
		// David Bowie, Diamond Dogs: the group credits "David Bowie", its 1974
		// vinyl release of the 11 tracks credits "Bowie" on every track.
		const DOGS = '0dc4835d-b21a-3612-bac6-ab1e782a1396';
		const { metadata, tracks } = enrichment(
			DOGS,
			dogsGroup as unknown as MbReleaseGroup,
			dogsRelease as unknown as MbRelease
		);
		expect(metadata).toMatchObject({ artist: 'David Bowie', firstReleaseDate: '1974-05-24' });
		expect(tracks).toHaveLength(11);
		expect(tracks.map((track) => track.artist)).toEqual(Array(11).fill(null));
	});

	it('keeps the group without a release', () => {
		const { metadata, tracks } = enrichment(TRE, rg, null);
		expect(metadata).toMatchObject({
			mbTrackCount: null,
			mbReleaseId: null,
			primaryType: 'Album',
		});
		expect(tracks).toEqual([]);
	});
});

describe("Lidarr's albums", () => {
	it('shape as MusicBrainz release groups and releases, every release with its tracks', () => {
		const { group: rg, releases } = monkeesLidarr;
		expect(rg).toMatchObject({
			id: MONKEES,
			title: 'The Monkees',
			'primary-type': 'Album',
			'first-release-date': '1966-10-10',
			genres: [
				{ name: 'pop rock', count: 4 },
				{ name: 'rock', count: 3 },
				{ name: 'pop', count: 2 },
				{ name: 'sunshine pop', count: 1 },
			],
			'artist-credit': [
				{
					name: 'The Monkees',
					artist: {
						id: 'b8549efe-f4fd-4dc0-8ef1-226e9c400233',
						'sort-name': 'Monkees, The',
					},
				},
			],
		});
		expect(rg.releases).toHaveLength(59);
		expect(releases).toHaveLength(59);
		const superDeluxe = rg.releases.find(
			(release) => release.id === '0e371fce-6068-4979-a312-3cd5251da630'
		);
		expect(superDeluxe?.media?.map((medium) => medium['track-count'])).toEqual([36, 31, 33]);

		const { metadata, tracks } = enrichment(
			MONKEES,
			rg,
			releases.find((release) => release.id === superDeluxe?.id)!
		);
		expect(metadata).toMatchObject({
			artist: 'The Monkees',
			artistMbid: 'b8549efe-f4fd-4dc0-8ef1-226e9c400233',
			primaryType: 'Album',
			mbTrackCount: 100,
			mbReleaseId: '0e371fce-6068-4979-a312-3cd5251da630',
		});
		expect(tracks[0]).toEqual({
			mbid: MONKEES,
			disc: 1,
			position: 1,
			title: '(Theme From) The Monkees (mono mix)',
			lengthMs: 143933,
			recordingMbid: '5760621b-94c3-44b6-a470-491e56828f34',
			artist: null,
		});
		expect(tracks.at(-1)).toMatchObject({ disc: 3, position: 33 });
		// Lidarr's cover is a Cover Art Archive release's.
		expect(lidarrCoverRelease(monkeesAlbum as unknown as LidarrAlbum)).toBe(
			'9f4bad72-4b43-45c4-9de8-11066ecc7efd'
		);
	});

	it("pool every other release's titles under disc 0, once each, none of the chosen release's", () => {
		const { group: rg, releases } = monkeesLidarr;
		const chosen = enrichment(
			MONKEES,
			rg,
			releases.find((release) => release.id === '0e371fce-6068-4979-a312-3cd5251da630')!
		).tracks;
		const pool = titlePool(MONKEES, rg, releases, chosen);

		expect(pool.every((track) => track.disc === 0)).toBe(true);
		expect(pool.map((track) => track.position)).toEqual(pool.map((_, i) => i + 1));
		const keys = pool.map((track) => normalizeTitle(track.title));
		expect(new Set(keys).size).toBe(pool.length);
		expect(
			keys.some((key) => chosen.some((track) => normalizeTitle(track.title) === key))
		).toBe(false);
		// The plain album's and the 2006 deluxe edition's names for the recordings.
		expect(pool.map((track) => track.title)).toEqual(
			expect.arrayContaining([
				'(Theme From) The Monkees',
				"Saturday's Child",
				'(Theme From) The Monkees (second recorded version)',
				'Propinquity (I’ve Just Begun to Care) (demo version)',
			])
		);
		expect(pool.find((track) => track.title === '(Theme From) The Monkees')).toMatchObject({
			mbid: MONKEES,
			lengthMs: null,
			recordingMbid: '5760621b-94c3-44b6-a470-491e56828f34',
		});
	});

	it('find a group MusicBrainz deleted by its title and artist, by name, alias or id', () => {
		// The catalog files Les Nocturnes under "Chopin"; Lidarr's artist is
		// "Fryderyk Chopin", with "Chopin" among the aliases.
		const albums = chopinSearch.albums as unknown as LidarrAlbum[];
		const wanted = { artist: 'Chopin', album: 'Les Nocturnes', artistMbid: null };
		expect(findLidarrAlbum(albums, wanted)?.id).toBe('618a6e0e-fc14-41d5-92d4-b8592b29883f');
		expect(
			findLidarrAlbum(albums, {
				...wanted,
				artist: 'Frédéric François Chopin',
				artistMbid: '09ff1fe8-d61c-4b98-bb82-18487c74d7b7',
			})?.id
		).toBe('618a6e0e-fc14-41d5-92d4-b8592b29883f');
		expect(findLidarrAlbum(albums, { ...wanted, album: 'Nocturnes' })).toBeNull();

		const songs = bebeSearch.albums as unknown as LidarrAlbum[];
		expect(
			findLidarrAlbum(songs, {
				artist: 'BEBE REXHA',
				album: 'the lost songs',
				artistMbid: null,
			})?.id
		).toBe('16bf2afc-c40b-4ca1-a021-d27ac9eb7b6c');
	});

	it('take a release found by name only when its titles name the files', () => {
		// Les Nocturnes: Aldo Ciccolini's 21 nocturnes, "Nocturne no. 1"…, while
		// the files run "Nocturne op 48 … N 1", "op 15"…: the same count, another order.
		const nocturnes = fromLidarr(
			findLidarrAlbum(chopinSearch.albums as unknown as LidarrAlbum[], chopin)!
		);
		const picked = pick(nocturnes, chopin);
		expect(picked).toMatchObject({ id: '7f33b396-5ac5-4a0b-b577-46331a315538', rule: 'count' });
		const filenames = pathsOf(chopin).map(getFilename);
		expect(
			namesFiles(
				nocturnes.releases.find((release) => release.id === picked?.id)!,
				filenames
			)
		).toBe(false);

		const songs = fromLidarr(bebeSearch.albums[0] as unknown as LidarrAlbum);
		expect(namesFiles(songs.releases[0], pathsOf(bebe).map(getFilename))).toBe(true);
		expect(namesFiles(songs.releases[0], [])).toBe(false);
	});
});

describe('servedCoverUrl', () => {
	it("hands out a cover copied to the posters hosts as it is, an archive group's through DMM's cache", () => {
		const mirrored = albumArtUrl(MONKEES);
		expect(servedCoverUrl(mirrored)).toBe(mirrored);
		expect(
			servedCoverUrl(`https://coverartarchive.org/release-group/${MONKEES}/front-500`)
		).toBe(`/api/music/cover/${MONKEES}.jpg`);
		const release =
			'https://coverartarchive.org/release/9f4bad72-4b43-45c4-9de8-11066ecc7efd/front-500';
		expect(servedCoverUrl(release)).toBe(release);
		expect(servedCoverUrl(null)).toBeNull();
	});
});
