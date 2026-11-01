import { describe, expect, it } from 'vitest';
import { QueuedTrack } from '../types';
import {
	advance,
	emptyQueue,
	enqueue,
	jumpTo,
	moveInQueue,
	nowPlayingOf,
	QueueState,
	removeAt,
	retreat,
	shuffleContext,
	startContext,
	unshuffleContext,
	upNextOf,
	withStreamUrl,
} from './queue';

const album = {
	hash: 'h',
	mbid: 'm',
	artist: 'Artist',
	album: 'Album',
	year: null,
	coverUrl: null,
	tracks: [],
	totalBytes: 0,
	trackCount: 0,
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

const ids = (items: QueuedTrack[]) => items.map((i) => i.track.id);
const playing = (q: QueueState | null) => (q ? nowPlayingOf(q)?.item.track.id : undefined);
const album5 = () => ['a', 'b', 'c', 'd', 'e'].map(item);
const started = (start = 0) => startContext(emptyQueue, album5(), start, 'album:h', false);

describe('music queue', () => {
	it('starts a context at the chosen item', () => {
		const q = started(2);
		expect(nowPlayingOf(q)).toMatchObject({ source: 'context', contextId: 'album:h' });
		expect(playing(q)).toBe('c');
		expect(ids(upNextOf(q))).toEqual(['d', 'e']);
	});

	it('plays queued items before the rest of the context, then resumes the context', () => {
		let q: QueueState | null = enqueue(started(0), [item('x'), item('y')], false);
		q = enqueue(q, [item('n')], true);
		expect(ids(upNextOf(q))).toEqual(['n', 'x', 'y', 'b', 'c', 'd', 'e']);

		const order = [];
		while ((q = advance(q!, 'off'))) order.push(`${playing(q)}:${nowPlayingOf(q)!.source}`);
		expect(order).toEqual([
			'n:priority',
			'x:priority',
			'y:priority',
			'b:context',
			'c:context',
			'd:context',
			'e:context',
		]);
	});

	it('keeps queued items when a new context starts', () => {
		const q = startContext(
			enqueue(started(), [item('x')], false),
			album5(),
			3,
			'album:h2',
			false
		);
		expect(playing(q)).toBe('d');
		expect(ids(upNextOf(q))).toEqual(['x', 'e']);
	});

	it('stops at the end with repeat off and wraps with repeat all', () => {
		const last = started(4);
		expect(advance(last, 'off')).toBeNull();
		expect(playing(advance(last, 'all'))).toBe('a');
	});

	it('repeats the current item with repeat one, even when items are queued', () => {
		const q = enqueue(started(1), [item('x')], false);
		expect(advance(q, 'one')).toBe(q);
		expect(playing(advance(q, 'one'))).toBe('b');
	});

	it('goes back from a queued item to the context and re-queues it', () => {
		const q = advance(enqueue(started(1), [item('x')], false), 'off')!;
		expect(playing(q)).toBe('x');
		const back = retreat(q)!;
		expect(playing(back)).toBe('b');
		expect(ids(upNextOf(back))).toEqual(['x', 'c', 'd', 'e']);
		expect(retreat(started(0))).toBeNull();
	});

	it('loads the first queued item when nothing is current', () => {
		const q = enqueue(emptyQueue, [item('x'), item('y')], false);
		expect(nowPlayingOf(q)).toMatchObject({ source: 'priority' });
		expect(playing(q)).toBe('x');
		expect(ids(upNextOf(q))).toEqual(['y']);
	});

	it('jumps to a queued item, skipping the queued items above it', () => {
		const q = enqueue(started(0), [item('x'), item('y')], false);
		const jumped = jumpTo(q, 1);
		expect(playing(jumped)).toBe('y');
		expect(ids(upNextOf(jumped))).toEqual(['b', 'c', 'd', 'e']);
	});

	it('jumps into the context and keeps the queued items', () => {
		const q = enqueue(started(0), [item('x')], false);
		const jumped = jumpTo(q, 3); // x, b, c, [d]
		expect(playing(jumped)).toBe('d');
		expect(ids(upNextOf(jumped))).toEqual(['x', 'e']);
	});

	it('removes up-next items from either section', () => {
		const q = enqueue(started(0), [item('x'), item('y')], false);
		expect(ids(upNextOf(removeAt(q, 0)))).toEqual(['y', 'b', 'c', 'd', 'e']);
		expect(ids(upNextOf(removeAt(q, 3)))).toEqual(['x', 'y', 'b', 'd', 'e']);
		expect(playing(removeAt(q, 3))).toBe('a');
	});

	it('removing the current context item plays what comes next', () => {
		const q = removeAt(started(1), -1);
		expect(playing(q)).toBe('c');
		expect(ids(q.context)).toEqual(['a', 'c', 'd', 'e']);
		expect(ids(upNextOf(q))).toEqual(['d', 'e']);
	});

	it('removing the current queued item resumes the context after it', () => {
		const q = advance(enqueue(started(1), [item('x')], false), 'off')!;
		const removed = removeAt(q, -1);
		expect(playing(removed)).toBe('c');
		expect(ids(removed.context)).toEqual(['a', 'b', 'c', 'd', 'e']);
	});

	it('removing the only remaining item leaves nothing current', () => {
		const q = removeAt(started(4), -1);
		expect(nowPlayingOf(q)).toBeNull();
		expect(upNextOf(q)).toEqual([]);
		expect(removeAt(q, -1)).toBe(q);
	});

	it('moves items within and across the queued and context sections', () => {
		const q = enqueue(started(0), [item('x'), item('y')], false);
		// x, y | b, c, d, e
		const within = moveInQueue(q, 5, 2);
		expect(ids(within.priority)).toEqual(['x', 'y']);
		expect(ids(upNextOf(within))).toEqual(['x', 'y', 'e', 'b', 'c', 'd']);
		expect(ids(within.context)).toEqual(['a', 'e', 'b', 'c', 'd']);

		const intoQueue = moveInQueue(q, 4, 0);
		expect(ids(intoQueue.priority)).toEqual(['d', 'x', 'y']);
		expect(ids(intoQueue.context)).toEqual(['a', 'b', 'c', 'e']);

		const outOfQueue = moveInQueue(q, 0, 3);
		expect(ids(outOfQueue.priority)).toEqual(['y']);
		expect(ids(upNextOf(outOfQueue))).toEqual(['y', 'b', 'c', 'x', 'd', 'e']);
		expect(playing(outOfQueue)).toBe('a');

		expect(moveInQueue(q, 0, 9)).toBe(q);
	});

	it('shuffles with the current item first and restores the original order', () => {
		const q = started(2);
		const shuffled = shuffleContext(q);
		expect(playing(shuffled)).toBe('c');
		expect(shuffled.contextIndex).toBe(0);
		expect(ids(shuffled.context).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);

		const playedOn = advance(shuffled, 'off')!;
		const restored = unshuffleContext(playedOn);
		expect(ids(restored.context)).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(playing(restored)).toBe(playing(playedOn));
		expect(restored.originalOrder).toEqual([]);
	});

	it('starts a shuffled context on the chosen item', () => {
		const q = startContext(emptyQueue, album5(), 3, 'album:h', true);
		expect(playing(q)).toBe('d');
		expect(q.originalOrder).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(ids(unshuffleContext(q).context)).toEqual(['a', 'b', 'c', 'd', 'e']);
	});

	it('unshuffle drops removed items and keeps items added since', () => {
		const shuffled = shuffleContext(started(0));
		const edited = moveInQueue(removeAt(enqueue(shuffled, [item('x')], false), 1), 0, 3);
		const restored = unshuffleContext(edited);
		expect(ids(restored.context)).toHaveLength(5);
		expect(ids(restored.context)).toContain('x');
		expect(ids(restored.context).slice(-1)).toEqual(['x']);
	});

	it('caches a stream URL on the one item it belongs to', () => {
		const q = enqueue(started(0), [item('x')], false);
		const next = q.priority[0];
		const cached = withStreamUrl(q, next, 'https://cdn/x');
		expect(cached.priority[0].streamUrl).toBe('https://cdn/x');
		expect(cached.context.every((i) => !i.streamUrl)).toBe(true);
	});
});
