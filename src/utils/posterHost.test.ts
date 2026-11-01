import { describe, expect, it } from 'vitest';
import { albumArtObject, albumArtUrl, posterUrl } from './posterHost';

describe('poster hosts', () => {
	it('spreads posters over the ten hosts as poster.tsx always has', () => {
		// The original getPosterUrl's answers, computed from its code before the move.
		expect(['tt0111161', 'tt0068646', 'tt9999999999', 'tt0000001'].map(posterUrl)).toEqual([
			'https://posters1.debridmediamanager.com/tt0111161-small.jpg',
			'https://posters0.debridmediamanager.com/tt0068646-small.jpg',
			'https://posters0.debridmediamanager.com/tt9999999999-small.jpg',
			'https://posters1.debridmediamanager.com/tt0000001-small.jpg',
		]);
	});

	it('names an album cover by its release group, spread by its hex digits', () => {
		const mbid = '48e8b712-4f5d-34e0-9492-22f936854662';
		expect(albumArtUrl(mbid)).toMatch(
			/^https:\/\/posters\d\.debridmediamanager\.com\/music-48e8b712-4f5d-34e0-9492-22f936854662\.jpg$/
		);
		// Cloudflare reads /<name> on a posters host as the bucket object metahub-<name>.
		expect(albumArtObject(mbid)).toBe(`metahub-${albumArtUrl(mbid).split('/').pop()}`);
		const hosts = new Set(
			[
				mbid,
				'33b4653d-006e-3cc1-8afb-386b15a6cd6e',
				'16bf2afc-c40b-4ca1-a021-d27ac9eb7b6c',
				'4853b957-05f2-457b-ba47-18b2565abc69',
				'0dc4835d-b21a-3612-bac6-ab1e782a1396',
				'f5093c06-23e3-404f-aeaa-40f72885ee3a',
			].map((id) => new URL(albumArtUrl(id)).host)
		);
		expect(hosts.size).toBeGreaterThan(1);
	});
});
