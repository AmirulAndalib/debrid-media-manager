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

export function removeExtension(filename: string): string {
	return filename.replace(/\.[^/.]+$/, '');
}

/** For matching a file to its MusicBrainz track only: a title shown is MusicBrainz's or none. */
export function formatTrackTitle(filename: string): string {
	const title = removeExtension(filename).trim();
	const formattedTitle = title
		.replace(/^\s*\[(\d{1,3})\]\s*/, '')
		.replace(/^\s*(\d{1,2}[-_])?\d{1,3}\s*[-_.]\s*/, '')
		.replace(/^\s*\d{1,3}\)\s*/, '')
		.replace(/^\s*track\s*\d{1,3}\s*[-_.]?\s*/i, '')
		.trim();
	return formattedTitle || title;
}

export type TrackMetadata = { disc: number; position: number; title: string };

const TITLE_SIMILARITY = 0.8;
const normalizeTitle = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function similarTitle<T extends TrackMetadata>(filename: string, tracks: T[]): T | null {
	const title = normalizeTitle(formatTrackTitle(filename));
	let best: T | null = null;
	let bestScore = TITLE_SIMILARITY;
	for (const track of tracks) {
		const other = normalizeTitle(track.title);
		const score = 1 - distance(title, other) / Math.max(title.length, other.length, 1);
		if (score >= bestScore) {
			best = track;
			bestScore = score;
		}
	}
	return best;
}

/**
 * The MusicBrainz track each file is, in the files' order (which must already
 * be album order), or null. Same count: by position. Otherwise by disc and
 * track number, but only when that cannot be ambiguous (the file names its
 * disc or the release has one, and no two files share both: a box set repeats
 * them album after album), then by title.
 */
export function matchTrackMetadata<T extends TrackMetadata>(
	files: { disc?: number | null; trackNumber: number | null; filename: string }[],
	tracks: T[]
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
	return files.map(
		(file, i) =>
			(byNumber
				? ordered.find((track) => `${track.disc}-${track.position}` === keys[i])
				: null) ?? similarTitle(file.filename, ordered)
	);
}
