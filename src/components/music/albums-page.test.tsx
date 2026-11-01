import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
}));

import AlbumsPage from '@/pages/albums/[[...slug]]';

const track = (fileId: number, filename: string) => ({
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
		// The Queue button rather than Q: its handler is bound at render, the window's after.
		fireEvent.click(screen.getAllByRole('button', { name: 'Queue' })[0]);
		fireEvent.click(await screen.findByTitle('Clear queue'));
		expect(screen.queryByRole('button', { name: 'Next track' })).toBeNull();
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
		expect(screen.getAllByRole('button', { name: 'Remove from Liked Songs' }).length).toBe(2);
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
		fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
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

	it('keeps the catalog totals in the header while a search narrows the grid', async () => {
		routerMock.query = { slug: ['search'], q: 'first' };
		render(<AlbumsPage />);
		expect(await screen.findByText('11 albums match')).toBeInTheDocument();
		expect(screen.getByText('120 albums · 1500 tracks')).toBeInTheDocument();
		expect(screen.queryByText('11 albums · 260 tracks')).toBeNull();
		expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('search=first'));
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
	it('plays an album from its card in the grid', async () => {
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
		fireEvent.click(await screen.findByRole('button', { name: 'Play' }));

		await waitFor(() =>
			expect(container.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example/1')
		);
		expect(await screen.findAllByRole('button', { name: 'Next track' })).not.toHaveLength(0);
		const saved = JSON.parse(localStorage.getItem('music:player')!);
		expect(saved.queue.contextId).toBe('album:h1');
		expect(saved.queue.context).toHaveLength(2);
	});
});
