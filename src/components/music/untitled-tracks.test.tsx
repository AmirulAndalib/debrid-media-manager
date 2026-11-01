/**
 * Nothing of a file's name reaches the page: an album MusicBrainz has not
 * titled yet lists "Track 1", "Track 2"… under "Disc n", never its filenames.
 */
import type { MusicTrack } from '@/pages/api/music/library';
import monkees from '@/test/fixtures/music/library-dc925f67cd67936b4a8fbeb17d6decb648fd3479.json';
import { formatTrackTitle, getFilename, trackPosition } from '@/utils/musicTracks';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AlbumDetailView from './AlbumDetailView';
import MusicPlayerBar from './MusicPlayerBar';
import NowPlayingPanel from './NowPlayingPanel';

// The Monkees' 4-disc set before enrichment, as /api/music/library now serves it.
const tracks: MusicTrack[] = monkees.files.map((file) => {
	const { disc, track } = trackPosition(file.path, file.trackNumber);
	return {
		id: `${monkees.hash}-${file.file_id}`,
		hash: monkees.hash,
		fileId: file.file_id,
		link: `https://real-debrid.com/d/${file.file_id}`,
		path: file.path,
		bytes: file.bytes,
		trackNumber: track,
		filename: getFilename(file.path),
		disc,
		title: null,
		durationMs: null,
	};
});
const album = {
	hash: monkees.hash,
	mbid: monkees.mbid,
	artistMbid: null,
	artist: 'The Monkees',
	album: 'The Monkees',
	year: 1966,
	coverUrl: null,
	tracks,
	totalBytes: tracks.reduce((sum, track) => sum + track.bytes, 0),
	trackCount: tracks.length,
};
const items = tracks.map((track) => ({ track, album }));

const player = {
	nowPlaying: { item: items[4], source: 'context', contextId: `album:${monkees.hash}` },
	upNext: items.slice(5),
	priorityCount: 0,
	isPlaying: false,
	isLoading: false,
	isShuffled: false,
	repeatMode: 'off',
	currentTime: 0,
	duration: 0,
};
const user = {
	library: { albums: [], artists: [], playlists: [] },
	isSaved: () => false,
	isLiked: () => false,
};
vi.mock('./player/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
vi.mock('./user/MusicUserProvider', () => ({ useMusicUser: () => user }));

/** Every text and attribute on the page: what is read out as well as what is seen. */
const shown = () =>
	[
		document.body.textContent,
		...Array.from(document.body.querySelectorAll('*')).flatMap((el) =>
			Array.from(el.attributes, (attribute) => attribute.value)
		),
	].join('\n');

describe('an album MusicBrainz has not titled', () => {
	it('shows no filename on the album page, the player bar or the queue', () => {
		const noop = vi.fn();
		render(
			<AlbumDetailView
				album={album}
				navigate={noop}
				onDownloadAlbum={noop}
				onMenu={noop}
				onTrackMenu={noop}
			/>
		);
		render(
			<MusicPlayerBar
				currentTrack={items[4]}
				playerState={{ ...player, volume: 1, isMuted: false } as any}
				onTogglePlay={noop}
				onSkipNext={noop}
				onSkipPrev={noop}
				onToggleShuffle={noop}
				onToggleRepeat={noop}
				onSeek={noop}
				onVolumeChange={noop}
				onToggleMute={noop}
				onToggleQueue={noop}
				isQueueOpen
			/>
		);
		render(<NowPlayingPanel navigate={noop} onClose={noop} onTrackMenu={noop} />);

		const page = shown();
		for (const track of tracks) {
			// "(Theme From) The Monkees [Stereo Mix]", "Saturday's Child (Mono Mix)"…
			expect(page).not.toContain(formatTrackTitle(track.filename));
		}
		expect(page).not.toMatch(/\.flac|Disc 0\d|Stereo Mix|Mono Mix|Backing Track/);

		// Disc by disc, each counted from 1, and plainly untitled.
		expect(screen.getAllByText(/^Disc \d$/).map((d) => d.textContent)).toEqual([
			'Disc 1',
			'Disc 2',
			'Disc 3',
			'Disc 4',
		]);
		// Track 5 of each of the four discs on the album page; of discs 2 to 4 up next.
		const rows = screen.getAllByRole('button', { name: 'Play Track 5 by The Monkees' });
		expect(rows).toHaveLength(7);
		const labels = screen.getAllByText('Track 5', { selector: 'button span' });
		expect(labels).toHaveLength(7);
		for (const label of labels) {
			expect(label).toHaveClass('italic');
		}
	});
});
