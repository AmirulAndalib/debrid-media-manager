import type { MusicAlbum } from '@/pages/api/music/library';
import type { MusicSearchResponse } from '@/pages/api/music/search';
import type { MusicArtistHit } from '@/services/musicCatalog';
import { Disc3, Loader2, Play, UserRound } from 'lucide-react';
import { MouseEvent, ReactNode, useEffect, useState } from 'react';
import { AlbumCardGrid, AlbumTypeFilter, TypeChips } from './AlbumGrid';
import { useMusicPlayer } from './player/MusicPlayerProvider';
import { MusicRoute } from './routes';
import TrackListItem from './TrackListItem';
import { QueuedTrack } from './types';
import { useMusicUser } from './user/MusicUserProvider';
import { trackRef } from './utils';

export const SEARCH_DEBOUNCE_MS = 250;
const SONGS_SHOWN = 5;

interface SearchViewProps {
	/** What the search box holds, searched once it stops changing. */
	q: string;
	navigate: (route: MusicRoute) => void;
	/** Plays a summary, fetching its tracks first. */
	onPlayAlbum: (album: MusicAlbum) => void;
	onAlbumMenu: (e: MouseEvent, album: MusicAlbum) => void;
	onTrackMenu: (e: MouseEvent, item: QueuedTrack) => void;
	onCoverLoaded: (album: MusicAlbum, coverUrl: string) => void;
	/** The newest albums in the catalog, shown before anything is typed. */
	recentAlbums: MusicAlbum[];
	/** Opens Browse on a release type. */
	onBrowseType: (type: AlbumTypeFilter) => void;
}

/** Letters and digits only, without accents or a leading "the". */
const comparable = (text: string) =>
	text
		.normalize('NFD')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/^the /, '');

/** The artist the query names, as it is typed: "green", "green day", "Green Day!". */
export function topArtist(artists: MusicArtistHit[], q: string): MusicArtistHit | null {
	const query = comparable(q);
	return (query && artists.find((artist) => comparable(artist.name).startsWith(query))) || null;
}

function Section({
	title,
	aside,
	children,
}: {
	title: string;
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section aria-label={title} className="mb-8 min-w-0">
			<div className="mb-3 flex items-end justify-between gap-4">
				<h2 className="truncate text-xl font-bold text-white @2xl:text-2xl">{title}</h2>
				{aside}
			</div>
			{children}
		</section>
	);
}

const picture = (url: string | null, round: boolean, Fallback: typeof Disc3) => (
	<div
		className={`relative flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-gray-700 to-gray-800 shadow-lg ${
			round ? 'rounded-full' : 'rounded-md'
		}`}
	>
		<Fallback className="h-1/3 w-1/3 text-gray-500" />
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
	</div>
);

const grid = 'grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-5';

/** The catalog's artists, songs and albums for the search box's text. */
export default function SearchView({
	q,
	navigate,
	onPlayAlbum,
	onAlbumMenu,
	onTrackMenu,
	onCoverLoaded,
	recentAlbums,
	onBrowseType,
}: SearchViewProps) {
	const player = useMusicPlayer();
	const user = useMusicUser();
	const query = q.trim();
	const [results, setResults] = useState<(MusicSearchResponse & { q: string }) | null>(null);
	const [failed, setFailed] = useState(false);
	const [showAllSongs, setShowAllSongs] = useState(false);

	useEffect(() => {
		if (!query) return;
		let cancelled = false;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/music/search?q=${encodeURIComponent(query)}`);
				if (!res.ok) throw new Error(`Search answered ${res.status}`);
				const data: MusicSearchResponse = await res.json();
				if (cancelled) return;
				setResults({ ...data, q: query });
				setShowAllSongs(false);
				setFailed(false);
			} catch (err) {
				console.error('Music search failed:', err);
				if (!cancelled) setFailed(true);
			}
		}, SEARCH_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [query]);

	const nowPlayingAlbumHash = player.nowPlaying?.item.album.hash ?? null;
	const cards = {
		onSelect: (album: MusicAlbum) => navigate({ name: 'album', hash: album.hash }),
		onPlay: onPlayAlbum,
		nowPlayingAlbumHash,
		isPlaying: player.isPlaying,
		onCoverLoaded,
		onAlbumMenu,
	};

	if (!query) {
		return (
			<div className="@container p-3 md:p-6">
				<div className="mb-6">
					<TypeChips albums={recentAlbums} value="all" onChange={onBrowseType} every />
				</div>
				<Section title="New in the catalog">
					<AlbumCardGrid albums={recentAlbums} {...cards} />
				</Section>
			</div>
		);
	}
	if (!results) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center text-gray-400">
				{failed ? (
					'Search failed. Try again in a while.'
				) : (
					<Loader2 className="h-8 w-8 animate-spin text-green-500" />
				)}
			</div>
		);
	}

	const { artists, albums } = results;
	const songs: QueuedTrack[] = results.tracks;
	if (!artists.length && !albums.length && !songs.length) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
				<p className="text-lg font-bold text-white">
					Nothing in the catalog for &ldquo;{results.q}&rdquo;
				</p>
				<p className="max-w-prose text-sm text-gray-400">
					The catalog holds albums cached on Real-Debrid. Check the spelling, or try
					another artist, album or song.
				</p>
			</div>
		);
	}

	const artist = topArtist(artists, results.q);
	const top = artist ?? albums[0];
	const contextId = `search:${results.q}`;
	const playingHere = player.nowPlaying?.contextId === contextId;

	return (
		<div className="@container p-3 md:p-6">
			<div className="grid gap-x-6 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				{top && (
					<Section title="Top result">
						<div
							role="button"
							tabIndex={0}
							onClick={() =>
								navigate(
									artist
										? { name: 'artist', mbid: artist.mbid }
										: { name: 'album', hash: albums[0].hash }
								)
							}
							onKeyDown={(e) => {
								if (e.key === 'Enter') e.currentTarget.click();
							}}
							aria-label={`Open ${artist ? artist.name : albums[0].album}`}
							className="group relative flex cursor-pointer flex-col gap-4 rounded-lg bg-white/5 p-5 transition-colors hover:bg-white/10"
						>
							<div className="w-24">
								{artist
									? picture(artist.coverUrl, true, UserRound)
									: picture(albums[0].coverUrl, false, Disc3)}
							</div>
							<div className="min-w-0">
								<p className="truncate text-3xl font-black text-white">
									{artist ? artist.name : albums[0].album}
								</p>
								<p className="mt-1 truncate text-sm text-gray-400">
									<span className="mr-2 rounded-full bg-black/40 px-2 py-0.5 text-xs font-bold text-white">
										{artist ? 'Artist' : (albums[0].primaryType ?? 'Album')}
									</span>
									{artist
										? `${artist.albumCount} ${artist.albumCount === 1 ? 'album' : 'albums'}`
										: albums[0].artist}
								</p>
							</div>
							{!artist && (
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										onPlayAlbum(albums[0]);
									}}
									aria-label={`Play ${albums[0].album}`}
									className="absolute right-4 bottom-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-black shadow-lg transition-transform hover:scale-105 hover:bg-green-400"
								>
									<Play className="h-6 w-6 pl-0.5" fill="currentColor" />
								</button>
							)}
						</div>
					</Section>
				)}

				{songs.length > 0 && (
					<Section
						title="Songs"
						aside={
							songs.length > SONGS_SHOWN && (
								<button
									type="button"
									onClick={() => setShowAllSongs((all) => !all)}
									className="shrink-0 text-sm font-bold text-gray-400 hover:text-white hover:underline"
								>
									{showAllSongs ? 'Show less' : 'Show all'}
								</button>
							)
						}
					>
						<div className="-mx-3 flex flex-col">
							{(showAllSongs ? songs : songs.slice(0, SONGS_SHOWN)).map(
								(item, index) => {
									const liked = user.isLiked(item.track.id);
									const ref = trackRef(item.track, item.album);
									return (
										<TrackListItem
											key={item.track.id}
											track={item.track}
											index={index}
											number={index + 1}
											album={item.album}
											isCurrentTrack={
												playingHere &&
												player.nowPlaying?.item.track.id === item.track.id
											}
											isPlaying={player.isPlaying}
											onPlay={() =>
												player.playContext(songs, index, contextId)
											}
											onMenu={(e) => onTrackMenu(e, item)}
											isLiked={liked}
											onToggleLike={() =>
												liked ? user.unlike(ref) : user.like(ref)
											}
										/>
									);
								}
							)}
						</div>
					</Section>
				)}
			</div>

			{artists.length > 0 && (
				<Section title="Artists">
					<div className={grid}>
						{artists.map((hit) => (
							<button
								key={hit.mbid}
								type="button"
								onClick={() => navigate({ name: 'artist', mbid: hit.mbid })}
								aria-label={`Open ${hit.name}`}
								className="flex min-w-0 flex-col rounded-xl bg-gray-800/40 p-3 text-left transition-colors hover:bg-gray-800/70 sm:p-4"
							>
								{picture(hit.coverUrl, true, UserRound)}
								<span className="mt-3 truncate font-semibold text-white">
									{hit.name}
								</span>
								<span className="text-sm text-gray-400">Artist</span>
							</button>
						))}
					</div>
				</Section>
			)}

			{albums.length > 0 && (
				<Section title="Albums">
					<AlbumCardGrid albums={albums} {...cards} />
				</Section>
			)}
		</div>
	);
}
