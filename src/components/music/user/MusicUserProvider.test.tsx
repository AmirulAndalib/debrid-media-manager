import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicUser, MusicUserProvider, useMusicUser } from './MusicUserProvider';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({
	__esModule: true,
	default: { error: toastError, success: vi.fn() },
}));

const ref = { hash: 'a'.repeat(40), fileId: 3, mbid: '11111111-1111-1111-1111-111111111111' };
const summary = {
	hash: 'h1',
	mbid: 'mb-album',
	artistMbid: null,
	artist: 'Artist',
	album: 'Album',
	year: 2020,
	coverUrl: null,
	trackCount: 9,
};

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) =>
	new Response(status === 204 ? null : JSON.stringify(body), { status });

let handle: Handler;
let tokens: number;
const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
	if (url === '/api/music/session') {
		tokens++;
		return Promise.resolve(
			json({ token: `t${tokens}`, userId: 'user-1', exp: Date.now() + 7 * 864e5 })
		);
	}
	return Promise.resolve(handle(url, init));
});
const meDefaults: Handler = (url) =>
	url === '/api/music/me/library'
		? json({ albums: [], artists: [], playlists: [] })
		: url === '/api/music/me/likes?ids=1'
			? json({ ids: [] })
			: json(null, 204);
const tokenOf = (init: RequestInit) =>
	(init.headers as Record<string, string>)['x-dmm-music-token'];

let user: MusicUser;
function Probe() {
	user = useMusicUser();
	return null;
}
const mount = async (account = 'rd-1') => {
	render(
		<MusicUserProvider accessToken="rd-token" account={account}>
			<Probe />
		</MusicUserProvider>
	);
	await waitFor(() => expect(user.ready).toBe(true));
};

describe('MusicUserProvider', () => {
	beforeEach(() => {
		localStorage.clear();
		tokens = 0;
		handle = meDefaults;
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		fetchMock.mockClear();
		toastError.mockClear();
	});

	it('mints one session for its first requests and keeps it in localStorage', async () => {
		handle = (url, init) =>
			url === '/api/music/me/likes?ids=1'
				? json({ ids: [`${ref.hash}-3`] })
				: meDefaults(url, init);
		await mount();
		expect(fetchMock.mock.calls.filter(([url]) => url === '/api/music/session')).toHaveLength(
			1
		);
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
			accessToken: 'rd-token',
		});
		expect(JSON.parse(localStorage.getItem('music:session')!)).toMatchObject({
			token: 't1',
			userId: 'user-1',
		});
		expect(user.userId).toBe('user-1');
		expect(user.isLiked(`${ref.hash}-3`)).toBe(true);
	});

	it('reuses a stored session and mints a new one when it has expired', async () => {
		localStorage.setItem(
			'music:session',
			JSON.stringify({
				token: 'stored',
				userId: 'user-1',
				exp: Date.now() + 3600e3,
				account: 'rd-1',
			})
		);
		await mount();
		expect(tokens).toBe(0);
		expect(tokenOf(fetchMock.mock.calls[0][1]!)).toBe('stored');

		localStorage.setItem(
			'music:session',
			JSON.stringify({ token: 'old', userId: 'user-1', exp: Date.now() - 1, account: 'rd-1' })
		);
		cleanup();
		await mount();
		expect(tokens).toBe(1);
	});

	// Switching Real-Debrid accounts without logging out showed the previous one's library.
	it.each([
		['another account', { account: 'rd-2' }],
		['no account, as saved before sessions were bound', {}],
	])('mints a new session over a saved one of %s', async (_, owner) => {
		localStorage.setItem(
			'music:session',
			JSON.stringify({
				token: 'stored',
				userId: 'user-0',
				exp: Date.now() + 3600e3,
				...owner,
			})
		);
		await mount('rd-1');
		expect(tokens).toBe(1);
		expect(fetchMock.mock.calls.slice(1).map(([, init]) => tokenOf(init!))).not.toContain(
			'stored'
		);
		expect(JSON.parse(localStorage.getItem('music:session')!)).toMatchObject({
			token: 't1',
			account: 'rd-1',
		});
	});

	it('mints a new token on a 401 and retries the request once', async () => {
		await mount();
		handle = (url, init) =>
			tokenOf(init) === 't1' ? json({ error: 'expired' }, 401) : meDefaults(url, init);
		const res = await user.musicFetch('/api/music/me/history?limit=5');
		expect(res.status).toBe(204);
		expect(tokens).toBe(2);
		expect(tokenOf(fetchMock.mock.calls.at(-1)![1]!)).toBe('t2');
		expect(toastError).not.toHaveBeenCalled();
	});

	it('gives up with one toast when the new token is refused too', async () => {
		await mount();
		handle = () => json({ error: 'nope' }, 401);
		await expect(user.musicFetch('/api/music/me/history')).rejects.toThrow();
		await waitFor(() => expect(user.userId).toBeNull());
		const calls = fetchMock.mock.calls.length;
		await expect(user.musicFetch('/api/music/me/history')).rejects.toThrow();
		expect(fetchMock.mock.calls.length).toBe(calls);
		expect(toastError).toHaveBeenCalledOnce();
		expect(localStorage.getItem('music:session')).toBeNull();
	});

	it('shows a like at once and takes it back when the server refuses', async () => {
		await mount();
		let finish!: (res: Response) => void;
		handle = () => new Promise((resolve) => (finish = resolve));
		act(() => user.like(ref));
		expect(user.isLiked(`${ref.hash}-3`)).toBe(true);
		await act(async () => finish(json({ error: 'down' }, 500)));
		expect(user.isLiked(`${ref.hash}-3`)).toBe(false);
		expect(toastError).toHaveBeenCalledWith('Could not add to Liked Songs');
	});

	it('keeps a like the server accepted', async () => {
		await mount();
		act(() => user.like(ref));
		await waitFor(() =>
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/music/me/likes',
				expect.objectContaining({ method: 'PUT', body: JSON.stringify(ref) })
			)
		);
		expect(user.isLiked(`${ref.hash}-3`)).toBe(true);
		act(() => user.unlike(ref));
		expect(user.isLiked(`${ref.hash}-3`)).toBe(false);
	});

	it('saves an album to the library at once and rolls it back on failure', async () => {
		await mount();
		let finish!: (res: Response) => void;
		handle = () => new Promise((resolve) => (finish = resolve));
		act(() => user.saveAlbum('mb-album', summary));
		expect(user.isSaved('mb-album')).toBe(true);
		expect(user.library.albums[0].album).toMatchObject({ album: 'Album', trackCount: 9 });
		await act(async () => finish(json({ error: 'down' }, 500)));
		expect(user.isSaved('mb-album')).toBe(false);
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/music/me/albums/mb-album',
			expect.objectContaining({ method: 'PUT' })
		);
	});

	it('puts an unsaved album back where it was when the server refuses', async () => {
		handle = (url, init) =>
			url === '/api/music/me/library'
				? json({
						albums: ['a', 'b', 'c'].map((mbid) => ({ mbid, savedAt: '', album: null })),
						artists: [],
						playlists: [],
					})
				: meDefaults(url, init);
		await mount();
		handle = () => json({ error: 'down' }, 500);
		await act(async () => user.unsaveAlbum('b'));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
		expect(user.library.albums.map((a) => a.mbid)).toEqual(['a', 'b', 'c']);
	});

	it('creates, renames and fills a playlist', async () => {
		await mount();
		const created = {
			id: 'p1',
			name: 'My Playlist #1',
			description: null,
			trackCount: 0,
			coverUrl: null,
			updatedAt: '',
		};
		handle = (url, init) => {
			if (url === '/api/music/me/playlists') {
				expect(JSON.parse(String(init.body))).toEqual({ name: 'My Playlist #1' });
				return json(created, 201);
			}
			if (url === '/api/music/me/playlists/p1' && init.method === 'PATCH') {
				return json({ ...created, name: 'Road trip' });
			}
			if (url === '/api/music/me/playlists/p1/tracks' && init.method === 'POST') {
				return json({ trackCount: 1 }, 201);
			}
			return json(null, 500);
		};
		await act(async () => void (await user.createPlaylist()));
		expect(user.library.playlists[0].name).toBe('My Playlist #1');
		await act(async () => void (await user.renamePlaylist('p1', 'Road trip')));
		expect(user.library.playlists[0].name).toBe('Road trip');
		await act(async () => void (await user.addToPlaylist('p1', [ref])));
		expect(user.library.playlists[0].trackCount).toBe(1);
		let ok = true;
		await act(async () => void (ok = await user.reorderPlaylist('p1', ['x'])));
		expect(ok).toBe(false);
		expect(toastError).toHaveBeenCalledWith('Could not reorder the playlist');
	});
});
