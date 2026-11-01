import { QueuedTrack } from '../types';
import { emptyQueue, QueueState, RepeatMode } from './queue';

// Saved queues older than this lose their tracks on load: before 2 a track's
// title could be its filename, which the player must never show.
export const PLAYER_STATE_VERSION = 2;

export interface PersistedPlayerState {
	/** Set on every save; a state without the current one keeps its settings, not its queue. */
	version?: number;
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
const SERVER_SAVE_DELAY_MS = 5000;
// A first visit on a new device waits this long at most for the account's queue.
const SERVER_LOAD_TIMEOUT_MS = 3000;
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

/** What both copies store: the current version, the queue without stream URLs or track lists. */
const stored = (state: PersistedPlayerState): PersistedPlayerState => ({
	...state,
	version: PLAYER_STATE_VERSION,
	queue: {
		...state.queue,
		context: state.queue.context.map(strip),
		priority: state.queue.priority.map(strip),
		priorityItem: state.queue.priorityItem && strip(state.queue.priorityItem),
	},
});

function parseState(saved: unknown): PersistedPlayerState | null {
	const state = saved as PersistedPlayerState | null;
	if (!Array.isArray(state?.queue?.context) || !Array.isArray(state.queue.priority)) return null;
	const queue = state.version === PLAYER_STATE_VERSION ? state.queue : {};
	return { ...state, queue: { ...emptyQueue, ...queue } };
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
			const saved = readJson(STORAGE_KEY);
			return saved ? parseState(saved) : loadLegacyState();
		} catch {
			return null;
		}
	},
	save(state) {
		const json = JSON.stringify(stored(state));
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

/** The account's copy of the player, which /api/music/me/state keeps. */
export interface RemotePlayerState {
	get(): Promise<unknown>;
	put(state: PersistedPlayerState): Promise<unknown>;
}

const hasQueue = (state: PersistedPlayerState | null) =>
	!!state &&
	(state.queue.context.length > 0 ||
		state.queue.priority.length > 0 ||
		state.queue.priorityItem !== null);

/**
 * This device's saved player, else the account's. `load()` is synchronous, so
 * call `hydrate()` before the player mounts: it fetches the account's copy when
 * this device has no queue. Saves land here at once and on the server 5 s after
 * the last change.
 */
export function accountPersistence(
	remote: RemotePlayerState,
	local: PlayerPersistence = localStoragePersistence
): PlayerPersistence & { hydrate(): Promise<void> } {
	let fromServer: PersistedPlayerState | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastSent = '';
	return {
		async hydrate() {
			if (hasQueue(local.load())) return;
			try {
				fromServer = parseState(
					await Promise.race([
						remote.get(),
						new Promise((resolve) => setTimeout(resolve, SERVER_LOAD_TIMEOUT_MS, null)),
					])
				);
			} catch {
				// Signed out or offline: this device's state is all there is.
			}
		},
		load() {
			const saved = local.load();
			return hasQueue(saved) || !fromServer ? saved : fromServer;
		},
		save(state) {
			local.save(state);
			const stripped = stored(state);
			const json = JSON.stringify(stripped);
			clearTimeout(timer);
			timer = setTimeout(() => {
				if (json === lastSent) return;
				// ponytail: a queue over the route's 200 KB answers 413 and stays on this device only.
				remote.put(stripped).then(
					() => (lastSent = json),
					() => {}
				);
			}, SERVER_SAVE_DELAY_MS);
		},
	};
}
