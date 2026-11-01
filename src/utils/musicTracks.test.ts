import {
	enrichment,
	fromLidarr,
	LidarrAlbum,
	MbRelease,
	MbReleaseGroup,
	titlePool,
} from '@/services/musicBrainz';
import monkeesAlbum from '@/test/fixtures/lidarr/album-48e8b712-4f5d-34e0-9492-22f936854662.json';
import monkees from '@/test/fixtures/music/library-dc925f67cd67936b4a8fbeb17d6decb648fd3479.json';
import catalog from '@/test/fixtures/musicbrainz/catalog-2026-11-01.json';
import release from '@/test/fixtures/musicbrainz/release-08205eae-c9e3-4174-8d69-2a67d742a19c.json';
import group from '@/test/fixtures/musicbrainz/release-group-4853b957-05f2-457b-ba47-18b2565abc69.json';
import { describe, expect, it } from 'vitest';
import {
	formatTrackTitle,
	getFilename,
	isAudioPath,
	matchTrackMetadata,
	trackPosition,
} from './musicTracks';

const TRE = '4853b957-05f2-457b-ba47-18b2565abc69';
// ¡Tré!'s real tracklist, as the backfill stores it.
const tracklist = enrichment(
	TRE,
	group as unknown as MbReleaseGroup,
	release as unknown as MbRelease
).tracks;
// ¡Tré!'s real files, as the catalog holds them: "/01.Brutal Love.flac"…
const treFiles = catalog.files['3237449d26653635ed3b3a0afb563b1087d5597b'].map((file) => ({
	trackNumber: file.trackNumber,
	filename: getFilename(file.path),
}));

const titles = (matches: ({ title: string } | null)[]) => matches.map((m) => m?.title ?? null);

describe('matchTrackMetadata', () => {
	it('matches by position when the counts agree', () => {
		const matches = matchTrackMetadata(treFiles, [...tracklist].reverse());
		expect(matches[0]).toMatchObject({ title: 'Brutal Love', lengthMs: 294746 });
		expect(titles(matches)).toEqual(tracklist.map((track) => track.title));
	});

	it('matches by track number when a file has no counterpart', () => {
		const files = [...treFiles, { trackNumber: 13, filename: '13.Bonus Demo.flac' }];
		const matches = matchTrackMetadata(files, tracklist);
		expect(titles(matches)).toEqual([...tracklist.map((track) => track.title), null]);
	});

	it('falls back to the title when track numbers repeat, as in a box set', () => {
		const files = [
			{ trackNumber: 1, filename: '01 Brutal Love (Remastered).flac' },
			{ trackNumber: 1, filename: '01 Brutal Love.flac' },
			{ trackNumber: 2, filename: '02 Something Else Entirely.flac' },
		];
		expect(titles(matchTrackMetadata(files, tracklist))).toEqual([null, 'Brutal Love', null]);
	});

	it('falls back to the title on a multi-disc tracklist', () => {
		const twoDiscs = [
			{ disc: 1, position: 1, title: 'Intro' },
			{ disc: 2, position: 1, title: 'Outro' },
			{ disc: 2, position: 2, title: 'Reprise' },
		];
		expect(
			titles(matchTrackMetadata([{ trackNumber: 1, filename: '01 - Outro.flac' }], twoDiscs))
		).toEqual(['Outro']);
	});

	it('matches by disc and track number when the files name their discs', () => {
		const twoDiscs = [
			{ disc: 1, position: 1, title: 'Intro' },
			{ disc: 1, position: 2, title: 'Song' },
			{ disc: 2, position: 1, title: 'Outro' },
		];
		const files = [
			{ disc: 1, trackNumber: 1, filename: '01_01 - a.flac' },
			{ disc: 2, trackNumber: 1, filename: '02_01 - b.flac' },
			{ disc: 3, trackNumber: 1, filename: '03_01 - Song.flac' },
			{ disc: 3, trackNumber: 2, filename: '03_02 - c.flac' },
		];
		expect(titles(matchTrackMetadata(files, twoDiscs))).toEqual([
			'Intro',
			'Outro',
			'Song',
			null,
		]);
		// Two files claiming one disc and number: neither is trusted.
		const twice = [files[0], { ...files[1], disc: 1 }, files[2], files[3]];
		expect(titles(matchTrackMetadata(twice, twoDiscs))).toEqual([null, null, 'Song', null]);
	});

	describe("The Monkees' 4-disc set against Lidarr's tracklists of the group", () => {
		// 12, 16, 18 and 15 files: stereo mixes, mono mixes, TV versions, backing tracks.
		const files = monkees.files.map((file) => {
			const { disc, track } = trackPosition(file.path, file.trackNumber);
			return { disc, trackNumber: track, filename: getFilename(file.path) };
		});
		const lidarr = fromLidarr(monkeesAlbum as unknown as LidarrAlbum);
		const tracksOf = (id: string) =>
			enrichment(
				monkees.mbid,
				lidarr.group,
				lidarr.releases.find((r) => r.id === id)!
			).tracks;
		// 2014 super deluxe edition: 36 + 31 + 33 tracks, another layout than the files'.
		const superDeluxe = tracksOf('0e371fce-6068-4979-a312-3cd5251da630');
		const at = (name: string) => files.findIndex((file) => file.filename.startsWith(name));

		it("does not number a disc by a release laid out otherwise, but by the files' names", () => {
			const matched = titles(matchTrackMetadata(files, superDeluxe));
			expect(matched[at('01_01')]).toBe('(Theme From) The Monkees (stereo mix)');
			expect(matched[at('02_01')]).toBe('(Theme From) The Monkees (mono mix)');
			expect(matched[at('03_01')]).toBe('Monkees NBC Promo Spot');
			// Disc 2's 14th track is a backing track of another song altogether.
			expect(superDeluxe.find((t) => t.disc === 2 && t.position === 14)?.title).toBe(
				'I Won’t Be the Same Without Her (stereo backing track – take 6)'
			);
			expect(matched[at('02_14')]).toBeNull(); // I Wanna Be Free (Demo - Take Twelve)
			expect(matched[at('03_11')]).toBeNull(); // All the King's Horses (Alternate Vocal Take)
		});

		it('titles no file that two differently named tracks fit equally', () => {
			// "Version Two - Backing Track Take Six" is as far from "(version 2) … take 6"
			// as from "(version 3) … take 3".
			expect(titles(matchTrackMetadata(files, superDeluxe))[at('04_08')]).toBeNull();
		});

		it('titles what the 12-track album leaves from the other releases, by the same name only', () => {
			const album = tracksOf('0c6324c1-5968-4675-84bc-8f20b44cabc4');
			const pool = titlePool(monkees.mbid, lidarr.group, lidarr.releases, album);
			const matches = matchTrackMetadata(files, [...album, ...pool]);

			// Disc 1 is the album, by disc and position, as before.
			expect(titles(matches.slice(0, 12))).toEqual(album.map((t) => t.title));
			expect(titles(matches.slice(12, 16))).toEqual([
				'(Theme From) The Monkees (mono mix)',
				'Saturday’s Child (mono mix)',
				'I Wanna Be Free (mono mix)',
				'Tomorrow’s Gonna Be Another Day (mono mix)',
			]);
			expect(matches[12]).toMatchObject({ disc: 0, recordingMbid: expect.any(String) });
			// "(Rehearsal)" is close to the pool's "(rehearsal) (mono)", not the same.
			expect(matches[at('02_13')]).toBeNull();
			expect(titles(matches).filter(Boolean)).toHaveLength(36);
		});
	});

	it('leaves every file unmatched without a tracklist', () => {
		expect(matchTrackMetadata(treFiles.slice(0, 2), [])).toEqual([null, null]);
	});
});

describe('trackPosition', () => {
	it('reads the disc and track of a disc-prefixed name, not the disc as the track', () => {
		// The Monkees' 4-disc set: "/Disc 01/01_01 - …" to "/Disc 04/04_15 - …",
		// each file stored with its disc as its track number.
		const read = monkees.files.map((file) => trackPosition(file.path, file.trackNumber));
		expect(read.slice(10, 14)).toEqual([
			{ disc: 1, track: 11 },
			{ disc: 1, track: 12 },
			{ disc: 2, track: 1 },
			{ disc: 2, track: 2 },
		]);
		expect(read.at(-1)).toEqual({ disc: 4, track: 15 });
	});

	it.each([
		['/1-07 Song.flac', null, { disc: 1, track: 7 }],
		['/02-03 - Song.flac', null, { disc: 2, track: 3 }],
		['/05-21 Guns.flac', 5, { disc: null, track: 5 }],
		['/CD2/03 - Song.flac', 3, { disc: 2, track: 3 }],
		['/Album/Disc 2/203 - Song.flac', 203, { disc: 2, track: 3 }],
		['/Disc 1/01 Blackened (Remastered).flac', 1, { disc: 1, track: 1 }],
		['/Discovery/01 - One More Time.flac', 1, { disc: null, track: 1 }],
		['/01.Brutal Love.flac', 1, { disc: null, track: 1 }],
		['/Song.flac', null, { disc: null, track: null }],
	])('reads %s', (path, stored, position) => {
		expect(trackPosition(path, stored)).toEqual(position);
	});
});

describe('track helpers', () => {
	it('titles a file from its name', () => {
		expect(formatTrackTitle('01.Brutal Love.flac')).toBe('Brutal Love');
		expect(formatTrackTitle('03_01 - Monkees NBC Promo Spot.flac')).toBe(
			'Monkees NBC Promo Spot'
		);
	});

	it('reads a name without the album artist, before or after its number', () => {
		// Names from the catalog (census 2026-11-01).
		expect(formatTrackTitle("12. Adele - Can't Let Go.flac", 'Adele')).toBe("Can't Let Go");
		expect(
			formatTrackTitle(
				"17 - Sick Puppies - There's No Going Back (Acoustic).mp3",
				'Sick Puppies'
			)
		).toBe("There's No Going Back (Acoustic)");
		expect(formatTrackTitle('001. Enigma - The Voice Of Enigma.flac', 'Enigma')).toBe(
			'The Voice Of Enigma'
		);
		expect(formatTrackTitle('01 Blackened (Remastered).flac')).toBe('Blackened (Remastered)');
		// The other shapes, case and accents aside.
		expect(formatTrackTitle('ADELE - 12 - Lay Me Down.flac', 'Adele')).toBe('Lay Me Down');
		expect(formatTrackTitle('01 - Beyonce \u2013 Halo.flac', 'Beyoncé')).toBe('Halo');
		expect(formatTrackTitle('01-the_beatles-help.mp3', 'The Beatles')).toBe('help');
		// A title's own number, or the artist's name as a title, stays.
		expect(formatTrackTitle('05 - 21 Guns.flac', 'Green Day')).toBe('21 Guns');
		expect(formatTrackTitle('Green Day - 21 Guns.flac', 'Green Day')).toBe('21 Guns');
		expect(formatTrackTitle('03 - Adele.flac', 'Adele')).toBe('Adele');
		expect(formatTrackTitle('01 - Lovesong.flac', 'Love')).toBe('Lovesong');
	});

	it('counts anything but a known sidecar as audio', () => {
		expect(isAudioPath('/Disc 1/01 Blackened.flac')).toBe(true);
		expect(isAudioPath('/Scans/front.JPG')).toBe(false);
		expect(isAudioPath('/README')).toBe(true);
	});
});
