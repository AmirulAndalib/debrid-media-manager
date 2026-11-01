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

export function removeExtension(filename: string): string {
	return filename.replace(/\.[^/.]+$/, '');
}

export function formatTrackTitle(filename: string): string {
	const title = removeExtension(filename).trim();
	const formattedTitle = title
		.replace(/^\s*\[(\d{1,3})\]\s*/, '')
		.replace(/^\s*\d{1,3}\s*[-_.]\s*/, '')
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
 * be album order), or null. Same count: by position. Otherwise by track number,
 * but only when that cannot be ambiguous (one disc, no repeated numbers: a box
 * set repeats them album after album), then by title.
 */
export function matchTrackMetadata<T extends TrackMetadata>(
	files: { trackNumber: number | null; filename: string }[],
	tracks: T[]
): (T | null)[] {
	const ordered = [...tracks].sort((a, b) => a.disc - b.disc || a.position - b.position);
	if (ordered.length === files.length) return ordered;
	if (ordered.length === 0) return files.map(() => null);

	const numbers = files.map((file) => file.trackNumber);
	const byNumber =
		new Set(ordered.map((track) => track.disc)).size === 1 &&
		new Set(numbers).size === numbers.length;
	return files.map(
		(file) =>
			(byNumber ? ordered.find((track) => track.position === file.trackNumber) : null) ??
			similarTitle(file.filename, ordered)
	);
}
