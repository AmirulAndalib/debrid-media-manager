import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomeView, { greeting } from './HomeView';
import type { MusicPlayer } from './player/MusicPlayerProvider';
import type { MusicUser } from './user/MusicUserProvider';

let player: MusicPlayer;
let user: MusicUser;
vi.mock('./player/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
vi.mock('./user/MusicUserProvider', () => ({ useMusicUser: () => user }));

const summary = (hash: string, name: string) => ({
	hash,
	mbid: `mb-${hash}`,
	artistMbid: null,
	artist: 'Test Artist',
	album: name,
	year: 2020,
	coverUrl: `https://covers.example/${hash}.jpg`,
	trackCount: 2,
});
const catalog = (hash: string, name: string) => ({
	...summary(hash, name),
	tracks: [],
	totalBytes: 0,
});
const track = {
	id: 'h1-1',
	hash: 'h1',
	fileId: 1,
	link: 'https://real-debrid.com/d/1',
	path: '/1.flac',
	bytes: 1,
	trackNumber: 1,
	filename: '01 - Opening.flac',
};

const musicFetch = vi.fn(async (_path: string) => ({
	ok: true,
	json: async () => ({
		items: [
			{ mbid: 'mb-r1', lastPlayedAt: '', album: summary('r1', 'Played Album') },
			// Gone from the catalog: no card.
			{ mbid: 'mb-gone', lastPlayedAt: '', album: { ...summary('x', 'Gone'), hash: null } },
		],
	}),
}));

const shelves = () => screen.queryAllByRole('region').map((r) => r.getAttribute('aria-label'));

describe('HomeView', () => {
	const navigate = vi.fn();
	beforeEach(() => {
		navigate.mockClear();
		musicFetch.mockClear();
		player = {
			nowPlaying: null,
			upNext: [],
			isPlaying: false,
			togglePlay: vi.fn(),
		} as unknown as MusicPlayer;
		user = {
			ready: true,
			userId: null,
			library: { albums: [], artists: [], playlists: [] },
			likedIds: new Set(),
			musicFetch,
		} as unknown as MusicUser;
	});

	const renderHome = (newAlbums = [catalog('n1', 'New Album')]) =>
		render(
			<HomeView
				navigate={navigate}
				newAlbums={newAlbums}
				onPlayAlbum={vi.fn()}
				onAlbumMenu={vi.fn()}
				onCoverLoaded={vi.fn()}
			/>
		);

	it('greets by the time of day', () => {
		expect(greeting(8)).toBe('Good morning');
		expect(greeting(13)).toBe('Good afternoon');
		expect(greeting(21)).toBe('Good evening');
		expect(greeting(2)).toBe('Good evening');
	});

	it('hides empty shelves and points a first-time user at Browse', () => {
		renderHome([]);
		expect(shelves()).toEqual([]);
		fireEvent.click(screen.getByRole('button', { name: 'Browse the catalog' }));
		expect(navigate).toHaveBeenCalledWith({ name: 'browse' });
	});

	it('shows each shelf that has something in it', async () => {
		user = {
			...user,
			userId: 'user-1',
			likedIds: new Set(['a-1']),
			library: {
				albums: [],
				artists: [],
				playlists: [
					{
						id: 'p1',
						name: 'Road trip',
						description: null,
						trackCount: 4,
						coverUrl: null,
						updatedAt: '',
					},
				],
			},
		};
		player = {
			...player,
			nowPlaying: {
				item: { track, album: catalog('h1', 'First Album') },
				source: 'context',
				contextId: 'album:h1',
			},
		};
		renderHome();
		await screen.findByText('Played Album');
		expect(musicFetch).toHaveBeenCalledWith('/api/music/me/history?group=album&limit=12');
		expect(shelves()).toEqual([
			'Jump back in',
			'Recently played',
			'Your playlists',
			'New in the catalog',
		]);
		expect(screen.queryByText('Gone')).toBeNull();
		expect(screen.queryByText('Start with the catalog')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Play First Album' }));
		expect(player.togglePlay).toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', { name: 'Open First Album' }));
		expect(navigate).toHaveBeenCalledWith({ name: 'album', hash: 'h1' });
		fireEvent.click(screen.getByRole('button', { name: 'Open Liked Songs' }));
		expect(navigate).toHaveBeenCalledWith({ name: 'liked' });
		fireEvent.click(screen.getByRole('button', { name: 'Open Road trip' }));
		expect(navigate).toHaveBeenCalledWith({ name: 'playlist', id: 'p1' });
		const showAll = screen.getAllByRole('button', { name: 'Show all' });
		fireEvent.click(showAll[showAll.length - 1]);
		expect(navigate).toHaveBeenCalledWith({ name: 'browse' });
	});

	it('jumps back into a playlist by its name', async () => {
		user = {
			...user,
			library: {
				albums: [],
				artists: [],
				playlists: [
					{
						id: 'p1',
						name: 'Road trip',
						description: null,
						trackCount: 4,
						coverUrl: null,
						updatedAt: '',
					},
				],
			},
		};
		player = {
			...player,
			nowPlaying: {
				item: { track, album: catalog('h1', 'First Album') },
				source: 'context',
				contextId: 'playlist:p1',
			},
		};
		renderHome([]);
		await waitFor(() =>
			expect(
				screen.getAllByRole('button', { name: 'Open Road trip' }).length
			).toBeGreaterThan(0)
		);
		fireEvent.click(screen.getAllByRole('button', { name: 'Open Road trip' })[0]);
		expect(navigate).toHaveBeenCalledWith({ name: 'playlist', id: 'p1' });
	});
});
