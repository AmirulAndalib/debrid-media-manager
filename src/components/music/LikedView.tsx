import type { MusicTrack } from '@/pages/api/music/library';
import type { MusicLikeItem, MusicLikesResponse } from '@/pages/api/music/me/likes';
import { Heart, Loader2, Play, Shuffle } from 'lucide-react';
import { MouseEvent, useEffect, useRef, useState } from 'react';
import { useMusicPlayer } from './player/MusicPlayerProvider';
import TrackListItem, { UnavailableTrackRow } from './TrackListItem';
import { QueuedTrack } from './types';
import { useMusicUser } from './user/MusicUserProvider';
import { rowItem } from './utils';

const PAGE_SIZE = 50;

interface LikedViewProps {
	onTrackMenu: (e: MouseEvent, item: QueuedTrack) => void;
	onDownload: (track: MusicTrack) => Promise<void>;
}

/** Plays `items` from `start`, shuffled: Spotify's Shuffle button. */
export function shufflePlay(
	player: ReturnType<typeof useMusicPlayer>,
	items: QueuedTrack[],
	contextId: string
) {
	if (!items.length) return;
	player.playContext(items, Math.floor(Math.random() * items.length), contextId);
	if (!player.isShuffled) player.toggleShuffle();
}

export default function LikedView({ onTrackMenu, onDownload }: LikedViewProps) {
	const player = useMusicPlayer();
	const user = useMusicUser();
	const [rows, setRows] = useState<MusicLikeItem[]>([]);
	const [nextPage, setNextPage] = useState<number | null>(1);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const sentinel = useRef<HTMLDivElement>(null);

	const loadPage = async (page: number) => {
		setLoading(true);
		try {
			const res = await user.musicFetch(
				`/api/music/me/likes?page=${page}&limit=${PAGE_SIZE}`
			);
			if (!res.ok) throw new Error(`Liked songs answered ${res.status}`);
			const data: MusicLikesResponse = await res.json();
			setRows((prev) => (page === 1 ? data.items : [...prev, ...data.items]));
			setNextPage(data.hasMore ? page + 1 : null);
		} catch (err) {
			console.error('Failed to load liked songs:', err);
			setFailed(true);
			setNextPage(null);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (user.userId) void loadPage(1);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [user.userId]);

	// The next page loads as the end of the list scrolls near, as the catalog grid does.
	useEffect(() => {
		const element = sentinel.current;
		if (loading || !nextPage || nextPage === 1 || !element) return;
		if (typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void loadPage(nextPage);
			},
			{ rootMargin: '600px' }
		);
		observer.observe(element);
		return () => observer.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loading, nextPage]);

	const items = rows.flatMap((row) => rowItem(row) ?? []);
	const playingHere = player.nowPlaying?.contextId === 'liked';
	const count = user.likedIds.size;
	let playable = 0;

	return (
		<div>
			<div className="bg-gradient-to-b from-green-800/60 to-transparent px-4 pt-8 pb-6 md:px-8">
				<div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:gap-6">
					<div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-green-600 to-gray-900 shadow-music-2xl md:h-48 md:w-48">
						<Heart
							className="h-14 w-14 text-white md:h-20 md:w-20"
							fill="currentColor"
						/>
					</div>
					<div className="min-w-0">
						<p className="text-xs font-bold text-white uppercase">Playlist</p>
						<h1 className="mt-1 text-3xl font-black text-white md:text-6xl">
							Liked Songs
						</h1>
						<p className="mt-2 text-sm text-gray-300">
							{count} {count === 1 ? 'song' : 'songs'}
						</p>
					</div>
				</div>
			</div>

			<div className="flex items-center gap-4 px-4 pb-4 md:px-8">
				<button
					type="button"
					onClick={() => player.playContext(items, 0, 'liked')}
					disabled={!items.length}
					aria-label="Play Liked Songs"
					className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-black shadow-lg shadow-green-500/25 transition-all hover:scale-105 hover:bg-green-400 disabled:opacity-50"
				>
					<Play className="h-6 w-6 pl-0.5" fill="currentColor" />
				</button>
				<button
					type="button"
					onClick={() => shufflePlay(player, items, 'liked')}
					disabled={!items.length}
					aria-label="Shuffle Liked Songs"
					title="Shuffle"
					className="text-gray-400 transition-colors hover:text-white disabled:opacity-50"
				>
					<Shuffle className="h-7 w-7" />
				</button>
			</div>

			<div className="flex flex-col gap-0.5 px-2 pb-8 md:px-6">
				{rows.map((row, index) => {
					const ref = { hash: row.hash, fileId: row.fileId, mbid: row.mbid };
					const liked = user.isLiked(`${row.hash}-${row.fileId}`);
					const toggle = () => (liked ? user.unlike(ref) : user.like(ref));
					const item = rowItem(row);
					if (!item) {
						return (
							<UnavailableTrackRow
								key={`${row.hash}-${row.fileId}`}
								index={index}
								albumName={row.album?.album}
								action={{
									label: liked
										? 'Remove from Liked Songs'
										: 'Save to Liked Songs',
									icon: Heart,
									active: liked,
									onClick: toggle,
								}}
							/>
						);
					}
					const at = playable++;
					return (
						<TrackListItem
							key={`${row.hash}-${row.fileId}`}
							track={item.track}
							index={index}
							album={item.album}
							isCurrentTrack={
								playingHere && player.nowPlaying?.item.track.id === item.track.id
							}
							isPlaying={player.isPlaying}
							onPlay={() => player.playContext(items, at, 'liked')}
							onDownload={onDownload}
							onMenu={(e) => onTrackMenu(e, item)}
							isLiked={liked}
							onToggleLike={toggle}
						/>
					);
				})}
				<div
					ref={sentinel}
					className="flex min-h-16 items-center justify-center text-sm text-gray-400"
				>
					{loading ? (
						<Loader2 className="h-5 w-5 animate-spin text-green-500" />
					) : failed ? (
						'Liked Songs could not load.'
					) : user.ready && !user.userId ? (
						'Your library could not load. Reload the page to try again.'
					) : user.ready && rows.length === 0 && !nextPage ? (
						'Songs you like show up here. Tap the heart on any song.'
					) : null}
				</div>
			</div>
		</div>
	);
}
