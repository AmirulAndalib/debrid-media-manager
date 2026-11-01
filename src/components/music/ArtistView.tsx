import type { MusicArtistResponse } from '@/pages/api/music/artist';
import type { MusicAlbum } from '@/pages/api/music/library';
import type { MusicPopularResponse } from '@/pages/api/music/popular';
import { Loader2, Pause, Play, UserRound } from 'lucide-react';
import { CSSProperties, MouseEvent, useEffect, useState } from 'react';
import { AlbumCardGrid, AlbumTypeFilter, isAlbumType, TypeChips } from './AlbumGrid';
import { useCoverTint } from './coverTint';
import { useMusicPlayer } from './player/MusicPlayerProvider';
import { MusicRoute } from './routes';
import TrackListItem from './TrackListItem';
import { QueuedTrack } from './types';
import { useMusicUser } from './user/MusicUserProvider';
import { rowItem, trackRef } from './utils';

const POPULAR_LIMIT = 10;

interface ArtistViewProps {
	mbid: string;
	navigate: (route: MusicRoute) => void;
	/** Plays a summary, fetching its tracks first. */
	onPlayAlbum: (album: MusicAlbum) => void;
	onAlbumMenu: (e: MouseEvent, album: MusicAlbum) => void;
	onTrackMenu: (e: MouseEvent, item: QueuedTrack) => void;
	onCoverLoaded: (album: MusicAlbum, coverUrl: string) => void;
}

/** An artist's popular tracks and every album of theirs in the catalog. */
export default function ArtistView({
	mbid,
	navigate,
	onPlayAlbum,
	onAlbumMenu,
	onTrackMenu,
	onCoverLoaded,
}: ArtistViewProps) {
	const player = useMusicPlayer();
	const user = useMusicUser();
	const [artist, setArtist] = useState<MusicArtistResponse | 'missing' | 'failed' | null>(null);
	const [popular, setPopular] = useState<QueuedTrack[]>([]);
	const [type, setType] = useState<AlbumTypeFilter>('all');
	const loaded = typeof artist === 'object' ? artist : null;
	const cover = loaded?.albums.find((album) => album.coverUrl)?.coverUrl ?? null;
	const tint = useCoverTint(cover);

	useEffect(() => {
		let cancelled = false;
		const id = encodeURIComponent(mbid);
		fetch(`/api/music/artist?mbid=${id}`)
			.then(async (res) => {
				const next: typeof artist = res.ok
					? await res.json()
					: res.status === 404
						? 'missing'
						: 'failed';
				if (!cancelled) setArtist(next);
			})
			.catch(() => !cancelled && setArtist('failed'));
		fetch(`/api/music/popular?artistMbid=${id}&limit=${POPULAR_LIMIT}`)
			.then(async (res) => {
				if (!res.ok) return;
				const { items }: MusicPopularResponse = await res.json();
				if (!cancelled) setPopular(items.flatMap((item) => rowItem(item) ?? []));
			})
			.catch((err) => console.error('Failed to load popular tracks:', err));
		return () => {
			cancelled = true;
		};
	}, [mbid]);

	if (!artist) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-green-500" />
			</div>
		);
	}
	if (!loaded) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-gray-400">
				<p>
					{artist === 'missing'
						? 'No albums from this artist yet'
						: 'This artist could not load. Try again in a while.'}
				</p>
				<button
					type="button"
					onClick={() => navigate({ name: 'browse' })}
					className="text-sm font-bold text-green-500 hover:underline"
				>
					Browse the catalog
				</button>
			</div>
		);
	}

	const { albums } = loaded;
	const { name } = loaded.artist;
	const contextId = `artist:${mbid}:popular`;
	const playingHere = player.nowPlaying?.contextId === contextId;
	const following = user.isFollowed(mbid);

	return (
		<div
			className="@container"
			style={tint ? ({ '--tint': tint } as CSSProperties) : undefined}
		>
			<div
				className={`px-4 pt-8 pb-6 @2xl:px-8 ${
					tint
						? 'bg-[linear-gradient(var(--tint),transparent)]'
						: 'bg-gradient-to-b from-green-900/40 to-transparent'
				}`}
			>
				<div className="flex flex-col items-center gap-4 text-center @2xl:flex-row @2xl:items-end @2xl:gap-6 @2xl:text-left">
					<div className="relative flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-800 shadow-music-2xl @2xl:h-48 @2xl:w-48">
						<UserRound className="h-16 w-16 text-gray-500" />
						{cover && (
							// oxlint-disable-next-line nextjs/no-img-element
							<img
								src={cover}
								alt=""
								className="absolute inset-0 h-full w-full object-cover"
								onError={(e) => {
									(e.target as HTMLImageElement).style.display = 'none';
								}}
							/>
						)}
					</div>
					<div className="max-w-full min-w-0">
						<p className="text-xs font-bold text-white uppercase">Artist</p>
						<h1 className="mt-1 text-3xl font-black break-words text-white @2xl:text-6xl">
							{name}
						</h1>
						<p className="mt-2 text-sm text-gray-300">
							{albums.length} {albums.length === 1 ? 'album' : 'albums'} in the
							catalog
						</p>
					</div>
				</div>
			</div>

			<div className="flex items-center gap-5 px-4 pb-4 @2xl:px-8">
				<button
					type="button"
					onClick={() =>
						playingHere
							? player.togglePlay()
							: popular.length
								? player.playContext(popular, 0, contextId)
								: onPlayAlbum(albums[0])
					}
					aria-label={`${playingHere && player.isPlaying ? 'Pause' : 'Play'} ${name}`}
					className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-500 text-black shadow-lg shadow-green-500/25 transition-all hover:scale-105 hover:bg-green-400"
				>
					{playingHere && player.isPlaying ? (
						<Pause className="h-6 w-6" fill="currentColor" />
					) : (
						<Play className="h-6 w-6 pl-0.5" fill="currentColor" />
					)}
				</button>
				<button
					type="button"
					onClick={() =>
						following ? user.unfollowArtist(mbid) : user.followArtist(mbid, name)
					}
					aria-pressed={following}
					className="shrink-0 rounded-full border border-gray-500 px-4 py-1.5 text-sm font-bold text-white transition-colors hover:border-white"
				>
					{following ? 'Following' : 'Follow'}
				</button>
			</div>

			{popular.length > 0 && (
				<section aria-label="Popular" className="px-2 pb-6 @2xl:px-6">
					<h2 className="mb-2 px-2 text-xl font-bold text-white @2xl:text-2xl">
						Popular
					</h2>
					{popular.map((item, index) => {
						const liked = user.isLiked(item.track.id);
						const ref = trackRef(item.track, item.album);
						return (
							<TrackListItem
								key={item.track.id}
								track={item.track}
								index={index}
								number={index + 1}
								album={item.album}
								showArtist={false}
								isCurrentTrack={
									playingHere &&
									player.nowPlaying?.item.track.id === item.track.id
								}
								isPlaying={player.isPlaying}
								onPlay={() => player.playContext(popular, index, contextId)}
								onMenu={(e) => onTrackMenu(e, item)}
								isLiked={liked}
								onToggleLike={() => (liked ? user.unlike(ref) : user.like(ref))}
							/>
						);
					})}
				</section>
			)}

			<section aria-label="Discography" className="px-4 pb-8 @2xl:px-8">
				<h2 className="mb-3 text-xl font-bold text-white @2xl:text-2xl">Discography</h2>
				<div className="mb-4">
					<TypeChips albums={albums} value={type} onChange={setType} />
				</div>
				<AlbumCardGrid
					albums={albums.filter((album) => isAlbumType(album, type))}
					onSelect={(album) => navigate({ name: 'album', hash: album.hash })}
					onPlay={onPlayAlbum}
					nowPlayingAlbumHash={player.nowPlaying?.item.album.hash ?? null}
					isPlaying={player.isPlaying}
					onCoverLoaded={onCoverLoaded}
					onAlbumMenu={onAlbumMenu}
				/>
			</section>
		</div>
	);
}
