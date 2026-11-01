import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArtistView from './ArtistView';
import type { MusicPlayer } from './player/MusicPlayerProvider';
import type { MusicUser } from './user/MusicUserProvider';

let player: MusicPlayer;
let user: MusicUser;
vi.mock('./player/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
vi.mock('./user/MusicUserProvider', () => ({ useMusicUser: () => user }));

const GREEN_DAY = '084308bd-1654-436f-ba03-df6697104e19';
const album = (hash: string, name: string, year: number, primaryType?: string) => ({
	hash,
	mbid: `mb-${hash}`,
	artistMbid: GREEN_DAY,
	artist: 'Green Day',
	album: name,
	year,
	coverUrl: null,
	tracks: [],
	totalBytes: 0,
	trackCount: 12,
	primaryType,
});
const popularItem = (fileId: number, title: string) => ({
	hash: 'h1',
	fileId,
	mbid: 'mb-h1',
	plays: 10 - fileId,
	track: {
		id: `h1-${fileId}`,
		hash: 'h1',
		fileId,
		link: `https://real-debrid.com/d/${fileId}`,
		path: `/0${fileId} ${title}.flac`,
		bytes: 1,
		trackNumber: fileId + 4,
		filename: `0${fileId} ${title}.flac`,
		title,
	},
	album: { ...album('h1', '¡Tré!', 2012), trackCount: 12 },
});

const json = (body: unknown, status = 200) =>
	({ ok: status < 300, status, json: async () => body }) as Response;

let artistAnswer: Response;
let popularAnswer: Response;
const fetchMock = vi.fn(async (url: string) =>
	url.startsWith('/api/music/artist?') ? artistAnswer : popularAnswer
);

const props = () => ({
	mbid: GREEN_DAY,
	navigate: vi.fn(),
	onPlayAlbum: vi.fn(),
	onAlbumMenu: vi.fn(),
	onTrackMenu: vi.fn(),
	onCoverLoaded: vi.fn(),
});

describe('ArtistView', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockClear();
		artistAnswer = json({
			artist: { mbid: GREEN_DAY, name: 'Green Day' },
			albums: [album('h1', '¡Tré!', 2012, 'Album'), album('h2', 'Dookie', 1994, 'Album')],
		});
		popularAnswer = json({ items: [] });
		player = {
			nowPlaying: null,
			isPlaying: false,
			playContext: vi.fn(),
			togglePlay: vi.fn(),
		} as unknown as MusicPlayer;
		user = {
			isFollowed: () => false,
			followArtist: vi.fn(),
			unfollowArtist: vi.fn(),
			isLiked: () => false,
			like: vi.fn(),
			unlike: vi.fn(),
		} as unknown as MusicUser;
	});
	afterEach(() => vi.unstubAllGlobals());

	it('heads the page with the name, the album count and Follow', async () => {
		render(<ArtistView {...props()} />);
		expect(await screen.findByRole('heading', { level: 1, name: 'Green Day' })).toBeVisible();
		expect(screen.getByText('2 albums in the catalog')).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(`/api/music/artist?mbid=${GREEN_DAY}`);
		expect(fetchMock).toHaveBeenCalledWith(
			`/api/music/popular?artistMbid=${GREEN_DAY}&limit=10`
		);
		fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
		expect(user.followArtist).toHaveBeenCalledWith(GREEN_DAY, 'Green Day');
	});

	it('unfollows an artist it follows', async () => {
		user = { ...user, isFollowed: (mbid: string) => mbid === GREEN_DAY } as MusicUser;
		render(<ArtistView {...props()} />);
		const button = await screen.findByRole('button', { name: 'Following' });
		expect(button).toHaveAttribute('aria-pressed', 'true');
		fireEvent.click(button);
		expect(user.unfollowArtist).toHaveBeenCalledWith(GREEN_DAY);
	});

	it('plays the popular tracks, ranked, in the artist context', async () => {
		popularAnswer = json({
			items: [popularItem(1, 'Brutal Love'), popularItem(2, 'Missing You')],
		});
		render(<ArtistView {...props()} />);
		const popular = await screen.findByRole('region', { name: 'Popular' });
		const rows = within(popular).getAllByRole('button', { name: /^Play .* by Green Day$/ });
		expect(rows.map((row) => row.textContent?.slice(0, 1))).toEqual(['1', '2']);
		fireEvent.click(rows[1]);
		expect(player.playContext).toHaveBeenLastCalledWith(
			expect.arrayContaining([expect.objectContaining({ album: expect.anything() })]),
			1,
			`artist:${GREEN_DAY}:popular`
		);
		fireEvent.click(screen.getByRole('button', { name: 'Play Green Day' }));
		expect(player.playContext).toHaveBeenLastCalledWith(
			expect.any(Array),
			0,
			`artist:${GREEN_DAY}:popular`
		);
	});

	it('plays the newest album when nobody has played the artist yet', async () => {
		const p = props();
		render(<ArtistView {...p} />);
		fireEvent.click(await screen.findByRole('button', { name: 'Play Green Day' }));
		expect(p.onPlayAlbum).toHaveBeenCalledWith(expect.objectContaining({ album: '¡Tré!' }));
		expect(screen.queryByRole('region', { name: 'Popular' })).toBeNull();
	});

	it('filters the discography by the types it holds', async () => {
		artistAnswer = json({
			artist: { mbid: GREEN_DAY, name: 'Green Day' },
			albums: [
				album('h1', '¡Tré!', 2012, 'Album'),
				album('h3', 'Oh Love', 2012, 'Single'),
				album('h2', 'Dookie', 1994, 'Album'),
			],
		});
		render(<ArtistView {...props()} />);
		const discography = await screen.findByRole('region', { name: 'Discography' });
		const chips = within(discography).getByRole('group', { name: 'Release type' });
		expect(
			within(chips)
				.getAllByRole('button')
				.map((b) => b.textContent)
		).toEqual(['Albums', 'Singles', 'All']);
		const cards = () =>
			within(discography)
				.getAllByRole('button', { name: /^Open / })
				.map((card) => card.getAttribute('aria-label'));
		expect(cards()).toEqual([
			'Open ¡Tré! by Green Day',
			'Open Oh Love by Green Day',
			'Open Dookie by Green Day',
		]);
		fireEvent.click(within(chips).getByRole('button', { name: 'Singles' }));
		expect(cards()).toEqual(['Open Oh Love by Green Day']);
	});

	it('hides the type chips while no album has a type', async () => {
		artistAnswer = json({
			artist: { mbid: GREEN_DAY, name: 'Green Day' },
			albums: [album('h1', '¡Tré!', 2012)],
		});
		render(<ArtistView {...props()} />);
		await screen.findByRole('region', { name: 'Discography' });
		expect(screen.queryByRole('group', { name: 'Release type' })).toBeNull();
		expect(screen.getByText('1 album in the catalog')).toBeInTheDocument();
	});

	it('says so when the catalog has no album of the artist', async () => {
		artistAnswer = json({ error: 'Artist not found' }, 404);
		const p = props();
		render(<ArtistView {...p} />);
		expect(await screen.findByText('No albums from this artist yet')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Browse the catalog' }));
		expect(p.navigate).toHaveBeenCalledWith({ name: 'browse' });
	});
});
