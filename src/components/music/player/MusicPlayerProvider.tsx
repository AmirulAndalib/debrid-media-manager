import {
	createContext,
	ReactNode,
	SyntheticEvent,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import toast from 'react-hot-toast';
import { PlayerState, QueuedTrack } from '../types';
import { trackTitle } from '../utils';
import { PlayerPersistence } from './persistence';
import {
	advance,
	emptyQueue,
	enqueue,
	jumpTo,
	moveInQueue,
	NowPlaying,
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

const MAX_FAILED_IN_A_ROW = 5;
const PLAYED_AFTER_SECONDS = 30;
const SEEK_STEP_SECONDS = 10;
const VOLUME_STEP = 0.05;

export interface MusicPlayer extends PlayerState {
	nowPlaying: NowPlaying | null;
	/** Queued items, then the rest of the context. Positions below index this list; -1 is now playing. */
	upNext: QueuedTrack[];
	/** How many of `upNext` were queued by hand. */
	priorityCount: number;
	playContext: (items: QueuedTrack[], startIndex: number, contextId: string) => void;
	playNext: (items: QueuedTrack[]) => void;
	addToQueue: (items: QueuedTrack[]) => void;
	playAt: (position: number) => void;
	removeAt: (position: number) => void;
	clearQueue: () => void;
	togglePlay: () => void;
	next: () => void;
	prev: () => void;
	seek: (seconds: number) => void;
	setVolume: (volume: number) => void;
	toggleMute: () => void;
	toggleShuffle: () => void;
	cycleRepeat: () => void;
	moveInQueue: (from: number, to: number) => void;
	/** Ref callback for the search box that Ctrl/Cmd+K focuses. */
	registerSearchInput: (input: HTMLInputElement | null) => void;
}

interface MusicPlayerProviderProps {
	children: ReactNode;
	resolveStreamUrl: (track: QueuedTrack['track']) => Promise<string | undefined>;
	persistence?: PlayerPersistence;
	/** Fires once per play, after 30 s or half the track has been heard. */
	onTrackPlayed?: (item: QueuedTrack) => void;
}

const MusicPlayerContext = createContext<MusicPlayer | null>(null);

export function useMusicPlayer(): MusicPlayer {
	const player = useContext(MusicPlayerContext);
	if (!player) throw new Error('useMusicPlayer must be used inside a MusicPlayerProvider');
	return player;
}

export function MusicPlayerProvider({
	children,
	resolveStreamUrl,
	persistence,
	onTrackPlayed,
}: MusicPlayerProviderProps) {
	const [saved] = useState(() => persistence?.load() ?? null);
	const [queue, setQueue] = useState<QueueState>(saved?.queue ?? emptyQueue);
	// Async playback steps read the latest queue, not the one their render saw.
	const queueRef = useRef(queue);
	const [state, setState] = useState<PlayerState>({
		isPlaying: false,
		currentTime: 0,
		duration: 0,
		volume: saved?.volume ?? 1,
		isMuted: false,
		isLoading: false,
		repeatMode: saved?.repeatMode ?? 'off',
		isShuffled: saved?.isShuffled ?? false,
	});
	const audioRef = useRef<HTMLAudioElement>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const playToken = useRef(0);
	const pending = useRef(new WeakMap<QueuedTrack, Promise<string | undefined>>());
	const prefetched = useRef(new WeakSet<QueuedTrack>());
	const heard = useRef({ seconds: 0, at: 0, reported: false });

	const commit = (next: QueueState) => {
		queueRef.current = next;
		setQueue(next);
	};

	// One unrestrict per item, shared by the prefetch and the play that follows it.
	const resolveItem = (item: QueuedTrack) => {
		let url = pending.current.get(item);
		if (!url) {
			url = resolveStreamUrl(item.track).catch(() => undefined);
			pending.current.set(item, url);
		}
		return url;
	};

	const stop = () => {
		playToken.current++;
		const audio = audioRef.current;
		if (audio) {
			audio.pause();
			audio.src = '';
		}
		setState((prev) => ({ ...prev, isPlaying: false, isLoading: false, currentTime: 0 }));
	};

	const startPlayback = async (next: QueueState, failures = 0): Promise<void> => {
		const token = ++playToken.current;
		commit(next);
		const now = nowPlayingOf(next);
		const audio = audioRef.current;
		if (!now || !audio) return;
		heard.current = { seconds: 0, at: 0, reported: false };
		setState((prev) => ({ ...prev, isLoading: true }));

		const url = now.item.streamUrl ?? (await resolveItem(now.item));
		if (token !== playToken.current) return; // a later play took over while this one resolved
		if (!url) {
			pending.current.delete(now.item); // a later play of this item tries again
			console.error(`Failed to load track: ${now.item.track.filename}, skipping...`);
			const skipTo =
				failures + 1 < MAX_FAILED_IN_A_ROW
					? advance(queueRef.current, state.repeatMode === 'all' ? 'all' : 'off')
					: null;
			if (skipTo) return startPlayback(skipTo, failures + 1);
			setState((prev) => ({ ...prev, isLoading: false, isPlaying: false }));
			toast.error("Couldn't play this right now. Try again in a while.");
			return;
		}
		if (!now.item.streamUrl) commit(withStreamUrl(queueRef.current, now.item, url));
		audio.src = url;
		audio.play().catch(console.error);
	};

	// A manual skip leaves repeat-one's track behind, as the old player did.
	const skipRepeat = state.repeatMode === 'one' ? 'off' : state.repeatMode;

	const seek = (seconds: number) => {
		const audio = audioRef.current;
		if (audio) audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
	};

	const registerSearchInput = useCallback((input: HTMLInputElement | null) => {
		searchInputRef.current = input;
	}, []);

	const nowPlaying = nowPlayingOf(queue);
	const player: MusicPlayer = {
		...state,
		nowPlaying,
		upNext: upNextOf(queue),
		priorityCount: queue.priority.length,
		playContext: (items, startIndex, contextId) => {
			if (!items.length) return;
			void startPlayback(
				startContext(queueRef.current, items, startIndex, contextId, state.isShuffled)
			);
		},
		playNext: (items) => commit(enqueue(queueRef.current, items, true)),
		addToQueue: (items) => commit(enqueue(queueRef.current, items, false)),
		playAt: (position) => void startPlayback(jumpTo(queueRef.current, position)),
		removeAt: (position) => {
			const next = removeAt(queueRef.current, position);
			if (position >= 0) return commit(next);
			if (nowPlayingOf(next)) return void startPlayback(next);
			commit(next);
			stop();
		},
		clearQueue: () => {
			commit(emptyQueue);
			stop();
		},
		togglePlay: () => {
			const audio = audioRef.current;
			if (!audio) return;
			if (state.isPlaying) audio.pause();
			// Nothing loaded yet, as after a reload: resolve the current item first.
			else if (!audio.getAttribute('src')) void startPlayback(queueRef.current);
			else audio.play().catch(console.error);
		},
		next: () => {
			const next = advance(queueRef.current, skipRepeat);
			if (next) void startPlayback(next);
		},
		prev: () => {
			const back =
				(audioRef.current?.currentTime ?? 0) > 3 ? null : retreat(queueRef.current);
			if (back) void startPlayback(back);
			else seek(0);
		},
		seek,
		setVolume: (volume) =>
			setState((prev) => ({
				...prev,
				volume: Math.max(0, Math.min(1, volume)),
				isMuted: false,
			})),
		toggleMute: () => setState((prev) => ({ ...prev, isMuted: !prev.isMuted })),
		toggleShuffle: () => {
			commit((state.isShuffled ? unshuffleContext : shuffleContext)(queueRef.current));
			setState((prev) => ({ ...prev, isShuffled: !prev.isShuffled }));
		},
		cycleRepeat: () =>
			setState((prev) => ({
				...prev,
				repeatMode:
					prev.repeatMode === 'off' ? 'all' : prev.repeatMode === 'all' ? 'one' : 'off',
			})),
		moveInQueue: (from, to) => commit(moveInQueue(queueRef.current, from, to)),
		registerSearchInput,
	};
	// Window listeners are bound once and call through this to the latest actions.
	const playerRef = useRef(player);
	playerRef.current = player;

	useEffect(() => {
		persistence?.save({
			queue,
			repeatMode: state.repeatMode,
			isShuffled: state.isShuffled,
			volume: state.volume,
		});
	}, [persistence, queue, state.repeatMode, state.isShuffled, state.volume]);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;
		audio.volume = state.volume;
		audio.muted = state.isMuted;
	}, [state.volume, state.isMuted]);

	// Resolve the next item while this one plays, so skipping does not wait on unrestrict.
	const upcoming = useMemo(() => {
		const next = advance(queue, state.repeatMode === 'one' ? 'off' : state.repeatMode);
		return next ? (nowPlayingOf(next)?.item ?? null) : null;
	}, [queue, state.repeatMode]);
	useEffect(() => {
		if (!state.isPlaying || !upcoming || upcoming.streamUrl) return;
		if (prefetched.current.has(upcoming)) return;
		prefetched.current.add(upcoming);
		void resolveItem(upcoming).then((url) => {
			if (url) commit(withStreamUrl(queueRef.current, upcoming, url));
			else pending.current.delete(upcoming);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.isPlaying, upcoming]);

	const nowItem = nowPlaying?.item;
	useEffect(() => {
		if (!('mediaSession' in navigator) || !nowItem) return;
		navigator.mediaSession.metadata = new MediaMetadata({
			title: trackTitle(nowItem.track),
			artist: nowItem.album.artist,
			album: nowItem.album.album,
			...(nowItem.album.coverUrl
				? {
						artwork: [
							{ src: nowItem.album.coverUrl, sizes: '600x600', type: 'image/jpeg' },
						],
					}
				: {}),
		});
	}, [nowItem]);

	useEffect(() => {
		if (!('mediaSession' in navigator)) return;
		const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
			['play', () => playerRef.current.togglePlay()],
			['pause', () => playerRef.current.togglePlay()],
			['previoustrack', () => playerRef.current.prev()],
			['nexttrack', () => playerRef.current.next()],
			[
				'seekto',
				(details) => details.seekTime != null && playerRef.current.seek(details.seekTime),
			],
		];
		handlers.forEach(([action, handler]) =>
			navigator.mediaSession.setActionHandler(action, handler)
		);
		return () =>
			handlers.forEach(([action]) => navigator.mediaSession.setActionHandler(action, null));
	}, []);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const p = playerRef.current;
			const audio = audioRef.current;
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && searchInputRef.current) {
				e.preventDefault();
				searchInputRef.current.focus();
				searchInputRef.current.select();
				return;
			}
			const tag = (e.target as HTMLElement).tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			switch (e.key) {
				case ' ':
					e.preventDefault();
					p.togglePlay();
					break;
				case 'ArrowRight':
					e.preventDefault();
					p.next();
					break;
				case 'ArrowLeft':
					e.preventDefault();
					p.prev();
					break;
				case 'ArrowUp':
					e.preventDefault();
					p.setVolume(p.volume + VOLUME_STEP);
					break;
				case 'ArrowDown':
					e.preventDefault();
					p.setVolume(p.volume - VOLUME_STEP);
					break;
				case 'j':
				case 'J':
					if (audio) p.seek(audio.currentTime - SEEK_STEP_SECONDS);
					break;
				case 'l':
				case 'L':
					if (audio) p.seek(audio.currentTime + SEEK_STEP_SECONDS);
					break;
				case 'm':
				case 'M':
					p.toggleMute();
					break;
				case 's':
				case 'S':
					p.toggleShuffle();
					break;
				case 'r':
				case 'R':
					p.cycleRepeat();
					break;
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, []);

	const handleTimeUpdate = (e: SyntheticEvent<HTMLAudioElement>) => {
		const audio = e.currentTarget;
		setState((prev) => ({ ...prev, currentTime: audio.currentTime }));
		if ('mediaSession' in navigator && audio.duration && isFinite(audio.duration)) {
			navigator.mediaSession.setPositionState({
				duration: audio.duration,
				playbackRate: audio.playbackRate,
				position: audio.currentTime,
			});
		}
		// Count time actually heard, so a seek to the end is not a play.
		const step = audio.currentTime - heard.current.at;
		heard.current.at = audio.currentTime;
		if (step > 0 && step < 3) heard.current.seconds += step;
		const threshold =
			audio.duration > 0 && isFinite(audio.duration)
				? Math.min(PLAYED_AFTER_SECONDS, audio.duration / 2)
				: PLAYED_AFTER_SECONDS;
		if (nowPlaying && !heard.current.reported && heard.current.seconds >= threshold) {
			heard.current.reported = true;
			onTrackPlayed?.(nowPlaying.item);
		}
	};

	const setPlaying = (isPlaying: boolean) => {
		setState((prev) => ({ ...prev, isPlaying }));
		if ('mediaSession' in navigator) {
			navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
		}
	};

	return (
		<MusicPlayerContext.Provider value={player}>
			{children}
			{/* In the DOM, not `new Audio()`, so mobile browsers keep playing in the background. */}
			<audio
				ref={audioRef}
				playsInline
				preload="auto"
				onTimeUpdate={handleTimeUpdate}
				onDurationChange={(e) => {
					const { duration } = e.currentTarget;
					setState((prev) => ({ ...prev, duration }));
				}}
				onEnded={() => {
					const next = advance(queueRef.current, state.repeatMode);
					if (next) void startPlayback(next);
					else setState((prev) => ({ ...prev, isPlaying: false }));
				}}
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onWaiting={() => setState((prev) => ({ ...prev, isLoading: true }))}
				onCanPlay={() => setState((prev) => ({ ...prev, isLoading: false }))}
				onError={() =>
					setState((prev) => ({ ...prev, isLoading: false, isPlaying: false }))
				}
			/>
		</MusicPlayerContext.Provider>
	);
}
