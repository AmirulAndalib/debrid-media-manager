import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenu, { albumMenuItems, MenuActions, MenuItem, trackMenuItems } from './ContextMenu';
import type { MusicUser } from './user/MusicUserProvider';

const album = {
	hash: 'h1',
	mbid: 'mb1',
	artistMbid: null,
	artist: 'Test Artist',
	album: 'First Album',
	year: 2020,
	coverUrl: null,
	tracks: [],
	totalBytes: 0,
	trackCount: 2,
};
const track = (fileId: number) => ({
	id: `h1-${fileId}`,
	hash: 'h1',
	fileId,
	link: `https://real-debrid.com/d/${fileId}`,
	path: `/${fileId}.flac`,
	bytes: 1,
	trackNumber: fileId,
	filename: `0${fileId} - Song.flac`,
});
const fullAlbum = { ...album, tracks: [track(1), track(2)] };

const actions = (user: Partial<MusicUser> = {}): MenuActions => ({
	player: { playContext: vi.fn(), playNext: vi.fn(), addToQueue: vi.fn() },
	user: {
		library: { albums: [], artists: [], playlists: [] },
		isLiked: () => false,
		isSaved: () => false,
		like: vi.fn(),
		unlike: vi.fn(),
		saveAlbum: vi.fn(),
		unsaveAlbum: vi.fn(),
		createPlaylist: vi.fn(async () => ({
			id: 'new',
			name: 'My Playlist #1',
			description: null,
			trackCount: 0,
			coverUrl: null,
			updatedAt: '',
		})),
		addToPlaylist: vi.fn(async () => true),
		...user,
	} as MusicUser,
	navigate: vi.fn(),
	withTracks: vi.fn(async () => fullAlbum),
	download: vi.fn(),
	downloadAlbum: vi.fn(),
});

const items = (onSelect = vi.fn()): MenuItem[] => [
	{ label: 'Play next', onSelect },
	{ label: 'Add to playlist', items: [{ label: 'Road trip', onSelect }] },
	{ label: 'Download', onSelect },
];
const labels = (menu: MenuItem[]) => menu.map((item) => item.label);
const select = (menu: MenuItem[], label: string) => menu.find((i) => i.label === label)!;

describe('ContextMenu', () => {
	afterEach(() => vi.restoreAllMocks());

	it('opens as a menu at the pointer with the first item focused', () => {
		render(<ContextMenu menu={{ items: items(), x: 40, y: 50 }} onClose={vi.fn()} />);
		const menu = screen.getByRole('menu');
		expect(menu).toHaveStyle({ left: '40px', top: '50px' });
		expect(screen.getAllByRole('menuitem')).toHaveLength(3);
		expect(screen.getByRole('menuitem', { name: 'Play next' })).toHaveFocus();
	});

	it('stays on screen near the right and bottom edges', () => {
		Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
		Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			width: 240,
			height: 300,
		} as DOMRect);
		render(<ContextMenu menu={{ items: items(), x: 380, y: 450 }} onClose={vi.fn()} />);
		expect(screen.getByRole('menu')).toHaveStyle({ left: '152px', top: '150px' });
	});

	it('moves with the arrow keys and keeps them from the player shortcuts', () => {
		const playerKeys = vi.fn();
		window.addEventListener('keydown', playerKeys);
		render(<ContextMenu menu={{ items: items(), x: 0, y: 0 }} onClose={vi.fn()} />);
		const menu = screen.getByRole('menu');
		fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(screen.getByRole('menuitem', { name: 'Add to playlist' })).toHaveFocus();
		fireEvent.keyDown(menu, { key: 'ArrowUp' });
		fireEvent.keyDown(menu, { key: 'ArrowUp' });
		expect(screen.getByRole('menuitem', { name: 'Download' })).toHaveFocus();
		fireEvent.keyDown(menu, { key: 'Home' });
		expect(screen.getByRole('menuitem', { name: 'Play next' })).toHaveFocus();
		expect(playerKeys).not.toHaveBeenCalled();
		window.removeEventListener('keydown', playerKeys);
	});

	it('opens a submenu in place and goes back with ArrowLeft', () => {
		const onSelect = vi.fn();
		const onClose = vi.fn();
		render(<ContextMenu menu={{ items: items(onSelect), x: 0, y: 0 }} onClose={onClose} />);
		fireEvent.click(screen.getByRole('menuitem', { name: 'Add to playlist' }));
		expect(screen.getByRole('menuitem', { name: 'Back' })).toHaveFocus();
		expect(screen.queryByRole('menuitem', { name: 'Download' })).toBeNull();
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowLeft' });
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowRight' });
		fireEvent.click(screen.getByRole('menuitem', { name: 'Road trip' }));
		expect(onClose).toHaveBeenCalledOnce();
		expect(onSelect).toHaveBeenCalledOnce();
	});

	it.each([
		['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
		['an outside click', () => fireEvent.mouseDown(document.body)],
		['a scroll', () => fireEvent.scroll(window)],
	])('closes on %s', (_, act) => {
		const onClose = vi.fn();
		render(<ContextMenu menu={{ items: items(), x: 0, y: 0 }} onClose={onClose} />);
		fireEvent.mouseDown(screen.getByRole('menu'));
		expect(onClose).not.toHaveBeenCalled();
		act();
		expect(onClose).toHaveBeenCalled();
	});

	it('renders as a bottom sheet on phones', () => {
		render(<ContextMenu menu={{ items: items(), x: 40, y: 50 }} sheet onClose={vi.fn()} />);
		const menu = screen.getByRole('menu');
		expect(menu.getAttribute('style')).toBeNull();
		expect(menu).toHaveClass('rounded-t-2xl');
	});
});

describe('menu builders', () => {
	it('builds the track menu and acts on the track', () => {
		const a = actions();
		const menu = trackMenuItems({ track: track(1), album }, a);
		expect(labels(menu)).toEqual([
			'Play next',
			'Add to queue',
			'Add to playlist',
			'Save to Liked Songs',
			'Go to album',
			'Go to artist',
			'Download',
		]);
		select(menu, 'Play next').onSelect!();
		expect(a.player.playNext).toHaveBeenCalledWith([{ track: track(1), album }]);
		select(menu, 'Save to Liked Songs').onSelect!();
		expect(a.user.like).toHaveBeenCalledWith({ hash: 'h1', fileId: 1, mbid: 'mb1' });
		select(menu, 'Go to album').onSelect!();
		expect(a.navigate).toHaveBeenCalledWith({ name: 'album', hash: 'h1' });

		const liked = trackMenuItems({ track: track(1), album }, actions({ isLiked: () => true }));
		expect(labels(liked)).toContain('Remove from Liked Songs');
	});

	it("lists the user's playlists and a new one under Add to playlist", async () => {
		const a = actions({
			library: {
				albums: [],
				artists: [],
				playlists: [
					{
						id: 'p1',
						name: 'Road trip',
						description: null,
						trackCount: 3,
						coverUrl: null,
						updatedAt: '',
					},
				],
			},
		});
		const submenu = select(
			trackMenuItems({ track: track(2), album }, a),
			'Add to playlist'
		).items!;
		expect(labels(submenu)).toEqual(['New playlist', 'Road trip']);
		select(submenu, 'Road trip').onSelect!();
		await waitFor(() =>
			expect(a.user.addToPlaylist).toHaveBeenCalledWith('p1', [
				{ hash: 'h1', fileId: 2, mbid: 'mb1' },
			])
		);
		select(submenu, 'New playlist').onSelect!();
		await waitFor(() =>
			expect(a.user.addToPlaylist).toHaveBeenCalledWith('new', expect.any(Array))
		);
	});

	it('loads a summary album before playing or adding it', async () => {
		const a = actions();
		const menu = albumMenuItems(album, a);
		expect(labels(menu)).toEqual([
			'Play',
			'Play next',
			'Add to queue',
			'Save to Your Library',
			'Add to playlist',
			'Download album',
			'Go to artist',
		]);
		select(menu, 'Play').onSelect!();
		await waitFor(() =>
			expect(a.player.playContext).toHaveBeenCalledWith(
				[
					{ track: track(1), album: fullAlbum },
					{ track: track(2), album: fullAlbum },
				],
				0,
				'album:h1'
			)
		);
		expect(a.withTracks).toHaveBeenCalledWith(album);
		select(select(menu, 'Add to playlist').items!, 'New playlist').onSelect!();
		await waitFor(() =>
			expect(a.user.addToPlaylist).toHaveBeenCalledWith('new', [
				{ hash: 'h1', fileId: 1, mbid: 'mb1' },
				{ hash: 'h1', fileId: 2, mbid: 'mb1' },
			])
		);
		select(menu, 'Save to Your Library').onSelect!();
		expect(a.user.saveAlbum).toHaveBeenCalledWith('mb1', album);
		select(menu, 'Download album').onSelect!();
		await waitFor(() => expect(a.downloadAlbum).toHaveBeenCalledWith(fullAlbum));

		const saved = albumMenuItems(album, actions({ isSaved: () => true }));
		expect(labels(saved)).toContain('Remove from Your Library');
	});
});
