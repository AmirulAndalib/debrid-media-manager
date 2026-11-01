import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueuedTrack } from '../types';
import { localStoragePersistence } from './persistence';
import { emptyQueue, nowPlayingOf } from './queue';

const album = {
	hash: 'h',
	mbid: 'm',
	artist: 'Artist',
	album: 'Album',
	year: 2020,
	coverUrl: null,
	tracks: [],
	totalBytes: 0,
	trackCount: 2,
};

const item = (id: string): QueuedTrack => ({
	track: {
		id,
		hash: 'h',
		fileId: 1,
		link: `https://example.com/${id}`,
		path: `/${id}.flac`,
		bytes: 1,
		trackNumber: null,
		filename: `${id}.flac`,
	},
	album,
});

describe('localStoragePersistence', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => {
		setItem?.mockRestore();
		localStorage.clear();
	});
	let setItem: ReturnType<typeof vi.spyOn> | undefined;

	it('migrates the queue the page saved before the player provider', () => {
		// The shape the old page wrote: one flat queue, separate keys, volume via useLocalStorage.
		localStorage.setItem('music:queue', JSON.stringify([item('c'), item('a'), item('b')]));
		localStorage.setItem(
			'music:originalQueue',
			JSON.stringify([item('a'), item('b'), item('c')])
		);
		localStorage.setItem('music:currentIndex', '1');
		localStorage.setItem('music:repeatMode', 'all');
		localStorage.setItem('music:isShuffled', 'true');
		localStorage.setItem('music:volume', '0.4');

		const state = localStoragePersistence.load()!;
		expect(state.queue.context.map((i) => i.track.id)).toEqual(['c', 'a', 'b']);
		expect(nowPlayingOf(state.queue)?.item.track.id).toBe('a');
		expect(state.queue.originalOrder).toEqual(['a', 'b', 'c']);
		expect(state.queue.priority).toEqual([]);
		expect(state).toMatchObject({ repeatMode: 'all', isShuffled: true, volume: 0.4 });
	});

	it('migrates an unshuffled queue and ignores invalid old values', () => {
		localStorage.setItem('music:queue', JSON.stringify([item('a')]));
		localStorage.setItem('music:originalQueue', JSON.stringify([item('a')]));
		localStorage.setItem('music:currentIndex', '7');
		localStorage.setItem('music:repeatMode', 'invalid');

		const state = localStoragePersistence.load()!;
		expect(state.queue.contextIndex).toBe(-1);
		expect(state.queue.originalOrder).toEqual([]);
		expect(state).toMatchObject({ repeatMode: 'off', isShuffled: false, volume: 1 });
	});

	it('round-trips without stream URLs or album track lists', () => {
		const playing = { ...item('a'), streamUrl: 'https://cdn/a' };
		const albumWithTracks = { ...album, tracks: [playing.track] };
		localStoragePersistence.save({
			queue: {
				...emptyQueue,
				contextId: 'album:h',
				context: [{ ...playing, album: albumWithTracks }],
				contextIndex: 0,
				priority: [{ ...item('x'), streamUrl: 'https://cdn/x' }],
			},
			repeatMode: 'one',
			isShuffled: false,
			volume: 0.7,
		});

		const raw = localStorage.getItem('music:player')!;
		expect(raw).not.toContain('https://cdn/');
		const state = localStoragePersistence.load()!;
		expect(state.queue.context[0].album.tracks).toEqual([]);
		expect(state.queue.contextId).toBe('album:h');
		expect(state.queue.priority[0].track.id).toBe('x');
		expect(state).toMatchObject({ repeatMode: 'one', volume: 0.7 });
	});

	it('prefers the new key over stale old keys', () => {
		localStorage.setItem('music:queue', JSON.stringify([item('old')]));
		localStoragePersistence.save({
			queue: emptyQueue,
			repeatMode: 'off',
			isShuffled: false,
			volume: 1,
		});
		expect(localStoragePersistence.load()!.queue.context).toEqual([]);
	});

	it('returns nothing for a corrupt saved state', () => {
		localStorage.setItem('music:player', '{not json');
		expect(localStoragePersistence.load()).toBeNull();
		localStorage.setItem('music:player', JSON.stringify({ queue: { context: 'x' } }));
		expect(localStoragePersistence.load()).toBeNull();
	});

	it('frees the old keys and retries once when over quota', () => {
		localStorage.setItem('music:queue', JSON.stringify([item('old')]));
		setItem = vi.spyOn(Storage.prototype, 'setItem');
		setItem.mockImplementationOnce(() => {
			throw new DOMException('full', 'QuotaExceededError');
		});
		localStoragePersistence.save({
			queue: emptyQueue,
			repeatMode: 'off',
			isShuffled: false,
			volume: 1,
		});
		expect(localStorage.getItem('music:queue')).toBeNull();
		expect(localStorage.getItem('music:player')).not.toBeNull();
	});

	it('drops the saved queue rather than throw when storage stays full', () => {
		localStorage.setItem('music:player', JSON.stringify({ queue: emptyQueue }));
		setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('full', 'QuotaExceededError');
		});
		expect(() =>
			localStoragePersistence.save({
				queue: emptyQueue,
				repeatMode: 'off',
				isShuffled: false,
				volume: 1,
			})
		).not.toThrow();
		expect(localStorage.getItem('music:player')).toBeNull();
	});
});
