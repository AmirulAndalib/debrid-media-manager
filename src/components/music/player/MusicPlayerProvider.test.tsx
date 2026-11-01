import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueuedTrack } from '../types';
import { MusicPlayer, MusicPlayerProvider, useMusicPlayer } from './MusicPlayerProvider';
import { PersistedPlayerState, PlayerPersistence } from './persistence';
import { emptyQueue, startContext } from './queue';

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

const items = (...ids: string[]): QueuedTrack[] =>
	ids.map((id) => ({
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
	}));

let player: MusicPlayer;
function Probe() {
	player = useMusicPlayer();
	return <input ref={player.registerSearchInput} aria-label="Search" />;
}

const setup = (
	props: Partial<{
		resolveStreamUrl: (track: QueuedTrack['track']) => Promise<string | undefined>;
		persistence: PlayerPersistence;
		onTrackPlayed: (item: QueuedTrack) => void;
	}> = {}
) => {
	const resolveStreamUrl =
		props.resolveStreamUrl ??
		vi.fn(async (track: QueuedTrack['track']) => `https://cdn.example/${track.id}`);
	const { container } = render(
		<MusicPlayerProvider {...props} resolveStreamUrl={resolveStreamUrl}>
			<Probe />
		</MusicPlayerProvider>
	);
	const audio = container.querySelector('audio')!;
	return { audio, resolveStreamUrl };
};

const resolvedIds = (fn: unknown) =>
	(fn as ReturnType<typeof vi.fn>).mock.calls.map(([track]) => (track as { id: string }).id);

// Drive the media clock the way a browser does: small steps, one timeupdate each.
const playTo = (audio: HTMLAudioElement, from: number, to: number) => {
	for (let t = from; t <= to; t++) {
		Object.defineProperty(audio, 'currentTime', {
			value: t,
			configurable: true,
			writable: true,
		});
		fireEvent.timeUpdate(audio);
	}
};

describe('MusicPlayerProvider', () => {
	const spies: { mockRestore: () => void }[] = [];
	beforeEach(() => {
		const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
			this: HTMLMediaElement
		) {
			this.dispatchEvent(new Event('play'));
			return Promise.resolve();
		});
		const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
			this: HTMLMediaElement
		) {
			this.dispatchEvent(new Event('pause'));
		});
		spies.push(play, pause);
	});
	afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

	it('keeps the audio element in the DOM for background playback', () => {
		const { audio } = setup();
		expect(audio).toHaveAttribute('playsinline');
		expect(audio).toHaveAttribute('preload', 'auto');
	});

	it('prefetches only the next item, once, and skips to it without waiting', async () => {
		const { audio, resolveStreamUrl } = setup();
		await act(async () => player.playContext(items('a', 'b', 'c', 'd'), 0, 'album:h'));
		expect(audio.getAttribute('src')).toBe('https://cdn.example/a');
		await waitFor(() => expect(resolvedIds(resolveStreamUrl)).toEqual(['a', 'b']));

		playTo(audio, 1, 5); // re-renders must not prefetch again
		await act(async () => {});
		expect(resolvedIds(resolveStreamUrl)).toEqual(['a', 'b']);

		act(() => player.next());
		// Played from the prefetched URL in the same tick, with no new resolve for it.
		expect(audio.getAttribute('src')).toBe('https://cdn.example/b');
		expect(player.nowPlaying?.item.track.id).toBe('b');
		await waitFor(() => expect(resolvedIds(resolveStreamUrl)).toEqual(['a', 'b', 'c']));
	});

	it('prefetches again when the next item changes', async () => {
		const { resolveStreamUrl } = setup();
		await act(async () => player.playContext(items('a', 'b', 'c'), 0, 'album:h'));
		await waitFor(() => expect(resolvedIds(resolveStreamUrl)).toEqual(['a', 'b']));
		act(() => player.playNext(items('x')));
		await waitFor(() => expect(resolvedIds(resolveStreamUrl)).toEqual(['a', 'b', 'x']));
		expect(player.upNext.map((i) => i.track.id)).toEqual(['x', 'b', 'c']);
		expect(player.priorityCount).toBe(1);
	});

	it('shares an in-flight prefetch with a skip instead of resolving twice', async () => {
		let release: (url: string) => void = () => {};
		const resolveStreamUrl = vi.fn((track: QueuedTrack['track']) =>
			track.id === 'b'
				? new Promise<string>((done) => (release = done))
				: Promise.resolve(`https://cdn.example/${track.id}`)
		);
		const { audio } = setup({ resolveStreamUrl });
		await act(async () => player.playContext(items('a', 'b'), 0, 'album:h'));
		await waitFor(() => expect(resolvedIds(resolveStreamUrl)).toEqual(['a', 'b']));
		act(() => player.next());
		await act(async () => release('https://cdn.example/b'));
		expect(audio.getAttribute('src')).toBe('https://cdn.example/b');
		expect(resolvedIds(resolveStreamUrl)).toEqual(['a', 'b']);
	});

	it('skips a track that will not resolve', async () => {
		const resolveStreamUrl = vi.fn(async (track: QueuedTrack['track']) =>
			track.id === 'a' ? undefined : `https://cdn.example/${track.id}`
		);
		const { audio } = setup({ resolveStreamUrl });
		await act(async () => player.playContext(items('a', 'b'), 0, 'album:h'));
		expect(audio.getAttribute('src')).toBe('https://cdn.example/b');
	});

	it('gives up after five broken tracks in a row', async () => {
		const broken = vi.fn(async () => undefined);
		setup({ resolveStreamUrl: broken });
		await act(async () => player.playContext(items('1', '2', '3', '4', '5', '6', '7'), 0, 'x'));
		expect(resolvedIds(broken)).toEqual(['1', '2', '3', '4', '5']);
		expect(player.isPlaying).toBe(false);
		expect(player.isLoading).toBe(false);
	});

	it('reports a play once, after 30 seconds heard', async () => {
		const onTrackPlayed = vi.fn();
		const { audio } = setup({ onTrackPlayed });
		await act(async () => player.playContext(items('a', 'b'), 0, 'album:h'));
		Object.defineProperty(audio, 'duration', { value: 240, configurable: true });

		playTo(audio, 1, 29);
		expect(onTrackPlayed).not.toHaveBeenCalled();
		playTo(audio, 30, 45);
		expect(onTrackPlayed).toHaveBeenCalledTimes(1);
		expect(onTrackPlayed.mock.calls[0][0].track.id).toBe('a');
	});

	it('reports a short track after half of it, and ignores seeks', async () => {
		const onTrackPlayed = vi.fn();
		const { audio } = setup({ onTrackPlayed });
		await act(async () => player.playContext(items('a'), 0, 'album:h'));
		Object.defineProperty(audio, 'duration', { value: 40, configurable: true });

		playTo(audio, 35, 39); // a seek straight to the end is not listening
		expect(onTrackPlayed).not.toHaveBeenCalled();
		await act(async () => player.playAt(-1)); // replay from the start
		playTo(audio, 0, 20);
		expect(onTrackPlayed).toHaveBeenCalledTimes(1);
	});

	it('restores a saved queue and resolves it on first play', async () => {
		let saved: PersistedPlayerState | null = {
			queue: startContext(emptyQueue, items('a', 'b'), 1, 'album:h', false),
			repeatMode: 'all',
			isShuffled: false,
			volume: 0.5,
		};
		const persistence: PlayerPersistence = {
			load: () => saved,
			save: vi.fn((state) => (saved = state)),
		};
		const { audio, resolveStreamUrl } = setup({ persistence });
		expect(player.nowPlaying?.item.track.id).toBe('b');
		expect(player).toMatchObject({ repeatMode: 'all', volume: 0.5, isPlaying: false });
		expect(audio.volume).toBe(0.5);

		await act(async () => player.togglePlay());
		expect(resolvedIds(resolveStreamUrl)[0]).toBe('b');
		expect(audio.getAttribute('src')).toBe('https://cdn.example/b');

		act(() => player.cycleRepeat());
		expect(saved).toMatchObject({ repeatMode: 'one' });
	});

	it('handles J/L seeking and Ctrl/Cmd+K search focus', async () => {
		const { audio } = setup();
		await act(async () => player.playContext(items('a'), 0, 'album:h'));
		Object.defineProperty(audio, 'duration', { value: 100, configurable: true });
		Object.defineProperty(audio, 'currentTime', {
			value: 50,
			configurable: true,
			writable: true,
		});

		fireEvent.keyDown(window, { key: 'l' });
		expect(audio.currentTime).toBe(60);
		fireEvent.keyDown(window, { key: 'J' });
		expect(audio.currentTime).toBe(50);
		audio.currentTime = 5;
		fireEvent.keyDown(window, { key: 'j' });
		expect(audio.currentTime).toBe(0);

		fireEvent.keyDown(window, { key: 'k', metaKey: true });
		expect(screen.getByLabelText('Search')).toHaveFocus();
		// Typing in the search box does not drive the player.
		fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'l' });
		expect(audio.currentTime).toBe(0);
		fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'k', ctrlKey: true });
		expect(screen.getByLabelText('Search')).toHaveFocus();
	});

	it('keeps the old playback keys', async () => {
		const { audio } = setup();
		await act(async () => player.playContext(items('a', 'b'), 0, 'album:h'));
		fireEvent.keyDown(window, { key: ' ' });
		expect(player.isPlaying).toBe(false);
		fireEvent.keyDown(window, { key: 'ArrowRight' });
		await waitFor(() => expect(player.nowPlaying?.item.track.id).toBe('b'));
		fireEvent.keyDown(window, { key: 'ArrowDown' });
		expect(player.volume).toBeCloseTo(0.95);
		fireEvent.keyDown(window, { key: 'm' });
		expect(audio.muted).toBe(true);
		fireEvent.keyDown(window, { key: 's' });
		expect(player.isShuffled).toBe(true);
		fireEvent.keyDown(window, { key: 'r' });
		expect(player.repeatMode).toBe('all');
		// Browser shortcuts such as Cmd+R are not player keys.
		fireEvent.keyDown(window, { key: 'r', metaKey: true });
		expect(player.repeatMode).toBe('all');
	});

	it('ignores a context with no items instead of restarting the current track', async () => {
		setup();
		await act(async () => player.playContext(items('a'), 0, 'album:h'));
		const play = vi.mocked(HTMLMediaElement.prototype.play);
		const plays = play.mock.calls.length;
		await act(async () => player.playContext([], 0, 'album:empty'));
		expect(play.mock.calls.length).toBe(plays);
		expect(player.nowPlaying?.contextId).toBe('album:h');
	});

	it('removing the playing item plays the next; clearing stops', async () => {
		const { audio } = setup();
		await act(async () => player.playContext(items('a', 'b'), 0, 'album:h'));
		await act(async () => player.removeAt(-1));
		expect(player.nowPlaying?.item.track.id).toBe('b');
		expect(audio.getAttribute('src')).toBe('https://cdn.example/b');
		act(() => player.clearQueue());
		expect(player.nowPlaying).toBeNull();
		expect(player.isPlaying).toBe(false);
		expect(audio.getAttribute('src')).toBe('');
	});
});
