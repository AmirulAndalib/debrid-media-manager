import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LibraryPane from './LibraryPane';
import type { MusicUser } from './user/MusicUserProvider';

let user: MusicUser;
vi.mock('./user/MusicUserProvider', () => ({ useMusicUser: () => user }));

const album = (mbid: string, name: string, savedAt: string) => ({
	mbid,
	savedAt,
	album: {
		hash: `hash-${mbid}`,
		mbid,
		artist: 'Artist',
		album: name,
		year: 2020,
		coverUrl: null,
		trackCount: 10,
	},
});
const library = {
	albums: [album('a1', 'Zebra Album', '2026-10-03T00:00:00Z')],
	artists: [{ artistMbid: 'ar1', name: 'Some Artist', followedAt: '2026-10-01T00:00:00Z' }],
	playlists: [
		{
			id: 'p1',
			name: 'Morning',
			description: null,
			trackCount: 1,
			coverUrl: null,
			updatedAt: '2026-10-02T00:00:00Z',
		},
	],
};
const names = () =>
	within(screen.getByRole('region', { name: 'Your Library' }))
		.getAllByRole('button')
		.map((b) => b.querySelector('span span')?.textContent)
		.filter(Boolean);

describe('LibraryPane', () => {
	const navigate = vi.fn();
	beforeEach(() => {
		navigate.mockClear();
		user = {
			ready: true,
			userId: 'user-1',
			library,
			likedIds: new Set(['x-1', 'x-2']),
			createPlaylist: vi.fn(async () => ({ ...library.playlists[0], id: 'p2' })),
		} as unknown as MusicUser;
	});

	it('pins Liked Songs, then lists everything newest first', () => {
		render(<LibraryPane route={{ name: 'home' }} navigate={navigate} />);
		expect(names()).toEqual(['Liked Songs', 'Zebra Album', 'Morning', 'Some Artist']);
		expect(screen.getByText('Playlist · 2 songs')).toBeInTheDocument();
	});

	it('filters by kind and by text, and sorts alphabetically', () => {
		render(<LibraryPane route={{ name: 'home' }} navigate={navigate} />);
		fireEvent.click(screen.getByRole('button', { name: 'Albums' }));
		expect(names()).toEqual(['Liked Songs', 'Zebra Album']);
		fireEvent.click(screen.getByRole('button', { name: 'Albums' }));
		fireEvent.change(screen.getByLabelText('Search in Your Library'), {
			target: { value: 'morn' },
		});
		expect(names()).toEqual(['Liked Songs', 'Morning']);
		fireEvent.change(screen.getByLabelText('Search in Your Library'), {
			target: { value: '' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Recents' }));
		expect(names()).toEqual(['Liked Songs', 'Morning', 'Some Artist', 'Zebra Album']);
	});

	it('opens what is clicked and marks the open page', () => {
		render(<LibraryPane route={{ name: 'playlist', id: 'p1' }} navigate={navigate} />);
		fireEvent.click(screen.getByText('Zebra Album'));
		expect(navigate).toHaveBeenCalledWith({ name: 'album', hash: 'hash-a1' });
		expect(screen.getByText('Morning').closest('button')).toHaveAttribute(
			'aria-current',
			'page'
		);
	});

	it('creates a playlist and opens it', async () => {
		render(<LibraryPane route={{ name: 'home' }} navigate={navigate} />);
		fireEvent.click(screen.getByRole('button', { name: 'Create playlist' }));
		await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'playlist', id: 'p2' }));
	});

	it('tells a new user what the library is for', () => {
		user = { ...user, library: { albums: [], artists: [], playlists: [] } };
		render(<LibraryPane route={{ name: 'home' }} navigate={navigate} />);
		expect(screen.getByText('Make this music yours')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Browse the catalog' }));
		expect(navigate).toHaveBeenCalledWith({ name: 'browse' });
	});

	it('says so when the library could not sign in', () => {
		user = { ...user, userId: null, library: { albums: [], artists: [], playlists: [] } };
		render(<LibraryPane route={{ name: 'home' }} navigate={navigate} />);
		expect(screen.getByText(/could not load/)).toBeInTheDocument();
	});
});
