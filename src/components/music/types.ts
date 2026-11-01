import { MusicAlbum, MusicTrack } from '@/pages/api/music/library';

export interface PlayerState {
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	isMuted: boolean;
	isLoading: boolean;
	repeatMode: 'off' | 'all' | 'one';
	isShuffled: boolean;
}

/** A library track; the catalog API adds `title` and `durationMs` when it knows them. */
export type PlayableTrack = MusicTrack & { title?: string; durationMs?: number | null };

export interface QueuedTrack {
	track: PlayableTrack;
	album: MusicAlbum;
	streamUrl?: string;
}
