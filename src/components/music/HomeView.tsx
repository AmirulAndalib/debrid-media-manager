import type { MusicAlbum } from '@/pages/api/music/library';
import type { MusicRecentAlbumsResponse } from '@/pages/api/music/me/history';
import { Disc3, Heart, ListMusic, Pause, Play } from 'lucide-react';
import { MouseEvent, ReactNode, useEffect, useState } from 'react';
import AlbumCard from './AlbumCard';
import { contextName } from './NowPlayingPanel';
import { useMusicPlayer } from './player/MusicPlayerProvider';
import { contextRoute, MusicRoute } from './routes';
import { useMusicUser } from './user/MusicUserProvider';
import { catalogAlbum } from './utils';

const RECENTLY_PLAYED_LIMIT = 12;

export function greeting(hour: number): string {
	if (hour < 5 || hour >= 18) return 'Good evening';
	return hour < 12 ? 'Good morning' : 'Good afternoon';
}

interface HomeViewProps {
	navigate: (route: MusicRoute) => void;
	/** The newest albums in the catalog. */
	newAlbums: MusicAlbum[];
	onPlayAlbum: (album: MusicAlbum) => void;
	onAlbumMenu: (e: MouseEvent, album: MusicAlbum) => void;
	onCoverLoaded: (album: MusicAlbum, coverUrl: string) => void;
}

function Shelf({
	title,
	onShowAll,
	children,
}: {
	title: string;
	onShowAll?: () => void;
	children: ReactNode;
}) {
	return (
		<section className="mb-8" aria-label={title}>
			<div className="mb-3 flex items-end justify-between gap-4">
				<h2 className="min-w-0 truncate text-xl font-bold text-white md:text-2xl">
					{title}
				</h2>
				{onShowAll && (
					<button
						type="button"
						onClick={onShowAll}
						className="shrink-0 text-sm font-bold text-gray-400 transition-colors hover:text-white hover:underline"
					>
						Show all
					</button>
				)}
			</div>
			<div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 sm:gap-4">
				{children}
			</div>
		</section>
	);
}

const cardWidth = 'w-36 shrink-0 snap-start sm:w-44';

function Tile({
	title,
	subtitle,
	cover,
	onOpen,
	onPlay,
	isPlaying = false,
}: {
	title: string;
	subtitle: string;
	cover: ReactNode;
	onOpen: () => void;
	onPlay?: () => void;
	isPlaying?: boolean;
}) {
	return (
		<div className={cardWidth}>
			<div
				role="button"
				tabIndex={0}
				onClick={onOpen}
				onKeyDown={(e) => {
					if (e.key === 'Enter') onOpen();
				}}
				aria-label={`Open ${title}`}
				className="group flex cursor-pointer flex-col rounded-xl bg-gray-800/40 p-3 transition-colors hover:bg-gray-800/70 sm:p-4"
			>
				<div className="relative mb-3 aspect-square w-full overflow-hidden rounded-lg bg-gradient-to-br from-gray-700 to-gray-800 shadow-lg">
					{cover}
					{onPlay && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onPlay();
							}}
							aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
							className="absolute right-2 bottom-2 flex h-11 w-11 items-center justify-center rounded-full bg-green-500 text-black shadow-lg transition-transform hover:scale-105 hover:bg-green-400"
						>
							{isPlaying ? (
								<Pause className="h-5 w-5" fill="currentColor" />
							) : (
								<Play className="h-5 w-5 pl-0.5" fill="currentColor" />
							)}
						</button>
					)}
				</div>
				<p className="truncate font-semibold text-white">{title}</p>
				<p className="truncate text-sm text-gray-400">{subtitle}</p>
			</div>
		</div>
	);
}

const imageCover = (url: string | null, Fallback: typeof Disc3) => (
	<>
		<div className="flex h-full w-full items-center justify-center">
			<Fallback className="h-12 w-12 text-gray-500" />
		</div>
		{url && (
			// oxlint-disable-next-line nextjs/no-img-element
			<img
				src={url}
				alt=""
				loading="lazy"
				className="absolute inset-0 h-full w-full object-cover"
				onError={(e) => {
					(e.target as HTMLImageElement).style.display = 'none';
				}}
			/>
		)}
	</>
);

const likedCover = (
	<div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-green-600 to-gray-900">
		<Heart className="h-12 w-12 text-white" fill="currentColor" />
	</div>
);

export default function HomeView({
	navigate,
	newAlbums,
	onPlayAlbum,
	onAlbumMenu,
	onCoverLoaded,
}: HomeViewProps) {
	const player = useMusicPlayer();
	const user = useMusicUser();
	const [recent, setRecent] = useState<MusicAlbum[]>([]);

	useEffect(() => {
		if (!user.userId) return;
		let cancelled = false;
		user.musicFetch(`/api/music/me/history?group=album&limit=${RECENTLY_PLAYED_LIMIT}`)
			.then(async (res) => {
				if (!res.ok || cancelled) return;
				const { items }: MusicRecentAlbumsResponse = await res.json();
				setRecent(items.flatMap((item) => (item.album && catalogAlbum(item.album)) || []));
			})
			.catch((err) => console.error('Failed to load recently played albums:', err));
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [user.userId]);

	const now = player.nowPlaying;
	const nowAlbumHash = now?.item.album.hash ?? null;
	const albumCard = (album: MusicAlbum) => (
		<div key={album.hash} className={cardWidth}>
			<AlbumCard
				album={album}
				onSelect={(a) => navigate({ name: 'album', hash: a.hash })}
				onPlay={onPlayAlbum}
				isNowPlaying={album.hash === nowAlbumHash}
				isPlaying={player.isPlaying}
				onCoverLoaded={onCoverLoaded}
				onMenu={onAlbumMenu}
			/>
		</div>
	);

	let jumpBackIn: ReactNode = null;
	if (now) {
		const route = contextRoute(now.contextId) ?? {
			name: 'album' as const,
			hash: nowAlbumHash!,
		};
		const name =
			contextName(now.contextId, [now.item, ...player.upNext], user.library.playlists) ??
			now.item.album.album;
		const playlist =
			route.name === 'playlist'
				? user.library.playlists.find((p) => p.id === route.id)
				: null;
		jumpBackIn = (
			<Shelf title="Jump back in">
				<Tile
					title={name}
					subtitle={
						route.name === 'playlist'
							? 'Playlist'
							: route.name === 'liked'
								? `${user.likedIds.size} liked songs`
								: now.item.album.artist
					}
					cover={
						route.name === 'liked'
							? likedCover
							: imageCover(
									route.name === 'playlist'
										? (playlist?.coverUrl ?? null)
										: now.item.album.coverUrl,
									route.name === 'playlist' ? ListMusic : Disc3
								)
					}
					onOpen={() => navigate(route)}
					onPlay={player.togglePlay}
					isPlaying={player.isPlaying}
				/>
			</Shelf>
		);
	}

	const firstVisit =
		user.ready &&
		!now &&
		recent.length === 0 &&
		user.library.playlists.length === 0 &&
		user.library.albums.length === 0 &&
		user.likedIds.size === 0;

	return (
		<div className="p-4 md:p-6">
			<h1 className="mb-6 text-2xl font-black text-white md:text-3xl">
				{greeting(new Date().getHours())}
			</h1>

			{firstVisit && (
				<section className="mb-8 rounded-xl bg-gradient-to-br from-green-900/60 to-gray-900 p-6">
					<h2 className="text-xl font-bold text-white md:text-2xl">
						Start with the catalog
					</h2>
					<p className="mt-2 max-w-prose text-sm text-gray-300">
						Every album here is cached on Real-Debrid and plays at once. Browse it,
						press play, and save what you like: your albums, playlists and liked songs
						show up here.
					</p>
					<button
						type="button"
						onClick={() => navigate({ name: 'browse' })}
						className="mt-4 rounded-full bg-green-500 px-6 py-3 font-bold text-black transition-transform hover:scale-105 hover:bg-green-400"
					>
						Browse the catalog
					</button>
				</section>
			)}

			{jumpBackIn}

			{recent.length > 0 && <Shelf title="Recently played">{recent.map(albumCard)}</Shelf>}

			{(user.library.playlists.length > 0 || user.likedIds.size > 0) && (
				<Shelf title="Your playlists" onShowAll={() => navigate({ name: 'library' })}>
					{user.likedIds.size > 0 && (
						<Tile
							title="Liked Songs"
							subtitle={`${user.likedIds.size} ${user.likedIds.size === 1 ? 'song' : 'songs'}`}
							cover={likedCover}
							onOpen={() => navigate({ name: 'liked' })}
						/>
					)}
					{user.library.playlists.map((p) => (
						<Tile
							key={p.id}
							title={p.name}
							subtitle={`${p.trackCount} ${p.trackCount === 1 ? 'song' : 'songs'}`}
							cover={imageCover(p.coverUrl, ListMusic)}
							onOpen={() => navigate({ name: 'playlist', id: p.id })}
						/>
					))}
				</Shelf>
			)}

			{newAlbums.length > 0 && (
				<Shelf title="New in the catalog" onShowAll={() => navigate({ name: 'browse' })}>
					{newAlbums.map(albumCard)}
				</Shelf>
			)}
		</div>
	);
}
