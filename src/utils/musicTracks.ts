import { distance } from 'fastest-levenshtein';

// Shared by the music API and the player components, so nothing here may reach
// the database.

const nonAudioExtensions = [
	'.jpg',
	'.jpeg',
	'.png',
	'.gif',
	'.txt',
	'.nfo',
	'.cue',
	'.log',
	'.m3u',
	'.pdf',
	'.md5',
	'.sfv',
];

/** Anything that is not a known sidecar counts as audio, an extensionless file included. */
export function isAudioPath(path: string): boolean {
	const lowerPath = path.toLowerCase();
	const lastDot = lowerPath.lastIndexOf('.');
	return lastDot < 0 || !nonAudioExtensions.includes(lowerPath.slice(lastDot));
}

export function getFilename(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1] || path;
}

export function getDirectory(path: string): string {
	return path.slice(0, path.lastIndexOf('/') + 1);
}

/** "01 - Song.flac", "01. Song.flac", "Track 01.flac", "[01] Song", "01) Song". */
export function extractTrackNumber(filename: string): number | null {
	const patterns = [
		/^(\d{1,3})\s*[-_.]\s*/,
		/^track\s*(\d{1,3})/i,
		/^\[(\d{1,3})\]/,
		/^(\d{1,3})\)/,
	];

	for (const pattern of patterns) {
		const match = filename.match(pattern);
		if (match) {
			return parseInt(match[1], 10);
		}
	}
	return null;
}

// A disc, then the track: "01_01 - Song", "1-01 Song", "01-01 - Song"; never "05-21 Guns".
const DISC_TRACK = [
	/^(\d{1,2})_(\d{1,3})(?!\d)/,
	/^(\d)-(\d{2})(?!\d)/,
	/^(\d{2})-(\d{2})(?=\s*[-.])/,
];
const DISC_FOLDER = /\b(?:cd|dis[ck])\s*0*(\d+)/i;

/**
 * The disc and track a file's path names: "01_01 - Song", "1-01 Song", or a
 * "CD1" / "Disc 2" folder with "02 - Song" or "202 - Song" in it. `stored` is
 * the catalog's own number, for names this cannot read.
 */
export function trackPosition(
	path: string,
	stored: number | null
): { disc: number | null; track: number | null } {
	const filename = getFilename(path);
	const prefixed = DISC_TRACK.map((pattern) => pattern.exec(filename)).find(Boolean);
	if (prefixed) return { disc: +prefixed[1], track: +prefixed[2] };
	const folder = DISC_FOLDER.exec(getFilename(getDirectory(path).slice(0, -1)));
	const disc = folder ? +folder[1] : null;
	const track = extractTrackNumber(filename) ?? stored;
	// "Disc 2/201 - Song": the disc's number leads the track's.
	return disc && track && Math.floor(track / 100) === disc
		? { disc, track: track % 100 }
		: { disc, track };
}

/** Audio files per disc, in disc order: what a release's media should hold. */
export function discTrackCounts(paths: string[]): number[] {
	const counts = new Map<number, number>();
	for (const path of paths.filter(isAudioPath)) {
		const disc = trackPosition(path, null).disc ?? 1;
		counts.set(disc, (counts.get(disc) ?? 0) + 1);
	}
	return [...counts].sort(([a], [b]) => a - b).map(([, count]) => count);
}

export function removeExtension(filename: string): string {
	return filename.replace(/\.[^/.]+$/, '');
}

// "01 - ", "01. ", "01_01 - ", "[01] ", "01) ", "Track 01 ".
const withoutNumber = (title: string) =>
	title
		.replace(/^\s*\[(\d{1,3})\]\s*/, '')
		.replace(/^\s*(\d{1,2}[-_])?\d{1,3}\s*[-_.]\s*/, '')
		.replace(/^\s*\d{1,3}\)\s*/, '')
		.replace(/^\s*track\s*\d{1,3}\s*[-_.]?\s*/i, '')
		.trim();

/** Letters and digits only, lower case, accents aside. */
const fold = (text: string) => normalizeTitle(text.normalize('NFD'));

/** `title` after a leading "<artist> - ", alike in letters and digits; else `title`. */
function withoutArtist(title: string, artist: string): string {
	const wanted = fold(artist);
	let seen = '';
	for (let i = 0; wanted && seen.length < wanted.length && i < title.length; i++) {
		seen += fold(title[i]);
		if (seen === wanted) {
			return (
				title.slice(i + 1).match(/^\p{M}*[\s_]*[-\u2013\u2014][\s_]*(.+)/su)?.[1] ?? title
			);
		}
	}
	return title;
}

/**
 * For matching a file to its MusicBrainz track only: a title shown is
 * MusicBrainz's or none. The name without its track number and a leading
 * "<album artist> - ", in either order ("12. Adele - Song", "Adele - 12 - Song").
 */
export function formatTrackTitle(filename: string, artist?: string | null): string {
	const title = removeExtension(filename).trim();
	let formatted = withoutNumber(title);
	// "01 Song" only when nothing else numbers it: "05 - 21 Guns" keeps its 21.
	if (formatted === title) formatted = title.replace(/^\d{1,3}\s+/, '');
	const rest = artist ? withoutArtist(formatted, artist) : formatted;
	return (rest === formatted ? formatted : withoutNumber(rest)) || title;
}

export type TrackMetadata = { disc: number; position: number; title: string };

/** More than a few audio files beyond the release's tracks: a pack, its numbers other albums'. */
export const isReleasePack = (files: number, tracks: number) => files > tracks + 3;

const TITLE_SIMILARITY = 0.8;
export const normalizeTitle = (title: string) =>
	title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** A file's name as it is compared with titles (see `formatTrackTitle`). */
const nameKey = (filename: string, artist?: string | null) =>
	normalizeTitle(formatTrackTitle(filename, artist));
const similarity = (name: string, title: string) => {
	const b = normalizeTitle(title);
	return 1 - distance(name, b) / Math.max(name.length, b.length, 1);
};

/**
 * The track whose title is most like the file's name, at least `threshold`
 * alike, else null; null too when two differently named tracks fit it equally
 * ("Take Three" is as far from "take 3" as from "take 6").
 */
export function similarTitle<T extends TrackMetadata>(
	filename: string,
	tracks: T[],
	threshold = TITLE_SIMILARITY,
	artist?: string | null
): T | null {
	const name = nameKey(filename, artist);
	let best: T | null = null;
	let bestScore = threshold;
	let tied = false;
	for (const track of tracks) {
		const score = similarity(name, track.title);
		if (score > bestScore || (score === bestScore && !best)) {
			best = track;
			bestScore = score;
			tied = false;
		} else if (
			score === bestScore &&
			best &&
			normalizeTitle(track.title) !== normalizeTitle(best.title)
		) {
			tied = true;
		}
	}
	return tied ? null : best;
}

/**
 * The MusicBrainz track each file is, in the files' order (which must already
 * be album order), or null. Same count: by position. Otherwise by disc and
 * track number, but only when that cannot be ambiguous (the file names its
 * disc or the release has one, and no two files share both: a box set repeats
 * them album after album, and most of a disc's names do not fit other tracks
 * better: a release laid out otherwise), unless another track's title fits
 * the file's name better; then by title. A file still untitled may take a
 * disc-0 title, which is never a place on a disc. In a pack (`isReleasePack`)
 * neither positions nor numbers count: a file takes a release or disc-0 title
 * of its exact name, or none. Names are read without a leading "`artist` - "
 * (the album's).
 */
export function matchTrackMetadata<T extends TrackMetadata>(
	files: { disc?: number | null; trackNumber: number | null; filename: string }[],
	tracks: T[],
	artist?: string | null
): (T | null)[] {
	const release = tracks
		.filter((track) => track.disc > 0)
		.sort((a, b) => a.disc - b.disc || a.position - b.position);
	const pack = isReleasePack(files.length, release.length);
	// Disc 0 holds the titles of the group's other releases (and of the artist's
	// other groups, for a pack), so a file takes one only when the names agree outright.
	const byName = new Map<string, T>();
	for (const track of [...(pack ? release : []), ...tracks.filter((t) => t.disc === 0)]) {
		const key = normalizeTitle(track.title);
		if (!byName.has(key)) byName.set(key, track);
	}
	return (pack ? files.map(() => null) : matchRelease(files, release, artist)).map(
		(match, i) => match ?? byName.get(nameKey(files[i].filename, artist)) ?? null
	);
}

function matchRelease<T extends TrackMetadata>(
	files: { disc?: number | null; trackNumber: number | null; filename: string }[],
	tracks: T[],
	artist?: string | null
): (T | null)[] {
	const ordered = [...tracks].sort((a, b) => a.disc - b.disc || a.position - b.position);
	if (ordered.length === files.length) return ordered;
	if (ordered.length === 0) return files.map(() => null);

	const oneDisc = new Set(ordered.map((track) => track.disc)).size === 1;
	const keys = files.map((file) => {
		const disc = file.disc ?? (oneDisc ? ordered[0].disc : null);
		return disc === null || file.trackNumber === null ? null : `${disc}-${file.trackNumber}`;
	});
	const byNumber = new Set(keys).size === keys.length;
	const numbered = keys.map((key) =>
		byNumber ? ordered.find((track) => `${track.disc}-${track.position}` === key) : undefined
	);
	const titled = files.map((file) =>
		similarTitle(file.filename, ordered, TITLE_SIMILARITY, artist)
	);
	// A disc laid out otherwise than the release's: most of its files' names fit
	// other tracks than their numbers give, so its numbers are not trusted.
	const contradicted = new Map<number | null | undefined, number>();
	files.forEach((file, i) => {
		if (!numbered[i]) return;
		const vote = titled[i] && titled[i] !== numbered[i] ? 1 : -1;
		contradicted.set(file.disc, (contradicted.get(file.disc) ?? 0) + vote);
	});
	return files.map((file, i) => {
		const number = (contradicted.get(file.disc) ?? 0) > 0 ? undefined : numbered[i];
		const title = titled[i];
		const name = nameKey(file.filename, artist);
		return title && (!number || similarity(name, title.title) > similarity(name, number.title))
			? title
			: (number ?? null);
	});
}
