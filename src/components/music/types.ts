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

/** A library track, as the catalog API sends it. */
export type PlayableTrack = MusicTrack;

export interface QueuedTrack {
	track: PlayableTrack;
	album: MusicAlbum;
	streamUrl?: string;
}
