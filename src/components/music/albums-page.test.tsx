import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerMock = {
	query: {} as Record<string, string | string[]>,
	asPath: '/music',
	push: vi.fn(),
	replace: vi.fn(),
	back: vi.fn(),
};

vi.mock('next/router', () => ({ __esModule: true, useRouter: () => routerMock }));
vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: () => ['rd-token', false, false],
	useRealDebrid: () => ({ user: { id: 1 } }),
}));

import AlbumsPage from '@/pages/albums/[[...slug]]';
import { PLAYER_STATE_VERSION } from './player/persistence';

const track = (fileId: number, filename: string) => ({
	title: filename.slice(5, -5),
	id: `h1-${fileId}`,
	hash: 'h1',
	fileId,
	link: `https://real-debrid.com/d/${fileId}`,
	path: `/${filename}`,
	bytes: 8 * 1024 * 1024,
	trackNumber: fileId,
	filename,
});

const summary = {
	hash: 'h1',
	mbid: 'mb1',
	artist: 'Test Artist',
	album: 'First Album',
	year: 2020,
	coverUrl: 'https://covers.example/h1.jpg',
	tracks: [],
	totalBytes: 16 * 1024 * 1024,
	trackCount: 2,
};
const fullAlbum = {
	...summary,
	tracks: [track(1, '01 - Opening.flac'), track(2, '02 - Closing.flac')],
};

const json = (body: unknown, status = 200) =>
	({ ok: status < 300, status, json: async () => body }) as Response;
const me: Record<string, unknown> = {};
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
	if (url === '/api/music/session') {
		return json({ token: 'music-token', userId: 'user-1', exp: Date.now() + 864e5 });
	}
	if (url.startsWith('/api/music/me/')) {
		const path = url.slice('/api/music/me/'.length);
		if (path in me) return json(me[path]);
		if (path === 'library') return json({ albums: [], artists: [], playlists: [] });
		if (path === 'likes?ids=1') return json({ ids: [] });
		if (path === 'state') return json({ state: null, updatedAt: null });
		return json(null, 204);
	}
	if (url === '/api/music/unrestrict') {
		return json({ streamUrl: `https://cdn.example/${JSON.parse(String(init?.body)).fileId}` });
	}
	if (url.startsWith('/api/music/artist?')) {
		return json({ artist: { mbid: 'ar1', name: 'Test Artist' }, albums: [summary] });
	}
	if (url.startsWith('/api/music/popular?')) return json({ items: [] });
	if (url.startsWith('/api/music/search?')) {
		return json({ artists: [], albums: [summary], tracks: [] });
	}
	if (url.includes('hash=')) return json({ albums: [fullAlbum], totalAlbums: 1, totalTracks: 2 });
	if (url.includes('search=')) {
		return json({ albums: [summary], totalAlbums: 11, totalTracks: 260, hasMore: false });
	}
	return json({ albums: [summary], totalAlbums: 120, totalTracks: 1500, hasMore: false });
});

const savedQueue = () =>
	localStorage.setItem(
		'music:player',
		JSON.stringify({
			version: PLAYER_STATE_VERSION,
			queue: {
				contextId: 'album:h1',
				context: [{ track: fullAlbum.tracks[0], album: summary }],
				contextIndex: 0,
				originalOrder: [],
				priority: [],
				priorityItem: null,
			},
			repeatMode: 'off',
			isShuffled: false,
			volume: 1,
		})
	);

/** The page lays itself out from `(min-width: …)` queries, as a window this wide answers them. */
const viewport = (width: number) =>
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: width >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity),
		media: query,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}));

describe('music page', () => {
	const spies: { mockRestore: () => void }[] = [];
	beforeEach(() => {
		localStorage.clear();
		routerMock.query = {};
		for (const key of Object.keys(me)) delete me[key];
		routerMock.push.mockClear();
		routerMock.replace.mockClear();
		vi.stubGlobal('fetch', fetchMock);
		viewport(1440);
		spies.push(
			vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
				this: HTMLMediaElement
			) {
				this.dispatchEvent(new Event('play'));
				return Promise.resolve();
			}),
			vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
		);
	});
	afterEach(() => {
		spies.splice(0).forEach((spy) => spy.mockRestore());
		vi.unstubAllGlobals();
		fetchMock.mockClear();
	});

	it('docks the player bar for a saved queue and drops it when the queue is cleared', async () => {
		savedQueue();
		render(<AlbumsPage />);
		expect(
			(await screen.findAllByRole('button', { name: 'Next track' })).length
		).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
		expect(screen.queryByRole('button', { name: 'Next track' })).toBeNull();
	});

	it('shows Now Playing beside the page on a desktop and remembers closing it', async () => {
		savedQueue();
		render(<AlbumsPage />);
		expect(
			await screen.findByRole('button', { name: 'Close Now Playing' })
		).toBeInTheDocument();
		const [queueButton] = screen.getAllByRole('button', { name: 'Queue' });
		expect(queueButton).toHaveAttribute('aria-pressed', 'true');
		fireEvent.click(queueButton);
		expect(screen.queryByRole('button', { name: 'Close Now Playing' })).toBeNull();
		expect(localStorage.getItem('music:nowPlayingOpen')).toBe('false');
	});

	it('opens Now Playing as an overlay on a tablet', async () => {
		viewport(768);
		savedQueue();
		render(<AlbumsPage />);
		const [queueButton] = await screen.findAllByRole('button', { name: 'Queue' });
		expect(screen.queryByRole('button', { name: 'Close Now Playing' })).toBeNull();
		fireEvent.click(queueButton);
		fireEvent.click(await screen.findByRole('button', { name: 'Close Now Playing' }));
		expect(screen.queryByRole('button', { name: 'Close Now Playing' })).toBeNull();
	});

	it('gives the library pane up to Now Playing below 1280 px', async () => {
		viewport(1024);
		savedQueue();
		render(<AlbumsPage />);
		await screen.findByRole('button', { name: 'Close Now Playing' });
		expect(screen.queryByLabelText('Search in Your Library')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Close Now Playing' }));
		expect(await screen.findByLabelText('Search in Your Library')).toBeInTheDocument();
	});

	it('likes the playing track from the heart in the player bar', async () => {
		savedQueue();
		render(<AlbumsPage />);
		const [heart] = await screen.findAllByRole('button', { name: 'Save to Liked Songs' });
		fireEvent.click(heart);
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/music/me/likes',
				expect.objectContaining({
					method: 'PUT',
					body: JSON.stringify({ hash: 'h1', fileId: 1, mbid: 'mb1' }),
				})
			)
		);
		// The player bar's phone and desktop rows, and Now Playing.
		expect(screen.getAllByRole('button', { name: 'Remove from Liked Songs' })).toHaveLength(3);
	});

	it('shows the library pane with Home, Search and Browse on a desktop, and collapses it', async () => {
		me.library = {
			albums: [{ mbid: 'mb1', savedAt: '2026-10-01T00:00:00Z', album: summary }],
			artists: [],
			playlists: [],
		};
		render(<AlbumsPage />);
		const pane = await screen.findByRole('region', { name: 'Your Library' });
		expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect(screen.getByRole('button', { name: 'Browse' })).toBeInTheDocument();
		await waitFor(() => expect(pane).toHaveTextContent('First AlbumAlbum · Test Artist'));
		fireEvent.click(screen.getByRole('button', { name: 'Collapse Your Library' }));
		expect(screen.queryByLabelText('Search in Your Library')).toBeNull();
		expect(pane.querySelector('[aria-label="First Album"]')).not.toBeNull();
	});

	it('keeps the library pane to icons on a tablet', async () => {
		viewport(768);
		render(<AlbumsPage />);
		await screen.findByRole('region', { name: 'Your Library' });
		expect(screen.queryByLabelText('Search in Your Library')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Collapse Your Library' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Liked Songs' })).toBeInTheDocument();
	});

	it("resumes the account's queue on a device that has none", async () => {
		me.state = {
			state: {
				version: PLAYER_STATE_VERSION,
				queue: {
					contextId: 'album:h1',
					context: [{ track: fullAlbum.tracks[1], album: summary }],
					contextIndex: 0,
					originalOrder: [],
					priority: [],
					priorityItem: null,
				},
				repeatMode: 'off',
				isShuffled: false,
				volume: 1,
			},
			updatedAt: '2026-11-01T00:00:00.000Z',
		};
		render(<AlbumsPage />);
		expect((await screen.findAllByText('Closing')).length).toBeGreaterThan(0);
		const stateCall = fetchMock.mock.calls.find(([url]) => url === '/api/music/me/state')!;
		expect((stateCall[1]!.headers as Record<string, string>)['x-dmm-music-token']).toBe(
			'music-token'
		);
	});

	it('records a play in the history after 30 seconds heard', async () => {
		routerMock.query = { slug: ['album', 'h1'] };
		const { container } = render(<AlbumsPage />);
		fireEvent.click(await screen.findByRole('button', { name: 'Play First Album' }));
		const audio = container.querySelector('audio')!;
		await waitFor(() => expect(audio).toHaveAttribute('src', 'https://cdn.example/1'));
		for (let t = 1; t <= 30; t++) {
			Object.defineProperty(audio, 'currentTime', { value: t, configurable: true });
			fireEvent.timeUpdate(audio);
		}
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/music/me/history',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ hash: 'h1', fileId: 1, mbid: 'mb1' }),
				})
			)
		);
	});

	it("saves an album to the library from its card's menu", async () => {
		routerMock.query = { slug: ['browse'] };
		render(<AlbumsPage />);
		fireEvent.click(
			await screen.findByRole('button', { name: 'More options for First Album' })
		);
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Save to Your Library' }));
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/music/me/albums/mb1',
				expect.objectContaining({ method: 'PUT' })
			)
		);
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('saves the open album with the heart in its header', async () => {
		routerMock.query = { slug: ['album', 'h1'] };
		render(<AlbumsPage />);
		const heart = await screen.findByRole('button', { name: 'Save to Your Library' });
		fireEvent.click(heart);
		expect(heart).toHaveAttribute('aria-pressed', 'true');
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/music/me/albums/mb1',
				expect.objectContaining({ method: 'PUT' })
			)
		);
	});

	it('searches the catalog by section and keeps its totals in the header', async () => {
		routerMock.query = { slug: ['search'], q: 'first' };
		render(<AlbumsPage />);
		const albums = await screen.findByRole('region', { name: 'Albums' });
		expect(albums).toHaveTextContent('First Album');
		expect(fetchMock).toHaveBeenCalledWith('/api/music/search?q=first');
		expect(screen.getByText('120 albums · 1500 tracks')).toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('search=first'));
	});

	it('navigates to the search page as you type, after a pause', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			render(<AlbumsPage />);
			fireEvent.change(await screen.findByLabelText('Search artists or albums'), {
				target: { value: 'daft punk' },
			});
			expect(routerMock.push).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(250);
			expect(routerMock.push).toHaveBeenCalledWith('/music/search?q=daft%20punk', undefined, {
				shallow: true,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('drops a pending search when another page opens first', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			routerMock.query = { slug: ['browse'] };
			render(<AlbumsPage />);
			const card = await screen.findByRole('button', {
				name: 'Open First Album by Test Artist',
			});
			fireEvent.change(screen.getByLabelText('Search artists or albums'), {
				target: { value: 'first' },
			});
			fireEvent.click(card);
			await vi.advanceTimersByTimeAsync(250);
			expect(routerMock.push.mock.calls.map(([url]) => url)).toEqual(['/music/album/h1']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('leaves the search box empty on an artist page', async () => {
		me.library = {
			albums: [],
			artists: [{ artistMbid: 'ar1', name: 'Test Artist', followedAt: '' }],
			playlists: [],
		};
		routerMock.query = { slug: ['artist', 'ar1'] };
		render(<AlbumsPage />);
		await screen.findByRole('heading', { level: 1, name: 'Test Artist' });
		expect(screen.getByLabelText('Search artists or albums')).toHaveValue('');
	});

	it('replaces the old /music/<hash> album URL with /music/album/<hash>', async () => {
		routerMock.query = { slug: ['h1'] };
		render(<AlbumsPage />);
		await waitFor(() =>
			expect(routerMock.replace).toHaveBeenCalledWith('/music/album/h1', undefined, {
				shallow: true,
			})
		);
	});

	// The grid lists summaries with no tracks (`summary=1`), as the live API does.
	it('opens on Home with the newest albums in the catalog', async () => {
		render(<AlbumsPage />);
		const shelf = await screen.findByRole('region', { name: 'New in the catalog' });
		expect(shelf).toHaveTextContent('First Album');
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Good /);
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/music/library?summary=1&page=1&limit=12&sortBy=recent'
		);
		// The catalog grid loads only when Browse or Search shows it.
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('sortBy=name'));
	});

	it('opens an artist page from its URL', async () => {
		routerMock.query = { slug: ['artist', 'ar1'] };
		render(<AlbumsPage />);
		expect(
			await screen.findByRole('heading', { level: 1, name: 'Test Artist' })
		).toBeInTheDocument();
		expect(screen.getByText('1 album in the catalog')).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith('/api/music/artist?mbid=ar1');
		expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('sortBy=name'));
	});

	it('opens a playlist made with the + in Your Library', async () => {
		me.playlists = {
			id: 'p9',
			name: 'My Playlist #1',
			description: null,
			trackCount: 0,
			coverUrl: null,
			updatedAt: '',
		};
		render(<AlbumsPage />);
		fireEvent.click(await screen.findByRole('button', { name: 'Create playlist' }));
		await waitFor(() =>
			expect(routerMock.push).toHaveBeenCalledWith('/music/playlist/p9', undefined, {
				shallow: true,
			})
		);
	});

	it('shows Your Library as a page of its own', async () => {
		routerMock.query = { slug: ['library'] };
		render(<AlbumsPage />);
		// The pane beside the page, and the page.
		await waitFor(() =>
			expect(screen.getAllByRole('region', { name: 'Your Library' })).toHaveLength(2)
		);
	});

	it('plays Liked Songs in the liked context', async () => {
		me['likes?ids=1'] = { ids: ['h1-2'] };
		me['likes?page=1&limit=50'] = {
			items: [
				{
					hash: 'h1',
					fileId: 2,
					mbid: 'mb1',
					likedAt: '',
					track: fullAlbum.tracks[1],
					album: summary,
				},
			],
			total: 1,
			hasMore: false,
		};
		routerMock.query = { slug: ['liked'] };
		const { container } = render(<AlbumsPage />);
		fireEvent.click(await screen.findByRole('button', { name: 'Play Closing by Test Artist' }));
		await waitFor(() =>
			expect(container.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example/2')
		);
		expect(JSON.parse(localStorage.getItem('music:player')!).queue.contextId).toBe('liked');
	});

	it('opens a playlist and adds the open album to it from a track menu', async () => {
		me.library = {
			albums: [],
			artists: [],
			playlists: [
				{
					id: 'p1',
					name: 'Road trip',
					description: null,
					trackCount: 0,
					coverUrl: null,
					updatedAt: '',
				},
			],
		};
		me['playlists/p1/tracks'] = { trackCount: 1 };
		routerMock.query = { slug: ['album', 'h1'] };
		render(<AlbumsPage />);
		fireEvent.click(await screen.findByLabelText('More options for Closing'));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Add to playlist' }));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Road trip' }));
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/music/me/playlists/p1/tracks',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ tracks: [{ hash: 'h1', fileId: 2, mbid: 'mb1' }] }),
				})
			)
		);
	});

	it('shows a playlist page from its URL', async () => {
		me['playlists/p1'] = {
			id: 'p1',
			name: 'Road trip',
			description: null,
			trackCount: 1,
			coverUrl: null,
			updatedAt: '',
			tracks: [
				{
					id: 'e1',
					position: 0,
					addedAt: '',
					hash: 'h1',
					fileId: 1,
					mbid: 'mb1',
					track: fullAlbum.tracks[0],
					album: summary,
				},
			],
		};
		routerMock.query = { slug: ['playlist', 'p1'] };
		render(<AlbumsPage />);
		expect(
			await screen.findByRole('button', { name: 'Play Opening by Test Artist' })
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Play Road trip' })).toBeEnabled();
	});

	it('filters Browse by release type', async () => {
		routerMock.query = { slug: ['browse'] };
		const served = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (url, init) =>
			url.includes('sortBy=name')
				? json({ albums: [{ ...summary, primaryType: 'Album' }], totalAlbums: 1 })
				: served(url, init)
		);
		try {
			render(<AlbumsPage />);
			fireEvent.click(await screen.findByRole('button', { name: 'EPs' }));
			await waitFor(() =>
				expect(fetchMock).toHaveBeenCalledWith(
					'/api/music/library?summary=1&page=1&limit=48&sortBy=name&type=ep'
				)
			);
		} finally {
			fetchMock.mockImplementation(served);
		}
	});

	it('plays an album from its card in the grid', async () => {
		routerMock.query = { slug: ['browse'] };
		const { container } = render(<AlbumsPage />);
		fireEvent.click(
			await screen.findByRole('button', { name: 'Play First Album by Test Artist' })
		);
		await waitFor(() =>
			expect(container.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example/1')
		);
		expect(fetchMock).toHaveBeenCalledWith('/api/music/library?hash=h1');
	});

	it('plays an album through the player provider and saves the queue', async () => {
		routerMock.query = { slug: ['album', 'h1'] };
		const { container } = render(<AlbumsPage />);
		fireEvent.click(await screen.findByRole('button', { name: 'Play First Album' }));

		await waitFor(() =>
			expect(container.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example/1')
		);
		expect(await screen.findAllByRole('button', { name: 'Next track' })).not.toHaveLength(0);
		const saved = JSON.parse(localStorage.getItem('music:player')!);
		expect(saved.queue.contextId).toBe('album:h1');
		expect(saved.queue.context).toHaveLength(2);
	});

	describe('on a phone', () => {
		beforeEach(() => viewport(390));

		it('has a tab bar and no side panes', async () => {
			render(<AlbumsPage />);
			const tabs = await screen.findByRole('navigation', { name: 'Music' });
			expect(within(tabs).getByRole('button', { name: 'Home' })).toHaveAttribute(
				'aria-current',
				'page'
			);
			expect(screen.queryByRole('region', { name: 'Your Library' })).toBeNull();
			expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
			fireEvent.click(within(tabs).getByRole('button', { name: 'Search' }));
			expect(routerMock.push).toHaveBeenCalledWith('/music/search', undefined, {
				shallow: true,
			});
			fireEvent.click(within(tabs).getByRole('button', { name: 'Your Library' }));
			expect(routerMock.push).toHaveBeenCalledWith('/music/library', undefined, {
				shallow: true,
			});
		});

		it('puts the search box at the top of the search page', async () => {
			routerMock.query = { slug: ['search'], q: 'first' };
			render(<AlbumsPage />);
			expect(await screen.findByLabelText('Search artists or albums')).toHaveValue('first');
			expect(await screen.findByRole('region', { name: 'Top result' })).toHaveTextContent(
				'First Album'
			);
		});

		it('shows Your Library full width on its tab', async () => {
			routerMock.query = { slug: ['library'] };
			render(<AlbumsPage />);
			expect(await screen.findAllByRole('region', { name: 'Your Library' })).toHaveLength(1);
		});

		it('opens Now Playing full screen from the mini player, with the queue on a tab', async () => {
			savedQueue();
			render(<AlbumsPage />);
			fireEvent.click(await screen.findByRole('button', { name: 'Open Now Playing' }));
			const sheet = await screen.findByRole('dialog', { name: 'Now Playing' });
			fireEvent.click(within(sheet).getByRole('tab', { name: 'Queue' }));
			expect(within(sheet).getByText(/Nothing plays after this/)).toBeInTheDocument();
			fireEvent.click(within(sheet).getByRole('button', { name: 'Close Now Playing' }));
			expect(screen.queryByRole('dialog', { name: 'Now Playing' })).toBeNull();
		});

		it('opens menus as a bottom sheet', async () => {
			routerMock.query = { slug: ['browse'] };
			render(<AlbumsPage />);
			fireEvent.click(
				await screen.findByRole('button', { name: 'More options for First Album' })
			);
			expect(screen.getByRole('menu')).toHaveClass('rounded-t-2xl');
		});
	});
});
