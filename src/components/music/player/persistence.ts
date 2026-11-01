import { QueuedTrack } from '../types';
import { emptyQueue, QueueState, RepeatMode } from './queue';

export interface PersistedPlayerState {
	queue: QueueState;
	repeatMode: RepeatMode;
	isShuffled: boolean;
	volume: number;
}

export interface PlayerPersistence {
	load(): PersistedPlayerState | null;
	save(state: PersistedPlayerState): void;
}

const STORAGE_KEY = 'music:player';
// Where the page kept one flat queue before the player provider existed.
const LEGACY_KEYS = [
	'music:queue',
	'music:originalQueue',
	'music:currentIndex',
	'music:repeatMode',
	'music:isShuffled',
	'music:volume',
];

// Stream URLs expire and album track lists are refetched, so neither earns its quota.
const strip = ({ streamUrl, ...item }: QueuedTrack): QueuedTrack => ({
	...item,
	album: { ...item.album, tracks: [] },
});

function stripQueue(queue: QueueState): QueueState {
	return {
		...queue,
		context: queue.context.map(strip),
		priority: queue.priority.map(strip),
		priorityItem: queue.priorityItem && strip(queue.priorityItem),
	};
}

const readJson = (key: string): unknown => {
	const raw = window.localStorage.getItem(key);
	return raw === null ? null : JSON.parse(raw);
};

function loadLegacyState(): PersistedPlayerState {
	const saved = readJson('music:queue');
	const original = readJson('music:originalQueue');
	const index = readJson('music:currentIndex');
	const volume = readJson('music:volume');
	const repeatMode = window.localStorage.getItem('music:repeatMode');
	const isShuffled = window.localStorage.getItem('music:isShuffled') === 'true';
	const context = Array.isArray(saved) ? (saved as QueuedTrack[]) : [];
	return {
		queue: {
			...emptyQueue,
			context,
			contextIndex: typeof index === 'number' && index < context.length ? index : -1,
			originalOrder:
				isShuffled && Array.isArray(original)
					? (original as QueuedTrack[]).map((item) => item.track.id)
					: [],
		},
		repeatMode: repeatMode === 'all' || repeatMode === 'one' ? repeatMode : 'off',
		isShuffled,
		volume: typeof volume === 'number' ? volume : 1,
	};
}

export const localStoragePersistence: PlayerPersistence = {
	load() {
		if (typeof window === 'undefined') return null;
		try {
			const saved = readJson(STORAGE_KEY) as PersistedPlayerState | null;
			if (!saved) return loadLegacyState();
			if (!Array.isArray(saved.queue?.context) || !Array.isArray(saved.queue.priority)) {
				return null;
			}
			return { ...saved, queue: { ...emptyQueue, ...saved.queue } };
		} catch {
			return null;
		}
	},
	save(state) {
		const json = JSON.stringify({ ...state, queue: stripQueue(state.queue) });
		try {
			window.localStorage.setItem(STORAGE_KEY, json);
		} catch {
			try {
				// Over quota: drop the old keys this one replaced, then try once more.
				LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
				window.localStorage.setItem(STORAGE_KEY, json);
			} catch {
				// Still too big, or storage is blocked: keep no queue rather than a stale one.
				try {
					window.localStorage.removeItem(STORAGE_KEY);
				} catch {}
			}
		}
	},
};
