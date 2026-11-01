import type { MusicTrack } from '@/pages/api/music/library';
import type {
	MusicPlaylistDetail,
	MusicPlaylistTrackItem,
} from '@/pages/api/music/me/playlists/[id]';
import {
	Ellipsis,
	GripVertical,
	ListMusic,
	Loader2,
	Pencil,
	Play,
	Shuffle,
	Trash2,
	X,
} from 'lucide-react';
import { MouseEvent, useEffect, useRef, useState } from 'react';
import { MenuItem } from './ContextMenu';
import { shufflePlay } from './LikedView';
import { useMusicPlayer } from './player/MusicPlayerProvider';
import { MusicRoute } from './routes';
import TrackListItem, { UnavailableTrackRow } from './TrackListItem';
import { QueuedTrack } from './types';
import { useMusicUser } from './user/MusicUserProvider';
import { dragRow, rowItem } from './utils';

interface PlaylistViewProps {
	id: string;
	navigate: (route: MusicRoute) => void;
	onMenu: (e: MouseEvent, items: MenuItem[]) => void;
	onTrackMenu: (e: MouseEvent, item: QueuedTrack) => void;
	onDownload: (track: MusicTrack) => Promise<void>;
}

export default function PlaylistView({
	id,
	navigate,
	onMenu,
	onTrackMenu,
	onDownload,
}: PlaylistViewProps) {
	const player = useMusicPlayer();
	const user = useMusicUser();
	const [playlist, setPlaylist] = useState<MusicPlaylistDetail | null>(null);
	const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
	const [editing, setEditing] = useState(false);
	const dragged = useRef<number | null>(null);

	useEffect(() => {
		if (!user.userId) return;
		let cancelled = false;
		setStatus('loading');
		user.musicFetch(`/api/music/me/playlists/${encodeURIComponent(id)}`)
			.then(async (res) => {
				if (cancelled) return;
				if (res.status === 404) return setStatus('missing');
				if (!res.ok) throw new Error(`Playlist answered ${res.status}`);
				setPlaylist(await res.json());
				setStatus('ready');
			})
			.catch((err) => {
				console.error('Failed to load the playlist:', err);
				if (!cancelled) setStatus('failed');
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id, user.userId]);

	if (user.ready && !user.userId) {
		return (
			<p className="p-8 text-center text-gray-400">
				Your library could not load. Reload the page to try again.
			</p>
		);
	}
	if (status !== 'ready' || !playlist) {
		return (
			<div className="flex h-full items-center justify-center p-8 text-center text-gray-400">
				{status === 'missing' ? (
					'This playlist does not exist, or it belongs to another account.'
				) : status === 'failed' ? (
					'The playlist could not load.'
				) : (
					<Loader2 className="h-8 w-8 animate-spin text-green-500" />
				)}
			</div>
		);
	}

	const tracks = playlist.tracks;
	const items = tracks.flatMap((t) => rowItem(t) ?? []);
	const contextId = `playlist:${playlist.id}`;
	const covers = [
		...new Set(tracks.flatMap((t) => (t.album?.coverUrl ? [t.album.coverUrl] : []))),
	].slice(0, 4);
	const setTracks = (next: MusicPlaylistTrackItem[]) =>
		setPlaylist((p) => p && { ...p, tracks: next, trackCount: next.length });

	const rename = async (name: string) => {
		setEditing(false);
		const trimmed = name.trim();
		if (!trimmed || trimmed === playlist.name) return;
		if (await user.renamePlaylist(playlist.id, trimmed)) {
			setPlaylist((p) => p && { ...p, name: trimmed });
		}
	};

	const remove = async (entry: MusicPlaylistTrackItem) => {
		if (await user.removeFromPlaylist(playlist.id, [entry.id])) {
			setTracks(tracks.filter((t) => t.id !== entry.id));
		}
	};

	// Shown at once; put back when the server refuses the new order.
	const move = async (from: number, to: number) => {
		const next = [...tracks];
		next.splice(to, 0, ...next.splice(from, 1));
		setTracks(next);
		if (
			!(await user.reorderPlaylist(
				playlist.id,
				next.map((t) => t.id)
			))
		)
			setTracks(tracks);
	};

	const menuItems: MenuItem[] = [
		{ label: 'Rename', icon: Pencil, onSelect: () => setEditing(true) },
		{
			label: 'Delete',
			icon: Trash2,
			onSelect: async () => {
				if (!window.confirm(`Delete ${playlist.name}? This cannot be undone.`)) return;
				if (await user.deletePlaylist(playlist.id)) navigate({ name: 'library' });
			},
		},
	];

	let playable = 0;
	return (
		<div>
			<div className="bg-gradient-to-b from-gray-700/60 to-transparent px-4 pt-8 pb-6 md:px-8">
				<div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:gap-6">
					<div
						className={`grid h-32 w-32 shrink-0 overflow-hidden rounded-lg bg-gray-800 shadow-music-2xl md:h-48 md:w-48 ${
							covers.length >= 4 ? 'grid-cols-2' : ''
						}`}
					>
						{covers.length === 0 ? (
							<div className="flex items-center justify-center">
								<ListMusic className="h-14 w-14 text-gray-500" />
							</div>
						) : (
							(covers.length >= 4 ? covers : covers.slice(0, 1)).map((url) => (
								// oxlint-disable-next-line nextjs/no-img-element
								<img
									key={url}
									src={url}
									alt=""
									className="h-full w-full object-cover"
								/>
							))
						)}
					</div>
					<div className="max-w-full min-w-0">
						<p className="text-xs font-bold text-white uppercase">Playlist</p>
						{editing ? (
							<input
								autoFocus
								defaultValue={playlist.name}
								maxLength={200}
								aria-label="Playlist name"
								onBlur={(e) => void rename(e.target.value)}
								onKeyDown={(e) => {
									e.stopPropagation();
									if (e.key === 'Enter') void rename(e.currentTarget.value);
									if (e.key === 'Escape') {
										// A blur as the field goes away must not save what was typed.
										e.currentTarget.value = playlist.name;
										setEditing(false);
									}
								}}
								className="mt-1 w-full rounded-md bg-white/10 px-2 text-3xl font-black text-white outline-hidden md:text-5xl"
							/>
						) : (
							<h1 className="mt-1 text-3xl font-black break-words text-white md:text-6xl">
								<button
									type="button"
									onClick={() => setEditing(true)}
									title="Rename"
									className="text-left"
								>
									{playlist.name}
								</button>
							</h1>
						)}
						{playlist.description && (
							<p className="mt-2 text-sm text-gray-300">{playlist.description}</p>
						)}
						<p className="mt-2 text-sm text-gray-300">
							{tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
						</p>
					</div>
				</div>
			</div>

			<div className="flex items-center gap-4 px-4 pb-4 md:px-8">
				<button
					type="button"
					onClick={() => player.playContext(items, 0, contextId)}
					disabled={!items.length}
					aria-label={`Play ${playlist.name}`}
					className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-black shadow-lg shadow-green-500/25 transition-all hover:scale-105 hover:bg-green-400 disabled:opacity-50"
				>
					<Play className="h-6 w-6 pl-0.5" fill="currentColor" />
				</button>
				<button
					type="button"
					onClick={() => shufflePlay(player, items, contextId)}
					disabled={!items.length}
					aria-label={`Shuffle ${playlist.name}`}
					title="Shuffle"
					className="text-gray-400 transition-colors hover:text-white disabled:opacity-50"
				>
					<Shuffle className="h-7 w-7" />
				</button>
				<button
					type="button"
					onClick={(e) => onMenu(e, menuItems)}
					aria-label={`More options for ${playlist.name}`}
					title="More options"
					className="text-gray-400 transition-colors hover:text-white"
				>
					<Ellipsis className="h-7 w-7" />
				</button>
			</div>

			{tracks.length === 0 ? (
				<div className="mx-4 rounded-xl bg-white/5 p-6 md:mx-8">
					<p className="font-bold text-white">
						Let&apos;s find something for your playlist
					</p>
					<p className="mt-1 text-sm text-gray-400">
						Add songs or whole albums with Add to playlist in their menu.
					</p>
					<button
						type="button"
						onClick={() => navigate({ name: 'browse' })}
						className="mt-4 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black transition-transform hover:scale-105"
					>
						Browse the catalog
					</button>
				</div>
			) : (
				<div className="flex flex-col gap-0.5 px-2 pb-8 md:px-6">
					{tracks.map((entry, index) => {
						const item = rowItem(entry);
						const at = item ? playable++ : -1;
						const liked = user.isLiked(`${entry.hash}-${entry.fileId}`);
						const ref = { hash: entry.hash, fileId: entry.fileId, mbid: entry.mbid };
						return (
							<div
								key={entry.id}
								className="flex items-center"
								{...dragRow(index, dragged, (from, to) => void move(from, to))}
							>
								<span
									className="hidden cursor-grab text-gray-600 sm:block"
									aria-hidden
								>
									<GripVertical className="h-4 w-4" />
								</span>
								<div className="min-w-0 flex-1">
									{item ? (
										<TrackListItem
											track={item.track}
											index={index}
											album={item.album}
											isCurrentTrack={
												player.nowPlaying?.contextId === contextId &&
												player.nowPlaying.item.track.id === item.track.id
											}
											isPlaying={player.isPlaying}
											onPlay={() => player.playContext(items, at, contextId)}
											onDownload={onDownload}
											onRemove={() => void remove(entry)}
											showRemove
											removeLabel="Remove from this playlist"
											onMenu={(e) => onTrackMenu(e, item)}
											isLiked={liked}
											onToggleLike={() =>
												liked ? user.unlike(ref) : user.like(ref)
											}
										/>
									) : (
										<UnavailableTrackRow
											index={index}
											albumName={entry.album?.album}
											action={{
												label: 'Remove from this playlist',
												icon: X,
												onClick: () => void remove(entry),
											}}
										/>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
