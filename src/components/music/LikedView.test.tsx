import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LikedView from './LikedView';
import type { MusicPlayer } from './player/MusicPlayerProvider';
import type { MusicUser } from './user/MusicUserProvider';

let player: MusicPlayer;
let user: MusicUser;
vi.mock('./player/MusicPlayerProvider', () => ({ useMusicPlayer: () => player }));
vi.mock('./user/MusicUserProvider', () => ({ useMusicUser: () => user }));

const HASH = 'a'.repeat(40);
const albumSummary = {
	hash: HASH,
	mbid: 'mb1',
	artist: 'Test Artist',
	album: 'First Album',
	year: 2020,
	coverUrl: null,
	trackCount: 3,
};
const row = (fileId: number, available = true) => ({
	hash: HASH,
	fileId,
	mbid: 'mb1',
	likedAt: '',
	album: albumSummary,
	track: available
		? {
				id: `${HASH}-${fileId}`,
				hash: HASH,
				fileId,
				link: `https://real-debrid.com/d/${fileId}`,
				path: `/0${fileId} - Song ${fileId}.flac`,
				bytes: 1,
				trackNumber: fileId,
				filename: `0${fileId} - Song ${fileId}.flac`,
			}
		: null,
});

const page = (items: ReturnType<typeof row>[], hasMore: boolean) => ({
	ok: true,
	json: async () => ({ items, total: 4, hasMore }),
});

let observe: (() => void) | null = null;

describe('LikedView', () => {
	beforeEach(() => {
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
			likedIds: new Set([1, 2, 3, 4].map((i) => `${HASH}-${i}`)),
			isLiked: (id: string) => id !== `${HASH}-4`,
			like: vi.fn(),
			unlike: vi.fn(),
			musicFetch: vi.fn(async (path: string) =>
				path.includes('page=1')
					? page([row(1), row(2, false), row(3)], true)
					: page([row(4)], false)
			),
		} as unknown as MusicUser;
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(private callback: IntersectionObserverCallback) {}
				observe() {
					observe = () =>
						this.callback(
							[{ isIntersecting: true } as IntersectionObserverEntry],
							this as unknown as IntersectionObserver
						);
				}
				disconnect() {}
			}
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		observe = null;
	});

	const renderLiked = () => render(<LikedView onTrackMenu={vi.fn()} onDownload={vi.fn()} />);

	it('lists liked songs with the gone ones greyed out', async () => {
		renderLiked();
		expect(await screen.findByText('Song 1')).toBeInTheDocument();
		expect(screen.getByText('4 songs')).toBeInTheDocument();
		expect(screen.getByText('No longer available')).toBeInTheDocument();
		expect(screen.getAllByRole('button', { name: /^Play Song/ })).toHaveLength(2);
	});

	it('plays a row within Liked Songs, skipping the unavailable ones', async () => {
		renderLiked();
		fireEvent.click(await screen.findByRole('button', { name: 'Play Song 3 by Test Artist' }));
		const [items, start, contextId] = vi.mocked(player.playContext).mock.calls[0];
		expect(items.map((i) => i.track.fileId)).toEqual([1, 3]);
		expect(start).toBe(1);
		expect(contextId).toBe('liked');
		// The rows carry their album as a catalog album, keyed by the track's release.
		expect(items[0].album).toMatchObject({ hash: HASH, mbid: 'mb1', tracks: [] });
	});

	it('plays from the top, or shuffled', async () => {
		renderLiked();
		await screen.findByText('Song 1');
		fireEvent.click(screen.getByRole('button', { name: 'Play Liked Songs' }));
		expect(player.playContext).toHaveBeenLastCalledWith(expect.any(Array), 0, 'liked');
		fireEvent.click(screen.getByRole('button', { name: 'Shuffle Liked Songs' }));
		expect(player.playContext).toHaveBeenCalledTimes(2);
		expect(player.toggleShuffle).toHaveBeenCalledOnce();
	});

	it('unlikes a song from its heart', async () => {
		renderLiked();
		await screen.findByText('Song 1');
		fireEvent.click(screen.getAllByTitle('Remove from Liked Songs')[0]);
		expect(user.unlike).toHaveBeenCalledWith({ hash: HASH, fileId: 1, mbid: 'mb1' });
	});

	it('loads the next page as the list end scrolls near', async () => {
		renderLiked();
		await screen.findByText('Song 1');
		await waitFor(() => expect(observe).not.toBeNull());
		observe!();
		expect(await screen.findByText('Song 4')).toBeInTheDocument();
		expect(user.musicFetch).toHaveBeenLastCalledWith('/api/music/me/likes?page=2&limit=50');
	});
});
