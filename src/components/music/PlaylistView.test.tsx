import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from './ContextMenu';
import type { MusicPlayer } from './player/MusicPlayerProvider';
import PlaylistView from './PlaylistView';
import type { MusicUser } from './user/MusicUserProvider';

let player: MusicPlayer;
let user: MusicUser;
vi.mock('./player/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
vi.mock('./user/MusicUserProvider', () => ({ useMusicUser: () => user }));

const HASH = 'b'.repeat(40);
const entry = (id: string, fileId: number, available = true, cover = `https://c/${fileId}`) => ({
	id,
	position: fileId,
	addedAt: '',
	hash: HASH,
	fileId,
	mbid: `mb${fileId}`,
	album: {
		hash: HASH,
		mbid: `mb${fileId}`,
		artist: 'Test Artist',
		album: `Album ${fileId}`,
		year: 2020,
		coverUrl: cover,
		trackCount: 3,
	},
	track: available
		? {
				id: `${HASH}-${fileId}`,
				hash: HASH,
				fileId,
				link: `https://real-debrid.com/d/${fileId}`,
				path: `/Song ${fileId}.flac`,
				bytes: 1,
				trackNumber: fileId,
				filename: `Song ${fileId}.flac`,
			}
		: null,
});
const detail = (tracks: ReturnType<typeof entry>[]) => ({
	id: 'p1',
	name: 'Road trip',
	description: 'For the drive',
	trackCount: tracks.length,
	coverUrl: null,
	updatedAt: '',
	tracks,
});
const dataTransfer = { setData: vi.fn(), effectAllowed: '' };

describe('PlaylistView', () => {
	const navigate = vi.fn();
	const onMenu = vi.fn();
	let answer: { status: number; body: unknown };
	beforeEach(() => {
		navigate.mockClear();
		onMenu.mockClear();
		answer = {
			status: 200,
			body: detail([entry('e1', 1), entry('e2', 2, false), entry('e3', 3)]),
		};
		player = {
			nowPlaying: null,
			isPlaying: false,
			isShuffled: false,
			playContext: vi.fn(),
			toggleShuffle: vi.fn(),
		} as unknown as MusicPlayer;
		user = {
			ready: true,
			userId: 'user-1',
			isLiked: () => false,
			like: vi.fn(),
			unlike: vi.fn(),
			renamePlaylist: vi.fn(async () => true),
			deletePlaylist: vi.fn(async () => true),
			removeFromPlaylist: vi.fn(async () => true),
			reorderPlaylist: vi.fn(async () => true),
			musicFetch: vi.fn(async () => ({
				ok: answer.status < 300,
				status: answer.status,
				json: async () => answer.body,
			})),
		} as unknown as MusicUser;
	});
	afterEach(() => vi.unstubAllGlobals());

	const renderPlaylist = () =>
		render(
			<PlaylistView
				id="p1"
				navigate={navigate}
				onMenu={onMenu}
				onTrackMenu={vi.fn()}
				onDownload={vi.fn()}
			/>
		);
	const titles = () =>
		screen
			.getAllByRole('button', { name: /^Play Song/ })
			.map((b) => b.getAttribute('aria-label'));

	it('shows the header and the rows, greying out a gone track', async () => {
		renderPlaylist();
		expect(await screen.findByRole('button', { name: 'Road trip' })).toBeInTheDocument();
		expect(screen.getByText('For the drive')).toBeInTheDocument();
		expect(screen.getByText('3 songs')).toBeInTheDocument();
		expect(titles()).toEqual(['Play Song 1 by Test Artist', 'Play Song 3 by Test Artist']);
		expect(screen.getByText('No longer available')).toBeInTheDocument();
		// Fewer than four covers: the first one fills the square.
		expect(document.querySelectorAll('img')).toHaveLength(1);
	});

	it('plays a row within the playlist', async () => {
		renderPlaylist();
		fireEvent.click(await screen.findByRole('button', { name: 'Play Song 3 by Test Artist' }));
		expect(player.playContext).toHaveBeenCalledWith(expect.any(Array), 1, 'playlist:p1');
	});

	it('reorders by drag and drop and saves the new order', async () => {
		renderPlaylist();
		await screen.findByText('Song 1');
		const rows = document.querySelectorAll('[draggable="true"]');
		fireEvent.dragStart(rows[2], { dataTransfer });
		fireEvent.drop(rows[0], { dataTransfer });
		expect(user.reorderPlaylist).toHaveBeenCalledWith('p1', ['e3', 'e1', 'e2']);
		expect(titles()).toEqual(['Play Song 3 by Test Artist', 'Play Song 1 by Test Artist']);
	});

	it('puts the old order back when the server refuses it', async () => {
		vi.mocked(user.reorderPlaylist).mockResolvedValueOnce(false);
		renderPlaylist();
		await screen.findByText('Song 1');
		const rows = document.querySelectorAll('[draggable="true"]');
		fireEvent.dragStart(rows[2], { dataTransfer });
		fireEvent.drop(rows[0], { dataTransfer });
		await waitFor(() =>
			expect(titles()).toEqual(['Play Song 1 by Test Artist', 'Play Song 3 by Test Artist'])
		);
	});

	it('removes a row, the unavailable one too', async () => {
		renderPlaylist();
		fireEvent.click(await screen.findByRole('button', { name: 'Remove from this playlist' }));
		expect(user.removeFromPlaylist).toHaveBeenCalledWith('p1', ['e2']);
		await waitFor(() => expect(screen.queryByText('No longer available')).toBeNull());
		expect(screen.getByText('2 songs')).toBeInTheDocument();
	});

	it('renames inline', async () => {
		renderPlaylist();
		fireEvent.click(await screen.findByRole('button', { name: 'Road trip' }));
		const input = screen.getByLabelText('Playlist name');
		fireEvent.change(input, { target: { value: 'Night drive' } });
		fireEvent.keyDown(input, { key: 'Enter' });
		expect(user.renamePlaylist).toHaveBeenCalledWith('p1', 'Night drive');
		expect(await screen.findByRole('button', { name: 'Night drive' })).toBeInTheDocument();
	});

	it('deletes from its menu after asking', async () => {
		vi.stubGlobal(
			'confirm',
			vi.fn(() => true)
		);
		renderPlaylist();
		fireEvent.click(await screen.findByRole('button', { name: 'More options for Road trip' }));
		const items: MenuItem[] = onMenu.mock.calls[0][1];
		items.find((i) => i.label === 'Delete')!.onSelect!();
		await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'library' }));
		expect(user.deletePlaylist).toHaveBeenCalledWith('p1');
	});

	it('suggests Browse for an empty playlist, and builds a mosaic from four covers', async () => {
		answer = { status: 200, body: detail([]) };
		const { unmount } = renderPlaylist();
		fireEvent.click(await screen.findByRole('button', { name: 'Browse the catalog' }));
		expect(navigate).toHaveBeenCalledWith({ name: 'browse' });
		unmount();

		answer = { status: 200, body: detail([1, 2, 3, 4, 5].map((i) => entry(`e${i}`, i))) };
		renderPlaylist();
		await screen.findByText('Song 1');
		expect(document.querySelectorAll('img')).toHaveLength(4);
	});

	it('says when the playlist does not exist', async () => {
		answer = { status: 404, body: { error: 'Playlist not found' } };
		renderPlaylist();
		expect(await screen.findByText(/does not exist/)).toBeInTheDocument();
	});
});
