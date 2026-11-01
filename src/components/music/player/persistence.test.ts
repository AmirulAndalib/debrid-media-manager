import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueuedTrack } from '../types';
import { accountPersistence, localStoragePersistence, PersistedPlayerState } from './persistence';
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

describe('accountPersistence', () => {
	const playing = (id: string): PersistedPlayerState => ({
		queue: {
			...emptyQueue,
			contextId: `album:${id}`,
			context: [{ ...item(id), streamUrl: `https://cdn/${id}` }],
			contextIndex: 0,
		},
		repeatMode: 'off',
		isShuffled: false,
		volume: 0.5,
	});
	const remote = (saved: unknown) => ({
		get: vi.fn(async () => saved),
		put: vi.fn(async (_state: PersistedPlayerState) => undefined),
	});

	beforeEach(() => localStorage.clear());
	afterEach(() => {
		vi.useRealTimers();
		localStorage.clear();
	});

	it("loads this device's queue without asking the server", async () => {
		localStoragePersistence.save(playing('local'));
		const server = remote(playing('server'));
		const persistence = accountPersistence(server);
		await persistence.hydrate();
		expect(server.get).not.toHaveBeenCalled();
		expect(persistence.load()!.queue.contextId).toBe('album:local');
	});

	it("loads the account's queue when this device has none", async () => {
		const server = remote(playing('server'));
		const persistence = accountPersistence(server);
		await persistence.hydrate();
		expect(server.get).toHaveBeenCalledOnce();
		expect(persistence.load()!.queue.contextId).toBe('album:server');
	});

	it('falls back to this device when the server fails or sends junk', async () => {
		const failing = accountPersistence({
			get: vi.fn(async () => Promise.reject(new Error('signed out'))),
			put: vi.fn(),
		});
		await failing.hydrate();
		expect(failing.load()!.queue.context).toEqual([]);

		const junk = accountPersistence(remote({ queue: 'x' }));
		await junk.hydrate();
		expect(junk.load()!.queue.context).toEqual([]);
	});

	it('saves locally at once and to the server 5 s after the last change', async () => {
		vi.useFakeTimers();
		const server = remote(null);
		const persistence = accountPersistence(server);
		persistence.save(playing('a'));
		expect(localStoragePersistence.load()!.queue.contextId).toBe('album:a');
		await vi.advanceTimersByTimeAsync(4000);
		persistence.save(playing('b'));
		await vi.advanceTimersByTimeAsync(4999);
		expect(server.put).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(server.put).toHaveBeenCalledOnce();
		const sent = server.put.mock.calls[0][0];
		expect(sent.queue.contextId).toBe('album:b');
		expect(JSON.stringify(sent)).not.toContain('https://cdn/');

		// The same state again is not sent again.
		persistence.save(playing('b'));
		await vi.advanceTimersByTimeAsync(5000);
		expect(server.put).toHaveBeenCalledOnce();
	});

	it('sends a state again after the server refused it', async () => {
		vi.useFakeTimers();
		const server = remote(null);
		server.put.mockRejectedValueOnce(new Error('413'));
		const persistence = accountPersistence(server);
		persistence.save(playing('a'));
		await vi.advanceTimersByTimeAsync(5000);
		persistence.save(playing('a'));
		await vi.advanceTimersByTimeAsync(5000);
		expect(server.put).toHaveBeenCalledTimes(2);
	});
});
