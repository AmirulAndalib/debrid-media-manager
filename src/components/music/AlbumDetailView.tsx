import { MusicAlbum, MusicTrack } from '@/pages/api/music/library';
import { getDirectory } from '@/utils/musicTracks';
import { Disc3, Download, Ellipsis, Heart, Pause, Play, Shuffle } from 'lucide-react';
import { CSSProperties, Fragment, MouseEvent, useEffect, useRef, useState } from 'react';
import { useCoverTint } from './coverTint';
import { shufflePlay } from './LikedView';
import { useMusicPlayer } from './player/MusicPlayerProvider';
import { artistRoute, MusicRoute } from './routes';
import TrackListItem from './TrackListItem';
import { useMusicUser } from './user/MusicUserProvider';
import { albumItems, formatSize, trackRef } from './utils';

interface AlbumDetailViewProps {
	album: MusicAlbum;
	navigate: (route: MusicRoute) => void;
	/** Asks first: the browser holds a burst of downloads behind a prompt. */
	onDownloadAlbum: (album: MusicAlbum) => void;
	onCoverLoaded?: (album: MusicAlbum, coverUrl: string) => void;
	onMenu: (e: MouseEvent) => void;
	onTrackMenu: (e: MouseEvent, track: MusicTrack) => void;
}

/** "46 min", or "1 hr 12 min". */
export const formatLength = (ms: number) => {
	const minutes = Math.round(ms / 60_000);
	return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
};

/** "Album · 2012 · 12 songs · 46 min": the length once every track has one, else the size. */
export function albumFacts(album: MusicAlbum): string {
	const timed = album.tracks.length > 0 && album.tracks.every((t) => t.durationMs != null);
	return [
		album.primaryType ?? 'Album',
		album.year,
		`${album.trackCount} ${album.trackCount === 1 ? 'song' : 'songs'}`,
		timed
			? formatLength(album.tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0))
			: formatSize(album.totalBytes),
	]
		.filter(Boolean)
		.join(' · ');
}

/**
 * The divider before each track that starts a folder ("Disc 2" for a CD2 or
 * Disc 2 folder, else the folder's name), or null; all null for one folder.
 */
export function discDividers(tracks: { path: string }[]): (string | null)[] {
	const folders = tracks.map((track) => getDirectory(track.path));
	if (new Set(folders).size < 2) return folders.map(() => null);
	let group = 0;
	return folders.map((folder, i) => {
		if (i > 0 && folder === folders[i - 1]) return null;
		group++;
		const name = folder.split('/').filter(Boolean).pop() ?? '';
		const disc = /\b(?:cd|dis[ck])\s*0*(\d+)/i.exec(name);
		return disc ? `Disc ${disc[1]}` : name || `Disc ${group}`;
	});
}

export default function AlbumDetailView({
	album,
	navigate,
	onDownloadAlbum,
	onCoverLoaded,
	onMenu,
	onTrackMenu,
}: AlbumDetailViewProps) {
	const player = useMusicPlayer();
	const user = useMusicUser();
	const [coverUrl, setCoverUrl] = useState(album.coverUrl);
	const tint = useCoverTint(coverUrl);
	const actionsRef = useRef<HTMLDivElement>(null);
	const [actionsHidden, setActionsHidden] = useState(false);

	useEffect(() => {
		setCoverUrl(album.coverUrl);
	}, [album.coverUrl]);

	useEffect(() => {
		if (coverUrl || !onCoverLoaded) return;
		let isCancelled = false;
		const handleCoverLoaded = onCoverLoaded;

		async function fetchCover() {
			try {
				const response = await fetch('/api/music/cover', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						mbid: album.mbid,
						artist: album.artist,
						album: album.album,
					}),
				});
				if (!response.ok) return;
				const data = await response.json();
				if (!isCancelled && data.coverUrl) {
					setCoverUrl(data.coverUrl);
					handleCoverLoaded(album, data.coverUrl);
				}
			} catch (err) {
				console.error(`Failed to fetch cover for ${album.album}:`, err);
			}
		}

		fetchCover();
		return () => {
			isCancelled = true;
		};
	}, [album, coverUrl, onCoverLoaded]);

	// The mini header takes over once the buttons scroll out of view.
	useEffect(() => {
		const actions = actionsRef.current;
		if (!actions || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(([entry]) =>
			setActionsHidden(!entry.isIntersecting)
		);
		observer.observe(actions);
		return () => observer.disconnect();
	}, []);

	const contextId = `album:${album.hash}`;
	const items = albumItems(album);
	const playingHere = player.nowPlaying?.contextId === contextId;
	const showPause = playingHere && player.isPlaying;
	const saved = user.isSaved(album.mbid);
	const dividers = discDividers(album.tracks);

	const playButton = (size: string) => (
		<button
			type="button"
			onClick={() =>
				playingHere ? player.togglePlay() : player.playContext(items, 0, contextId)
			}
			aria-label={`${showPause ? 'Pause' : 'Play'} ${album.album}`}
			className={`flex shrink-0 items-center justify-center rounded-full bg-green-500 text-black shadow-lg shadow-green-500/25 transition-all hover:scale-105 hover:bg-green-400 ${size}`}
		>
			{showPause ? (
				<Pause className="h-1/2 w-1/2" fill="currentColor" />
			) : (
				<Play className="h-1/2 w-1/2 pl-0.5" fill="currentColor" />
			)}
		</button>
	);
	const iconButton = 'shrink-0 text-gray-400 transition-colors hover:text-white';

	return (
		// Sized by its own width, not the window's: Now Playing beside it can leave 590 px.
		<div
			className="@container relative min-h-full"
			style={tint ? ({ '--tint': tint } as CSSProperties) : undefined}
		>
			<div
				data-testid="album-backdrop"
				className={`pointer-events-none absolute inset-x-0 top-0 h-96 ${
					tint
						? 'bg-[linear-gradient(var(--tint),transparent)]'
						: 'bg-gradient-to-b from-green-900/30 via-gray-900/80 to-transparent'
				}`}
			/>

			{/* Takes no room, so showing it never moves the page under the pointer. */}
			<div className="sticky top-0 z-20 h-0">
				{actionsHidden && (
					<div
						className={`absolute inset-x-0 top-0 hidden h-16 items-center gap-3 px-4 shadow-lg md:flex ${
							tint ? 'bg-[color:var(--tint)]' : 'bg-gray-900'
						}`}
					>
						{playButton('h-10 w-10')}
						<span className="min-w-0 truncate text-xl font-bold text-white">
							{album.album}
						</span>
					</div>
				)}
			</div>

			<div className="relative px-4 pt-6 pb-8 @2xl:px-8">
				<header
					onContextMenu={onMenu}
					className="flex flex-col items-center gap-4 text-center @2xl:flex-row @2xl:items-end @2xl:gap-6 @2xl:text-left"
				>
					<div className="relative h-48 w-48 shrink-0 overflow-hidden rounded-md bg-gray-800 shadow-music-2xl @2xl:h-58 @2xl:w-58">
						<div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-700 to-gray-800">
							<Disc3 className="h-24 w-24 text-gray-500" />
						</div>
						{coverUrl && (
							// oxlint-disable-next-line nextjs/no-img-element
							<img
								src={coverUrl}
								alt={album.album}
								className="absolute inset-0 h-full w-full object-cover"
								onError={(e) => {
									(e.target as HTMLImageElement).style.display = 'none';
								}}
							/>
						)}
					</div>
					<div className="max-w-full min-w-0">
						<h1 className="text-3xl font-black break-words text-white @2xl:text-5xl @5xl:text-6xl">
							{album.album}
						</h1>
						<button
							type="button"
							onClick={() => navigate(artistRoute(album))}
							className="mt-3 max-w-full truncate text-sm font-bold text-white hover:underline"
						>
							{album.artist}
						</button>
						<div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm text-gray-300 @2xl:justify-start">
							<span>{albumFacts(album)}</span>
							{album.pack && (
								<span
									title="More files than the release has tracks: a box set or a discography"
									className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold text-white"
								>
									Pack &middot; {album.trackCount} files
								</span>
							)}
						</div>
					</div>
				</header>

				<div ref={actionsRef} className="mt-6 flex items-center gap-5">
					{playButton('h-14 w-14')}
					<button
						type="button"
						onClick={() => shufflePlay(player, items, contextId)}
						aria-label={`Shuffle ${album.album}`}
						title="Shuffle"
						className={iconButton}
					>
						<Shuffle className="h-7 w-7" />
					</button>
					<button
						type="button"
						onClick={() =>
							saved ? user.unsaveAlbum(album.mbid) : user.saveAlbum(album.mbid, album)
						}
						aria-pressed={saved}
						aria-label={saved ? 'Remove from Your Library' : 'Save to Your Library'}
						title={saved ? 'Remove from Your Library' : 'Save to Your Library'}
						className={saved ? 'shrink-0 text-green-500' : iconButton}
					>
						<Heart className="h-7 w-7" fill={saved ? 'currentColor' : 'none'} />
					</button>
					<button
						type="button"
						onClick={() => onDownloadAlbum(album)}
						aria-label={`Download ${album.album}`}
						title="Download"
						className={iconButton}
					>
						<Download className="h-7 w-7" />
					</button>
					<button
						type="button"
						onClick={onMenu}
						aria-label={`More options for ${album.album}`}
						title="More options"
						className={iconButton}
					>
						<Ellipsis className="h-7 w-7" />
					</button>
				</div>

				<div className="mt-6">
					<div className="mb-2 grid grid-cols-[32px_1fr_4rem_58px] items-center gap-2 border-b border-white/10 px-3 py-2 text-xs font-medium tracking-wider text-gray-400 uppercase sm:grid-cols-[40px_1fr_4rem_58px] sm:gap-4 sm:px-4">
						<span className="text-center">#</span>
						<span>Title</span>
						<span className="text-right">
							{album.tracks.some((t) => t.durationMs != null) ? 'Time' : 'Size'}
						</span>
					</div>
					<div className="flex flex-col gap-0.5">
						{album.tracks.map((track, index) => {
							const ref = trackRef(track, album);
							const liked = user.isLiked(track.id);
							return (
								<Fragment key={track.id}>
									{dividers[index] && (
										<div className="flex items-center gap-3 px-3 pt-4 pb-1 text-sm font-bold text-gray-400 sm:px-4">
											<Disc3 className="h-4 w-4" />
											{dividers[index]}
										</div>
									)}
									<TrackListItem
										track={track}
										index={index}
										album={album}
										isCurrentTrack={
											player.nowPlaying?.item.track.id === track.id
										}
										isPlaying={player.isPlaying}
										onPlay={() => player.playContext(items, index, contextId)}
										onMenu={(e) => onTrackMenu(e, track)}
										isLiked={liked}
										onToggleLike={() =>
											liked ? user.unlike(ref) : user.like(ref)
										}
										// ponytail: tracks carry no artist of their own yet; show one once a track's differs.
										showArtist={false}
									/>
								</Fragment>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
