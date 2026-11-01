import type { MusicAlbum } from '@/pages/api/music/library';
import { formatTrackTitle, removeExtension } from '@/utils/musicTracks';
import type { MusicAlbumSummary } from '@/utils/musicRows';
import type { MusicAlbumSummary, MusicTrackRow } from '@/utils/musicRows';
import type { DragEvent } from 'react';
import { PlayableTrack, QueuedTrack } from './types';

export function formatDuration(seconds: number): string {
	if (!seconds || !isFinite(seconds)) return '0:00';
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatSize(bytes: number): string {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Shared with the music API, which titles a track the same way when MusicBrainz has none.
export { formatTrackTitle, removeExtension };

export const trackTitle = (track: PlayableTrack) => track.title || formatTrackTitle(track.filename);

export function shuffleArray<T>(array: T[]): T[] {
	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

/** What the per-user API stores for a track: its file and its album. */
export const trackRef = (track: PlayableTrack, album: { mbid: string }) => ({
	hash: track.hash,
	fileId: track.fileId,
	mbid: album.mbid,
});

/** A per-user API album as a catalog album, or null when no release of it is left. */
export const catalogAlbum = (album: MusicAlbumSummary): MusicAlbum | null =>
	album.hash ? { ...album, hash: album.hash, tracks: [], totalBytes: 0 } : null;

/** A per-user API row as a queue item, or null when its file left the catalog. */
export const rowItem = (row: MusicTrackRow): QueuedTrack | null =>
	row.track && row.album
		? {
				track: row.track,
				album: { ...row.album, hash: row.track.hash, tracks: [], totalBytes: 0 },
			}
		: null;

export const albumItems = (album: MusicAlbum): QueuedTrack[] =>
	album.tracks.map((track) => ({ track, album }));

/** Native drag-and-drop props for row `index` of a list that `onMove` reorders. */
export const dragRow = (
	index: number,
	dragged: { current: number | null },
	onMove: (from: number, to: number) => void
) => ({
	draggable: true,
	onDragStart: (e: DragEvent) => {
		dragged.current = index;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', String(index)); // Firefox starts no drag without data
	},
	onDragOver: (e: DragEvent) => e.preventDefault(),
	onDrop: (e: DragEvent) => {
		e.preventDefault();
		const from = dragged.current;
		dragged.current = null;
		if (from !== null && from !== index) onMove(from, index);
	},
});
