import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NowPlayingPanel, { contextName } from './NowPlayingPanel';
import type { MusicPlayer } from './player/MusicPlayerProvider';
import type { QueuedTrack } from './types';
import type { MusicUser } from './user/MusicUserProvider';

let player: MusicPlayer;
let user: MusicUser;
vi.mock('./player/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
vi.mock('./user/MusicUserProvider', () => ({ useMusicUser: () => user }));

const album = (hash: string, name: string) => ({
	hash,
	mbid: `mb-${hash}`,
	artistMbid: null,
	artist: 'Test Artist',
	album: name,
	year: 2020,
	coverUrl: null,
	tracks: [],
	totalBytes: 0,
	trackCount: 3,
});
const item = (hash: string, fileId: number, name = 'First Album'): QueuedTrack => ({
	track: {
		id: `${hash}-${fileId}`,
		hash,
		fileId,
		link: `https://real-debrid.com/d/${fileId}`,
		path: `/${fileId}.flac`,
		bytes: 1,
		trackNumber: fileId,
		filename: `0${fileId} - Song ${hash}${fileId}.flac`,
		title: `Song ${hash}${fileId}`,
	},
	album: album(hash, name),
});

const dataTransfer = { setData: vi.fn(), effectAllowed: '' };

describe('NowPlayingPanel', () => {
	const navigate = vi.fn();
	const onClose = vi.fn();
	beforeEach(() => {
		navigate.mockClear();
		onClose.mockClear();
		player = {
			nowPlaying: { item: item('h1', 1), source: 'context', contextId: 'album:h1' },
			// One queued by hand, then the rest of the album.
			upNext: [item('q9', 9, 'Queued Album'), item('h1', 2), item('h1', 3)],
			priorityCount: 1,
			isPlaying: true,
			isLoading: false,
			isShuffled: false,
			repeatMode: 'off',
			currentTime: 0,
			duration: 0,
			playAt: vi.fn(),
			removeAt: vi.fn(),
			moveInQueue: vi.fn(),
			clearQueue: vi.fn(),
			togglePlay: vi.fn(),
			seek: vi.fn(),
		} as unknown as MusicPlayer;
		user = {
			library: { albums: [], artists: [], playlists: [] },
			isLiked: () => false,
			like: vi.fn(),
			unlike: vi.fn(),
		} as unknown as MusicUser;
	});

	const renderPanel = (sheet = false) =>
		render(
			<NowPlayingPanel
				navigate={navigate}
				onClose={onClose}
				onTrackMenu={vi.fn()}
				sheet={sheet}
			/>
		);

	it('shows the track, links to its album and artist, and likes it', () => {
		renderPanel();
		expect(screen.getByText('Song h11')).toBeInTheDocument();
		// The album under the title, and the album the queue continues with.
		const [albumLink, contextLink] = screen.getAllByRole('button', { name: 'First Album' });
		fireEvent.click(albumLink);
		expect(navigate).toHaveBeenCalledWith({ name: 'album', hash: 'h1' });
		fireEvent.click(contextLink);
		expect(navigate).toHaveBeenCalledTimes(2);
		fireEvent.click(screen.getByRole('button', { name: 'Test Artist' }));
		expect(navigate).toHaveBeenCalledWith({ name: 'search', q: 'Test Artist' });
		fireEvent.click(screen.getByRole('button', { name: 'Save to Liked Songs' }));
		expect(user.like).toHaveBeenCalledWith({ hash: 'h1', fileId: 1, mbid: 'mb-h1' });
	});

	it('splits the queue into what was queued and the rest of the album', () => {
		renderPanel();
		const queued = screen.getByRole('region', { name: 'Next in queue' });
		expect(within(queued).getByText('Song q99')).toBeInTheDocument();
		const rest = screen.getByRole('region', { name: 'Next from First Album' });
		expect(within(rest).getAllByRole('button', { name: /^Play / })).toHaveLength(2);

		fireEvent.click(within(rest).getByRole('button', { name: 'Play Song h13 by Test Artist' }));
		expect(player.playAt).toHaveBeenCalledWith(2);
		fireEvent.click(within(rest).getAllByTitle('Remove from queue')[0]);
		expect(player.removeAt).toHaveBeenCalledWith(1);
		fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
		expect(player.clearQueue).toHaveBeenCalled();
	});

	it('reorders the queue by drag and drop', () => {
		renderPanel();
		const rows = screen
			.getAllByRole('button', { name: /^Play Song/ })
			.map((button) => button.closest('[draggable="true"]')!);
		fireEvent.dragStart(rows[2], { dataTransfer });
		fireEvent.dragOver(rows[0], { dataTransfer });
		fireEvent.drop(rows[0], { dataTransfer });
		expect(player.moveInQueue).toHaveBeenCalledWith(2, 0);
	});

	it('has playback controls and the queue on a tab in the phone sheet', () => {
		renderPanel(true);
		expect(screen.getByRole('heading', { name: 'First Album' })).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
		expect(player.togglePlay).toHaveBeenCalled();
		expect(screen.queryByRole('region', { name: 'Next in queue' })).toBeNull();
		fireEvent.click(screen.getByRole('tab', { name: 'Queue' }));
		expect(screen.getByRole('region', { name: 'Next in queue' })).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Close Now Playing' }));
		expect(onClose).toHaveBeenCalled();
	});

	it('names the context it plays from', () => {
		const playlists = [{ id: 'p1', name: 'Road trip' }];
		expect(contextName('liked', [], playlists)).toBe('Liked Songs');
		expect(contextName('playlist:p1', [], playlists)).toBe('Road trip');
		expect(contextName('album:h1', [item('h1', 1)], playlists)).toBe('First Album');
		expect(contextName('search:green day', [], playlists)).toBe('Search');
		const popular = { ...item('h1', 1), album: { ...album('h1', 'A'), artistMbid: 'ar1' } };
		expect(contextName('artist:ar1:popular', [popular], playlists)).toBe('Test Artist');
		expect(contextName(null, [], playlists)).toBeNull();
	});

	// The heading's ellipsis used to swallow the whole button: "Next from ...".
	it('truncates a long context name rather than hiding it', () => {
		renderPanel();
		const rest = screen.getByRole('region', { name: 'Next from First Album' });
		const link = within(rest).getByRole('button', { name: 'First Album' });
		expect(link).toHaveClass('truncate');
		expect(link.parentElement).not.toHaveClass('truncate');
		fireEvent.click(link);
		expect(navigate).toHaveBeenCalledWith({ name: 'album', hash: 'h1' });
	});
});
