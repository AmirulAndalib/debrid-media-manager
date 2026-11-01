import monkees from '@/test/fixtures/music/library-dc925f67cd67936b4a8fbeb17d6decb648fd3479.json';
import release from '@/test/fixtures/musicbrainz/release-08205eae-c9e3-4174-8d69-2a67d742a19c.json';
import dogsRelease from '@/test/fixtures/musicbrainz/release-99a48afd-1292-4076-a9b6-12818729eae8.json';
import dogsGroup from '@/test/fixtures/musicbrainz/release-group-0dc4835d-b21a-3612-bac6-ab1e782a1396.json';
import group from '@/test/fixtures/musicbrainz/release-group-4853b957-05f2-457b-ba47-18b2565abc69.json';
import monkeesGroup from '@/test/fixtures/musicbrainz/release-group-48e8b712-4f5d-34e0-9492-22f936854662.json';
import { discTrackCounts } from '@/utils/musicTracks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	enrichment,
	fetchRelease,
	fetchReleaseGroup,
	hasCaaCover,
	MbRelease,
	MbReleaseGroup,
	MUSICBRAINZ_USER_AGENT,
	pickRelease,
} from './musicBrainz';

// Green Day, ¡Tré! (2012): seven official releases, all 12 tracks but the
// Japanese one (13), recorded from musicbrainz.org on 2026-11-01.
const TRE = '4853b957-05f2-457b-ba47-18b2565abc69';
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

	it('backs off on 503 and 429, then reads', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response('', { status: 503 }))
			.mockResolvedValueOnce(
				new Response('', { status: 429, headers: { 'Retry-After': '3' } })
			)
			.mockResolvedValueOnce(json(group));
		const done = fetchReleaseGroup(TRE);
		await vi.runAllTimersAsync();
		expect((await done)?.id).toBe(TRE);
		expect(fetchMock).toHaveBeenCalledTimes(3);
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
					? { ...r, media: [{ 'track-count': 13 }, { 'track-count': 6 }] }
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
		expect(pickRelease(monkeesGroup as unknown as MbReleaseGroup, perDisc)?.id).toBe(
			'0c6324c1-5968-4675-84bc-8f20b44cabc4'
		);
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
		// David Bowie, Diamond Dogs: the group credits "David Bowie", the release
		// with the catalog's 11 tracks credits "Bowie" on every track.
		const DOGS = '0dc4835d-b21a-3612-bac6-ab1e782a1396';
		const picked = pickRelease(dogsGroup as unknown as MbReleaseGroup, [11]);
		expect(picked?.id).toBe('99a48afd-1292-4076-a9b6-12818729eae8');

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
