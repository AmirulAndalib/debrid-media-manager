import { PlayerState, QueuedTrack } from '../types';
import { shuffleArray } from '../utils';

export type RepeatMode = PlayerState['repeatMode'];

/**
 * Spotify's queue model. "Up next" is the manually queued `priority` items,
 * then the rest of the `context` the user started (an album, a playlist).
 * Positions passed to the functions below index that up-next list; -1 is the
 * item playing now.
 */
export interface QueueState {
	/** What the user started, such as `album:<hash>`. */
	contextId: string | null;
	/** The context in play order, shuffled while shuffle is on. */
	context: QueuedTrack[];
	/** The context item playing, or the last one played while a priority item plays; -1 before any. */
	contextIndex: number;
	/** Track ids of the context in its order before shuffle; empty while unshuffled. */
	originalOrder: string[];
	/** Manually queued items still to play. */
	priority: QueuedTrack[];
	/** The priority item playing now, already taken off `priority`. */
	priorityItem: QueuedTrack | null;
}

export interface NowPlaying {
	item: QueuedTrack;
	source: 'priority' | 'context';
	contextId: string | null;
}

export const emptyQueue: QueueState = {
	contextId: null,
	context: [],
	contextIndex: -1,
	originalOrder: [],
	priority: [],
	priorityItem: null,
};

const without = <T>(items: T[], index: number) => items.filter((_, i) => i !== index);

export function nowPlayingOf(q: QueueState): NowPlaying | null {
	if (q.priorityItem) return { item: q.priorityItem, source: 'priority', contextId: q.contextId };
	const item = q.context[q.contextIndex];
	return item ? { item, source: 'context', contextId: q.contextId } : null;
}

export function upNextOf(q: QueueState): QueuedTrack[] {
	return [...q.priority, ...q.context.slice(q.contextIndex + 1)];
}

/** The state after the current item ends, or null when playback should stop. */
export function advance(q: QueueState, repeat: RepeatMode): QueueState | null {
	if (repeat === 'one' && nowPlayingOf(q)) return q;
	const [first, ...rest] = q.priority;
	if (first) return { ...q, priority: rest, priorityItem: first };
	if (q.contextIndex + 1 < q.context.length) {
		return { ...q, priorityItem: null, contextIndex: q.contextIndex + 1 };
	}
	if (repeat === 'all' && q.context.length) return { ...q, priorityItem: null, contextIndex: 0 };
	return null;
}

/** The state for "previous track", or null when there is nothing before. */
export function retreat(q: QueueState): QueueState | null {
	if (q.priorityItem) {
		// Back out of a queued item: the context track before it plays, and the
		// queued item waits at the head of the queue again.
		return q.context[q.contextIndex]
			? { ...q, priorityItem: null, priority: [q.priorityItem, ...q.priority] }
			: null;
	}
	return q.contextIndex > 0 && q.contextIndex <= q.context.length
		? { ...q, contextIndex: q.contextIndex - 1 }
		: null;
}

export function startContext(
	q: QueueState,
	items: QueuedTrack[],
	startIndex: number,
	contextId: string,
	shuffled: boolean
): QueueState {
	if (!items.length) return q;
	const started: QueueState = {
		...q,
		contextId,
		context: items,
		contextIndex: Math.min(Math.max(startIndex, 0), items.length - 1),
		originalOrder: [],
		priorityItem: null,
	};
	return shuffled ? shuffleContext(started) : started;
}

/** Queues items; with nothing loaded, the first of them becomes the current item. */
export function enqueue(q: QueueState, items: QueuedTrack[], atFront: boolean): QueueState {
	const queued = {
		...q,
		priority: atFront ? [...items, ...q.priority] : [...q.priority, ...items],
	};
	return nowPlayingOf(queued) ? queued : (advance(queued, 'off') ?? queued);
}

export function jumpTo(q: QueueState, position: number): QueueState {
	if (position < 0) return q;
	if (position < q.priority.length) {
		// Like Spotify, the queued items above the chosen one are skipped.
		return {
			...q,
			priorityItem: q.priority[position],
			priority: q.priority.slice(position + 1),
		};
	}
	const contextIndex = q.contextIndex + 1 + position - q.priority.length;
	return contextIndex < q.context.length ? { ...q, priorityItem: null, contextIndex } : q;
}

export function removeAt(q: QueueState, position: number): QueueState {
	if (position < 0) {
		if (!nowPlayingOf(q)) return q;
		const rest = q.priorityItem
			? { ...q, priorityItem: null }
			: {
					...q,
					context: without(q.context, q.contextIndex),
					contextIndex: q.contextIndex - 1,
				};
		// The next item takes over; with none left, nothing is current.
		return advance(rest, 'off') ?? { ...rest, contextIndex: rest.context.length };
	}
	if (position < q.priority.length) return { ...q, priority: without(q.priority, position) };
	return {
		...q,
		context: without(q.context, q.contextIndex + 1 + position - q.priority.length),
	};
}

/**
 * Moves an up-next item. Dropping a context item above the end of the queued
 * items queues it; dropping a queued item below them hands it to the context.
 */
export function moveInQueue(q: QueueState, from: number, to: number): QueueState {
	const list = upNextOf(q);
	if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return q;
	const [item] = list.splice(from, 1);
	list.splice(to, 0, item);
	const queued = q.priority.length;
	const priorityLength =
		queued + (from >= queued && to < queued ? 1 : 0) - (from < queued && to >= queued ? 1 : 0);
	return {
		...q,
		priority: list.slice(0, priorityLength),
		context: [...q.context.slice(0, q.contextIndex + 1), ...list.slice(priorityLength)],
	};
}

/** Shuffles the context, keeping its current item first. */
export function shuffleContext(q: QueueState): QueueState {
	const current = q.context[q.contextIndex];
	const others = without(q.context, q.contextIndex);
	return {
		...q,
		originalOrder: q.context.map((item) => item.track.id),
		context: current ? [current, ...shuffleArray(others)] : shuffleArray(others),
		contextIndex: current ? 0 : -1,
	};
}

/** Puts the context back in its order before shuffle; items added since go last. */
export function unshuffleContext(q: QueueState): QueueState {
	// ponytail: matched by track id, so a track queued into its own album twice keeps one copy.
	const byId = new Map(q.context.map((item) => [item.track.id, item]));
	const original = new Set(q.originalOrder);
	const context = [
		...q.originalOrder.flatMap((id) => byId.get(id) ?? []),
		...q.context.filter((item) => !original.has(item.track.id)),
	];
	const current = q.context[q.contextIndex];
	return {
		...q,
		context,
		contextIndex: current ? context.indexOf(current) : q.contextIndex,
		originalOrder: [],
	};
}

export function withStreamUrl(q: QueueState, item: QueuedTrack, streamUrl: string): QueueState {
	const put = (each: QueuedTrack) => (each === item ? { ...each, streamUrl } : each);
	return {
		...q,
		context: q.context.map(put),
		priority: q.priority.map(put),
		priorityItem: q.priorityItem && put(q.priorityItem),
	};
}
