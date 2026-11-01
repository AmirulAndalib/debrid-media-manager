/**
 * Which of posters0…posters9.debridmediamanager.com serves a key, by its
 * digits: the spread DMM's movie and show posters have always used. The ten
 * hosts are Cloudflare-cached names for the public B2 bucket `posters`, where
 * `/<name>` is the object `metahub-<name>`.
 */
function posterHost(digits: number[]): string {
	let hash = 0;
	for (const digit of digits) {
		hash = (hash << 5) - hash + digit;
		hash = hash & hash;
	}
	return `https://posters${Math.abs(hash) % 10}.debridmediamanager.com`;
}

/** A movie's or show's poster, spread by its IMDb id's decimal digits. */
export const posterUrl = (imdbId: string) =>
	`${posterHost([...imdbId.replace(/[^0-9]/g, '')].map(Number))}/${imdbId}-small.jpg`;

/** An album's cover as the music backfill mirrors it, spread by its release group id's hex digits. */
export const albumArtUrl = (mbid: string) =>
	`${posterHost([...mbid.replace(/[^0-9a-f]/gi, '')].map((digit) => parseInt(digit, 16)))}/music-${mbid}.jpg`;

/** That cover's object in the `posters` bucket. */
export const albumArtObject = (mbid: string) => `metahub-music-${mbid}.jpg`;
