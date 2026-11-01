import catalog from '@/test/fixtures/musicbrainz/catalog-2026-11-01.json';
import { getDirectory } from '@/utils/musicTracks';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlbumDetailView, { albumFacts, discDividers, formatLength } from './AlbumDetailView';
import type { MusicPlayer } from './player/MusicPlayerProvider';
import type { MusicUser } from './user/MusicUserProvider';

let player: MusicPlayer;
let user: MusicUser;
vi.mock('./player/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
vi.mock('./user/MusicUserProvider', () => ({ useMusicUser: () => user }));

const JUSTICE_HASH = 'f590ebc219813f8765bd397b5c63d1413177287a';

const makeTrack = (id: string, filename: string, trackNumber: number, extra = {}) => ({
	id,
	hash: 'abc123',
	fileId: trackNumber,
	link: `https://example.com/link-${id}`,
	path: `/music/${filename}`,
	bytes: 30 * 1024 * 1024,
	trackNumber,
	filename,
	...extra,
});

const makeAlbum = (overrides = {}) => ({
	hash: 'abc123',
	mbid: 'mbid-1',
	artistMbid: null as string | null,
	artist: 'Test Artist',
	album: 'Test Album',
	year: 2023,
	coverUrl: null as string | null,
	tracks: [makeTrack('t1', '01 - First.flac', 1), makeTrack('t2', '02 - Second.flac', 2)],
	totalBytes: 60 * 1024 * 1024,
	trackCount: 2,
	...overrides,
});

const props = () => ({
	album: makeAlbum(),
	navigate: vi.fn(),
	onDownloadAlbum: vi.fn(),
	onMenu: vi.fn(),
	onTrackMenu: vi.fn(),
});

describe('AlbumDetailView', () => {
	beforeEach(() => {
		player = {
			nowPlaying: null,
			isPlaying: false,
			isShuffled: false,
			playContext: vi.fn(),
			togglePlay: vi.fn(),
			toggleShuffle: vi.fn(),
		} as unknown as MusicPlayer;
		user = {
			isSaved: () => false,
			saveAlbum: vi.fn(),
			unsaveAlbum: vi.fn(),
			isLiked: (id: string) => id === 't2',
			like: vi.fn(),
			unlike: vi.fn(),
		} as unknown as MusicUser;
	});
	afterEach(() => vi.unstubAllGlobals());

	it('heads the album with its title, artist and what MusicBrainz knows', () => {
		const p = props();
		render(<AlbumDetailView {...p} />);
		expect(screen.getByRole('heading', { level: 1, name: 'Test Album' })).toBeInTheDocument();
		// Before the backfill: filename titles, no type, no lengths.
		expect(screen.getByText('Album · 2023 · 2 songs · 60.0 MB')).toBeInTheDocument();
		expect(screen.getByText('Size')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Test Artist' }));
		expect(p.navigate).toHaveBeenCalledWith({ name: 'search', q: 'Test Artist' });
	});

	it('gives the length once every track has one, and links the artist page', () => {
		const p = props();
		p.album = makeAlbum({
			artistMbid: 'ar-1',
			primaryType: 'EP',
			tracks: p.album.tracks.map((t) => ({ ...t, durationMs: 61_000 })),
		});
		render(<AlbumDetailView {...p} />);
		expect(screen.getByText('EP · 2023 · 2 songs · 2 min')).toBeInTheDocument();
		expect(screen.getByText('Time')).toBeInTheDocument();
		expect(screen.getAllByText('1:01')).toHaveLength(2);
		fireEvent.click(screen.getByRole('button', { name: 'Test Artist' }));
		expect(p.navigate).toHaveBeenCalledWith({ name: 'artist', mbid: 'ar-1' });
	});

	it('falls back to the size while a track has no length, and writes hours', () => {
		const album = makeAlbum({ year: null });
		album.tracks[0] = { ...album.tracks[0], durationMs: 61_000 } as (typeof album.tracks)[0];
		expect(albumFacts(album)).toBe('Album · 2 songs · 60.0 MB');
		expect(formatLength(46 * 60_000 + 20_000)).toBe('46 min');
		expect(formatLength(72 * 60_000)).toBe('1 hr 12 min');
	});

	// The real 2026-11-01 listing of the …And Justice for All box set: eight disc folders.
	it('divides a box set by disc and calls it a pack', () => {
		const files = catalog.files[JUSTICE_HASH].map((file) => ({
			...makeTrack(`j-${file.fileId}`, file.path.split('/').pop()!, file.trackNumber),
			path: file.path,
		})).sort(
			(a, b) =>
				getDirectory(a.path).localeCompare(getDirectory(b.path), undefined, {
					numeric: true,
				}) || a.trackNumber - b.trackNumber
		);
		const p = props();
		p.album = makeAlbum({ tracks: files, trackCount: files.length, pack: true });
		render(<AlbumDetailView {...p} />);
		expect(screen.getByText('Pack · 147 files')).toBeInTheDocument();
		expect(screen.getAllByText(/^Disc \d$/).map((d) => d.textContent)).toEqual(
			[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Disc ${n}`)
		);
		expect(discDividers(p.album.tracks.slice(0, 1))).toEqual([null]);
		expect(discDividers([{ path: '/CD02/01.flac' }, { path: '/Bonus/01.flac' }])).toEqual([
			'Disc 2',
			'Bonus',
		]);
	});

	it('has Play, Shuffle, a heart, Download and a menu, and nothing else', () => {
		const p = props();
		render(<AlbumDetailView {...p} />);
		fireEvent.click(screen.getByRole('button', { name: 'Play Test Album' }));
		expect(player.playContext).toHaveBeenCalledWith(
			p.album.tracks.map((track) => ({ track, album: p.album })),
			0,
			'album:abc123'
		);
		fireEvent.click(screen.getByRole('button', { name: 'Shuffle Test Album' }));
		expect(player.toggleShuffle).toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', { name: 'Save to Your Library' }));
		expect(user.saveAlbum).toHaveBeenCalledWith('mbid-1', p.album);
		fireEvent.click(screen.getByRole('button', { name: 'Download Test Album' }));
		expect(p.onDownloadAlbum).toHaveBeenCalledWith(p.album);
		fireEvent.click(screen.getByRole('button', { name: 'More options for Test Album' }));
		expect(p.onMenu).toHaveBeenCalled();
		// Play next and Add to queue live in the menu; the top bar goes back.
		for (const gone of [/Play Next/i, /Add to Queue/i, /Back/]) {
			expect(screen.queryByRole('button', { name: gone })).toBeNull();
		}
	});

	it('pauses from its Play button while the album plays', () => {
		player = {
			...player,
			isPlaying: true,
			nowPlaying: { item: { track: makeAlbum().tracks[1] }, contextId: 'album:abc123' },
		} as unknown as MusicPlayer;
		render(<AlbumDetailView {...props()} />);
		fireEvent.click(screen.getByRole('button', { name: 'Pause Test Album' }));
		expect(player.togglePlay).toHaveBeenCalled();
		expect(player.playContext).not.toHaveBeenCalled();
	});

	it('lists tracks with a heart and a menu, without a download button or the artist', () => {
		const p = props();
		render(<AlbumDetailView {...p} />);
		const row = screen.getByRole('button', { name: 'Play First by Test Artist' });
		expect(within(row).queryByTitle('Download')).toBeNull();
		expect(within(row).queryByText('Test Artist')).toBeNull();
		fireEvent.click(within(row).getByLabelText('Save to Liked Songs'));
		expect(user.like).toHaveBeenCalledWith({ hash: 'abc123', fileId: 1, mbid: 'mbid-1' });
		const second = screen.getByRole('button', { name: 'Play Second by Test Artist' });
		fireEvent.click(within(second).getByLabelText('Remove from Liked Songs'));
		expect(user.unlike).toHaveBeenCalled();
		fireEvent.click(within(second).getByLabelText('More options for Second'));
		expect(p.onTrackMenu).toHaveBeenCalledWith(expect.anything(), p.album.tracks[1]);
		fireEvent.click(second);
		expect(player.playContext).toHaveBeenCalledWith(expect.any(Array), 1, 'album:abc123');
	});

	it('keeps the green gradient until the cover is sampled, then tints by it', async () => {
		const p = props();
		const { rerender } = render(<AlbumDetailView {...p} />);
		expect(screen.getByTestId('album-backdrop')).toHaveClass('from-green-900/30');

		let images = 0;
		vi.stubGlobal(
			'Image',
			class {
				onload?: () => void;
				crossOrigin = '';
				set src(_: string) {
					images++;
					setTimeout(() => this.onload?.());
				}
			}
		);
		const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
			drawImage: vi.fn(),
			getImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4).fill(100) }),
		} as unknown as CanvasRenderingContext2D);
		try {
			p.album = makeAlbum({ coverUrl: 'https://covers.example/tint.jpg' });
			rerender(<AlbumDetailView {...p} />);
			// Rendered at once; the tint follows.
			expect(screen.getByAltText('Test Album')).toBeInTheDocument();
			await act(() => new Promise((resolve) => setTimeout(resolve)));
			const backdrop = screen.getByTestId('album-backdrop');
			expect(backdrop).not.toHaveClass('from-green-900/30');
			expect(backdrop.parentElement!.style.getPropertyValue('--tint')).toBe('rgb(60 60 60)');

			// Sampled once per cover.
			rerender(<AlbumDetailView {...p} album={{ ...p.album, album: 'Again' }} />);
			expect(images).toBe(1);
		} finally {
			getContext.mockRestore();
		}
	});

	it('stacks its header by its own width, so a narrow column next to Now Playing fits', () => {
		const { container } = render(<AlbumDetailView {...props()} />);
		expect(container.firstChild).toHaveClass('@container');
		expect(screen.getByRole('banner')).toHaveClass('flex-col', '@2xl:flex-row');
	});

	it('shows a mini header with Play once the buttons scroll away', () => {
		let report: (entries: { isIntersecting: boolean }[]) => void = () => {};
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(callback: typeof report) {
					report = callback;
				}
				observe() {}
				disconnect() {}
			}
		);
		render(<AlbumDetailView {...props()} />);
		expect(screen.getAllByRole('button', { name: 'Play Test Album' })).toHaveLength(1);
		act(() => report([{ isIntersecting: false }]));
		expect(screen.getAllByRole('button', { name: 'Play Test Album' })).toHaveLength(2);
		act(() => report([{ isIntersecting: true }]));
		expect(screen.getAllByRole('button', { name: 'Play Test Album' })).toHaveLength(1);
	});
});
