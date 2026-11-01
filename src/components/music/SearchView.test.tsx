import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicPlayer } from './player/MusicPlayerProvider';
import SearchView, { topArtist } from './SearchView';
import type { MusicUser } from './user/MusicUserProvider';

let player: MusicPlayer;
let user: MusicUser;
vi.mock('./player/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
vi.mock('./user/MusicUserProvider', () => ({ useMusicUser: () => user }));

const GREEN_DAY = '084308bd-1654-436f-ba03-df6697104e19';
const album = (hash: string, name: string, primaryType?: string) => ({
	hash,
	mbid: `mb-${hash}`,
	artistMbid: GREEN_DAY,
	artist: 'Green Day',
	album: name,
	year: 2012,
	coverUrl: null,
	tracks: [],
	totalBytes: 0,
	trackCount: 12,
	primaryType,
});
const song = (fileId: number) => ({
	track: {
		id: `h1-${fileId}`,
		hash: 'h1',
		fileId,
		link: `https://real-debrid.com/d/${fileId}`,
		path: `/0${fileId} Song ${fileId}.flac`,
		bytes: 1,
		trackNumber: fileId,
		filename: `0${fileId} Song ${fileId}.flac`,
		title: `Song ${fileId}`,
		durationMs: 200_000,
	},
	album: album('h1', '¡Tré!'),
});
const greenDay = { mbid: GREEN_DAY, name: 'Green Day', albumCount: 3, coverUrl: null };

const json = (body: unknown, status = 200) =>
	({ ok: status < 300, status, json: async () => body }) as Response;
let answer: unknown;
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(answer));
// Cards without a cover ask for one; only the searches matter here.
const searches = () =>
	fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/music/search'));

const props = () => ({
	q: 'green day',
	navigate: vi.fn(),
	onPlayAlbum: vi.fn(),
	onAlbumMenu: vi.fn(),
	onTrackMenu: vi.fn(),
	onCoverLoaded: vi.fn(),
	recentAlbums: [album('n1', 'New Album', 'EP')],
	onBrowseType: vi.fn(),
});

/** Past the debounce, with the answer rendered. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(250));

describe('SearchView', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockClear();
		answer = {
			artists: [greenDay],
			albums: [album('h1', '¡Tré!', 'Album'), album('h2', 'Dookie', 'Album')],
			tracks: [1, 2, 3, 4, 5, 6, 7].map(song),
		};
		player = {
			nowPlaying: null,
			isPlaying: false,
			playContext: vi.fn(),
		} as unknown as MusicPlayer;
		user = { isLiked: () => false, like: vi.fn(), unlike: vi.fn() } as unknown as MusicUser;
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('searches 250 ms after the text stops changing', async () => {
		const p = props();
		const { rerender } = render(<SearchView {...p} q="gre" />);
		await act(() => vi.advanceTimersByTimeAsync(200));
		rerender(<SearchView {...p} q="green day " />);
		await act(() => vi.advanceTimersByTimeAsync(249));
		expect(searches()).toEqual([]);
		await settle();
		expect(searches()).toEqual(['/api/music/search?q=green%20day']);
	});

	it('shows the artist the query names as the top result, then songs, artists and albums', async () => {
		const p = props();
		render(<SearchView {...p} />);
		await settle();
		expect(
			screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
		).toEqual(['Top result', 'Songs', 'Artists', 'Albums']);
		const top = screen.getByRole('region', { name: 'Top result' });
		fireEvent.click(within(top).getByRole('button', { name: 'Open Green Day' }));
		expect(p.navigate).toHaveBeenCalledWith({ name: 'artist', mbid: GREEN_DAY });

		const artists = screen.getByRole('region', { name: 'Artists' });
		fireEvent.click(within(artists).getByRole('button', { name: 'Open Green Day' }));
		expect(p.navigate).toHaveBeenCalledTimes(2);
		expect(
			within(screen.getByRole('region', { name: 'Albums' })).getAllByRole('button', {
				name: /^Open .* by Green Day$/,
			})
		).toHaveLength(2);
	});

	it('plays songs as a search context and shows them all on request', async () => {
		render(<SearchView {...props()} />);
		await settle();
		const songs = screen.getByRole('region', { name: 'Songs' });
		const rows = () => within(songs).getAllByRole('button', { name: /^Play Song/ });
		expect(rows()).toHaveLength(5);
		fireEvent.click(rows()[2]);
		expect(player.playContext).toHaveBeenCalledWith(
			expect.objectContaining({ length: 7 }),
			2,
			'search:green day'
		);
		fireEvent.click(within(songs).getByRole('button', { name: 'Show all' }));
		expect(rows()).toHaveLength(7);
	});

	it('makes the first album the top result when no artist is named', async () => {
		const p = props();
		render(<SearchView {...p} q="tre" />);
		await settle();
		const top = screen.getByRole('region', { name: 'Top result' });
		expect(top).toHaveTextContent('¡Tré!');
		fireEvent.click(within(top).getByRole('button', { name: 'Play ¡Tré!' }));
		expect(p.onPlayAlbum).toHaveBeenCalledWith(expect.objectContaining({ hash: 'h1' }));
		expect(p.navigate).not.toHaveBeenCalled();
	});

	it('says what the catalog holds when nothing matches', async () => {
		answer = { artists: [], albums: [], tracks: [] };
		render(<SearchView {...props()} q="zzz" />);
		await settle();
		expect(screen.getByText('Nothing in the catalog for “zzz”')).toBeInTheDocument();
		expect(screen.getByText(/albums cached on Real-Debrid/)).toBeInTheDocument();
	});

	it('shows the type chips and the newest albums before anything is typed', async () => {
		const p = props();
		render(<SearchView {...p} q=" " />);
		await settle();
		expect(searches()).toEqual([]);
		expect(screen.getByRole('region', { name: 'New in the catalog' })).toHaveTextContent(
			'New Album'
		);
		fireEvent.click(screen.getByRole('button', { name: 'EPs' }));
		expect(p.onBrowseType).toHaveBeenCalledWith('ep');
	});

	it('names an artist as the top result only when the query reads like the name', () => {
		const beatles = { ...greenDay, name: 'The Beatles' };
		expect(topArtist([greenDay], 'Green')).toBe(greenDay);
		expect(topArtist([greenDay], 'green day!')).toBe(greenDay);
		expect(topArtist([beatles], 'beatles')).toBe(beatles);
		expect(topArtist([beatles], 'the beat')).toBe(beatles);
		expect(topArtist([greenDay], 'day')).toBeNull();
		expect(topArtist([greenDay], '!!')).toBeNull();
	});
});
