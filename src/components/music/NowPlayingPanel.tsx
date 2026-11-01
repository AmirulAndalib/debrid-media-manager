import {
	ChevronDown,
	Disc3,
	Ellipsis,
	GripVertical,
	Heart,
	Loader2,
	Pause,
	Play,
	Repeat,
	Repeat1,
	Shuffle,
	SkipBack,
	SkipForward,
	Trash2,
	X,
} from 'lucide-react';
import { MouseEvent, useRef, useState } from 'react';
import { useMusicPlayer } from './player/MusicPlayerProvider';
import { artistRoute, contextRoute, MusicRoute } from './routes';
import { QueuedTrack } from './types';
import { useMusicUser } from './user/MusicUserProvider';
import { dragRow, formatDuration, trackRef, trackTitle } from './utils';

/** What a player context is called: an album's or a playlist's name, or Liked Songs. */
export function contextName(
	contextId: string | null,
	items: QueuedTrack[],
	playlists: { id: string; name: string }[]
): string | null {
	const route = contextRoute(contextId);
	if (route?.name === 'liked') return 'Liked Songs';
	if (route?.name === 'playlist') {
		return playlists.find((p) => p.id === route.id)?.name ?? 'Playlist';
	}
	if (route?.name === 'album') {
		return items.find((i) => i.album.hash === route.hash)?.album.album ?? 'Album';
	}
	return null;
}

interface NowPlayingPanelProps {
	navigate: (route: MusicRoute) => void;
	onClose: () => void;
	onTrackMenu: (e: MouseEvent, item: QueuedTrack) => void;
	/** The phone's full-screen sheet: playback controls, and the queue on its own tab. */
	sheet?: boolean;
}

const iconButton =
	'flex shrink-0 items-center justify-center rounded-full p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white';

export default function NowPlayingPanel({
	navigate,
	onClose,
	onTrackMenu,
	sheet = false,
}: NowPlayingPanelProps) {
	const player = useMusicPlayer();
	const user = useMusicUser();
	const dragged = useRef<number | null>(null);
	const [tab, setTab] = useState<'playing' | 'queue'>('playing');
	const now = player.nowPlaying;
	if (!now) return null;

	const { item } = now;
	const liked = user.isLiked(item.track.id);
	const queued = player.upNext.slice(0, player.priorityCount);
	const fromContext = player.upNext.slice(player.priorityCount);
	const context = contextName(now.contextId, [item, ...player.upNext], user.library.playlists);
	const contextTo = contextRoute(now.contextId);
	const go = (to: MusicRoute) => {
		navigate(to);
		if (sheet) onClose();
	};

	// Cover, title and artist: the pane is too narrow for the album table's columns.
	const queueRow = (q: QueuedTrack, position: number) => {
		const title = trackTitle(q.track);
		return (
			<div
				key={`${q.track.id}-${position}`}
				className="flex items-center gap-1 rounded-md hover:bg-white/5"
				{...dragRow(position, dragged, player.moveInQueue)}
			>
				<span className="hidden cursor-grab pl-1 text-gray-600 sm:block" aria-hidden>
					<GripVertical className="h-4 w-4" />
				</span>
				<button
					type="button"
					onClick={() => player.playAt(position)}
					onContextMenu={(e) => onTrackMenu(e, q)}
					aria-label={`Play ${title} by ${q.album.artist}`}
					className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
				>
					<span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-800">
						<Disc3 className="h-5 w-5 text-gray-500" />
						{q.album.coverUrl && (
							// oxlint-disable-next-line nextjs/no-img-element
							<img
								src={q.album.coverUrl}
								alt=""
								loading="lazy"
								className="absolute inset-0 h-full w-full object-cover"
								onError={(e) => {
									(e.target as HTMLImageElement).style.display = 'none';
								}}
							/>
						)}
					</span>
					<span className="min-w-0">
						<span className="block truncate text-sm text-white">{title}</span>
						<span className="block truncate text-xs text-gray-400">
							{q.album.artist}
						</span>
					</span>
				</button>
				<button
					type="button"
					onClick={() => player.removeAt(position)}
					className={iconButton}
					aria-label={`Remove ${title} from the queue`}
					title="Remove from queue"
				>
					<X className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={(e) => onTrackMenu(e, q)}
					className={iconButton}
					aria-label={`More options for ${title}`}
					title="More options"
				>
					<Ellipsis className="h-4 w-4" />
				</button>
			</div>
		);
	};

	const playing = (
		<div className="flex flex-col gap-4">
			<div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg bg-gray-800 shadow-music-2xl">
				<div className="flex h-full w-full items-center justify-center">
					<Disc3 className="h-16 w-16 text-gray-500" />
				</div>
				{item.album.coverUrl && (
					// oxlint-disable-next-line nextjs/no-img-element
					<img
						src={item.album.coverUrl}
						alt={item.album.album}
						className="absolute inset-0 h-full w-full object-cover"
						onError={(e) => {
							(e.target as HTMLImageElement).style.display = 'none';
						}}
					/>
				)}
			</div>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<p className="truncate text-xl font-bold text-white">
						{trackTitle(item.track)}
					</p>
					<button
						type="button"
						onClick={() => go(artistRoute(item.album))}
						className="block max-w-full truncate text-left text-sm text-gray-300 hover:text-white hover:underline"
					>
						{item.album.artist}
					</button>
					<button
						type="button"
						onClick={() => go({ name: 'album', hash: item.album.hash })}
						className="block max-w-full truncate text-left text-sm text-gray-400 hover:text-white hover:underline"
					>
						{item.album.album}
					</button>
				</div>
				<button
					type="button"
					onClick={() =>
						liked
							? user.unlike(trackRef(item.track, item.album))
							: user.like(trackRef(item.track, item.album))
					}
					aria-pressed={liked}
					aria-label={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
					title={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
					className={`${iconButton} ${liked ? 'text-green-500 hover:text-green-400' : ''}`}
				>
					<Heart className="h-6 w-6" fill={liked ? 'currentColor' : 'none'} />
				</button>
			</div>
			{sheet && (
				<div className="flex flex-col gap-3">
					<div className="flex items-center gap-2">
						<span className="w-10 font-mono text-xs text-gray-400">
							{formatDuration(player.currentTime)}
						</span>
						<input
							type="range"
							min={0}
							max={player.duration || 100}
							value={player.currentTime}
							onChange={(e) => player.seek(parseFloat(e.target.value))}
							aria-label="Playback position"
							className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-gray-600 accent-green-500"
						/>
						<span className="w-10 text-right font-mono text-xs text-gray-400">
							{formatDuration(player.duration)}
						</span>
					</div>
					<div className="flex items-center justify-between px-2">
						<button
							type="button"
							onClick={player.toggleShuffle}
							aria-label="Shuffle"
							aria-pressed={player.isShuffled}
							className={player.isShuffled ? 'text-green-500' : 'text-gray-300'}
						>
							<Shuffle className="h-6 w-6" />
						</button>
						<button
							type="button"
							onClick={player.prev}
							aria-label="Previous track"
							className="text-white"
						>
							<SkipBack className="h-8 w-8" fill="currentColor" />
						</button>
						<button
							type="button"
							onClick={player.togglePlay}
							disabled={player.isLoading}
							aria-label={player.isPlaying ? 'Pause' : 'Play'}
							className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black disabled:opacity-50"
						>
							{player.isLoading ? (
								<Loader2 className="h-7 w-7 animate-spin" />
							) : player.isPlaying ? (
								<Pause className="h-7 w-7" fill="currentColor" />
							) : (
								<Play className="h-7 w-7 pl-1" fill="currentColor" />
							)}
						</button>
						<button
							type="button"
							onClick={player.next}
							aria-label="Next track"
							className="text-white"
						>
							<SkipForward className="h-8 w-8" fill="currentColor" />
						</button>
						<button
							type="button"
							onClick={player.cycleRepeat}
							aria-label={`Repeat: ${player.repeatMode}`}
							aria-pressed={player.repeatMode !== 'off'}
							className={
								player.repeatMode !== 'off' ? 'text-green-500' : 'text-gray-300'
							}
						>
							{player.repeatMode === 'one' ? (
								<Repeat1 className="h-6 w-6" />
							) : (
								<Repeat className="h-6 w-6" />
							)}
						</button>
					</div>
				</div>
			)}
		</div>
	);

	const queue = (
		<div className="flex flex-col gap-6">
			{queued.length > 0 && (
				<section aria-label="Next in queue">
					<h3 className="mb-1 px-2 font-bold text-white">Next in queue</h3>
					{queued.map((q, i) => queueRow(q, i))}
				</section>
			)}
			{fromContext.length > 0 && (
				<section aria-label={`Next from ${context ?? 'this list'}`}>
					<h3 className="mb-1 truncate px-2 font-bold text-white">
						Next from{' '}
						{contextTo ? (
							<button
								type="button"
								onClick={() => go(contextTo)}
								className="hover:underline"
							>
								{context}
							</button>
						) : (
							(context ?? 'this list')
						)}
					</h3>
					{fromContext.map((q, i) => queueRow(q, player.priorityCount + i))}
				</section>
			)}
			{player.upNext.length === 0 && (
				<p className="px-2 text-sm text-gray-400">
					Nothing plays after this. Add songs with Add to queue in any menu.
				</p>
			)}
		</div>
	);

	const tabClass = (active: boolean) =>
		`flex-1 border-b-2 py-2 text-sm font-bold transition-colors ${
			active ? 'border-green-500 text-white' : 'border-transparent text-gray-400'
		}`;

	return (
		<div className="flex h-full min-h-0 flex-col" aria-label="Now Playing">
			<div className="flex items-center gap-2 px-4 py-3">
				{sheet && (
					<button
						type="button"
						onClick={onClose}
						className={iconButton}
						aria-label="Close Now Playing"
						title="Close"
					>
						<ChevronDown className="h-6 w-6" />
					</button>
				)}
				<h2 className="min-w-0 flex-1 truncate font-bold text-white">
					{sheet && context ? context : 'Now Playing'}
				</h2>
				<button
					type="button"
					onClick={player.clearQueue}
					className={`${iconButton} hover:bg-red-500/10 hover:text-red-400`}
					aria-label="Clear queue"
					title="Clear queue"
				>
					<Trash2 className="h-4 w-4" />
				</button>
				{!sheet && (
					<button
						type="button"
						onClick={onClose}
						className={iconButton}
						aria-label="Close Now Playing"
						title="Close"
					>
						<X className="h-4 w-4" />
					</button>
				)}
			</div>
			{sheet && (
				<div className="flex px-4" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'playing'}
						onClick={() => setTab('playing')}
						className={tabClass(tab === 'playing')}
					>
						Now Playing
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'queue'}
						onClick={() => setTab('queue')}
						className={tabClass(tab === 'queue')}
					>
						Queue
					</button>
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
				{(!sheet || tab === 'playing') && playing}
				{(!sheet || tab === 'queue') && <div className={sheet ? '' : 'mt-8'}>{queue}</div>}
			</div>
		</div>
	);
}
