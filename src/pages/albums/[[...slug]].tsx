import AlbumDetailView from '@/components/music/AlbumDetailView';
import AlbumGrid from '@/components/music/AlbumGrid';
import KeyboardShortcutsModal from '@/components/music/KeyboardShortcutsModal';
import MusicPlayerBar from '@/components/music/MusicPlayerBar';
import { MusicPlayerProvider, useMusicPlayer } from '@/components/music/player/MusicPlayerProvider';
import { localStoragePersistence } from '@/components/music/player/persistence';
import QueuePanel from '@/components/music/QueuePanel';
import { musicHref, MusicRoute, parseMusicRoute } from '@/components/music/routes';
import { QueuedTrack } from '@/components/music/types';
import { trackTitle } from '@/components/music/utils';
import { useRealDebridAccessToken } from '@/hooks/auth';
import { MusicAlbum, MusicLibraryResponse, MusicTrack } from '@/pages/api/music/library';
import { UnrestrictTrackResponse } from '@/pages/api/music/unrestrict';
import { Keyboard, Library, Loader2, Music2, X } from 'lucide-react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MUSIC_PAGE_SIZE = 48;
const RECENT_ALBUM_LIMIT = 24;
const ALBUM_DOWNLOAD_DELAY_MS = 250;

async function unrestrictTrack(
	track: MusicTrack,
	accessToken: string | null
): Promise<string | undefined> {
	if (!accessToken) return undefined;

	try {
		const response = await fetch('/api/music/unrestrict', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				link: track.link,
				hash: track.hash,
				fileId: track.fileId,
				accessToken,
			}),
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			console.error('Unrestrict failed:', {
				status: response.status,
				error: errorData.error,
				errorCode: errorData.errorCode,
				hash: track.hash,
				fileId: track.fileId,
			});
			throw new Error(errorData.error || 'Failed to unrestrict');
		}

		const data: UnrestrictTrackResponse = await response.json();
		return data.streamUrl;
	} catch (err) {
		console.error('Failed to unrestrict track:', err);
		return undefined;
	}
}

// Library and search results are summaries without tracks; this request has them.
async function fetchAlbum(hash: string): Promise<MusicAlbum | null> {
	const response = await fetch(`/api/music/library?hash=${encodeURIComponent(hash)}`);
	if (!response.ok) throw new Error('Failed to fetch album');
	const data: MusicLibraryResponse = await response.json();
	return data.albums[0] ?? null;
}

const albumItems = (album: MusicAlbum): QueuedTrack[] =>
	album.tracks.map((track) => ({ track, album }));

interface SidebarAlbumButtonProps {
	album: MusicAlbum;
	isSelected: boolean;
	onSelect: (album: MusicAlbum) => void;
	onCoverLoaded: (album: MusicAlbum, coverUrl: string) => void;
}

function SidebarAlbumButton({
	album,
	isSelected,
	onSelect,
	onCoverLoaded,
}: SidebarAlbumButtonProps) {
	const [coverUrl, setCoverUrl] = useState(album.coverUrl);

	useEffect(() => {
		setCoverUrl(album.coverUrl);
	}, [album.coverUrl]);

	useEffect(() => {
		if (coverUrl) return;
		let isCancelled = false;

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
					onCoverLoaded(album, data.coverUrl);
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

	return (
		<button
			type="button"
			onClick={() => onSelect(album)}
			aria-current={isSelected ? 'true' : undefined}
			aria-label={`Open ${album.album} by ${album.artist}`}
			className={`flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
				isSelected
					? 'bg-white/10 text-white'
					: 'text-gray-300 hover:bg-white/5 hover:text-white'
			}`}
		>
			<div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-800">
				<Music2 className="h-4 w-4 text-gray-500" />
				{coverUrl && (
					// oxlint-disable-next-line nextjs/no-img-element
					<img
						src={coverUrl}
						alt={album.album}
						loading="lazy"
						className="absolute inset-0 h-full w-full object-cover"
						onError={(e) => {
							(e.target as HTMLImageElement).style.display = 'none';
						}}
					/>
				)}
			</div>
			<div className="min-w-0">
				<p className="truncate text-sm font-medium">{album.album}</p>
				<p className="truncate text-xs text-gray-400">{album.artist}</p>
			</div>
		</button>
	);
}

export default function AlbumsPage() {
	const router = useRouter();
	const [accessToken, isLoading] = useRealDebridAccessToken();
	const resolveStreamUrl = useCallback(
		(track: MusicTrack) => unrestrictTrack(track, accessToken),
		[accessToken]
	);

	// Redirect if not authenticated
	if (!isLoading && !accessToken) {
		router.push('/realdebrid/login?redirect=/music');
		return null;
	}

	return (
		<MusicPlayerProvider
			resolveStreamUrl={resolveStreamUrl}
			persistence={localStoragePersistence}
		>
			<MusicLibrary resolveStreamUrl={resolveStreamUrl} />
		</MusicPlayerProvider>
	);
}

AlbumsPage.disableLibraryProvider = true;

function MusicLibrary({
	resolveStreamUrl,
}: {
	resolveStreamUrl: (track: MusicTrack) => Promise<string | undefined>;
}) {
	const router = useRouter();
	const player = useMusicPlayer();
	const currentTrack = player.nowPlaying?.item ?? null;

	// Library state
	const [library, setLibrary] = useState<MusicLibraryResponse | null>(null);
	const [libraryLoading, setLibraryLoading] = useState(true);
	const [libraryLoadingMore, setLibraryLoadingMore] = useState(false);
	const [libraryError, setLibraryError] = useState<string | null>(null);
	const [recentAlbums, setRecentAlbums] = useState<MusicAlbum[]>([]);
	// From the unfiltered recent-albums request, so a search never changes them.
	const [catalogTotals, setCatalogTotals] = useState<Pick<
		MusicLibraryResponse,
		'totalAlbums' | 'totalTracks'
	> | null>(null);

	// View state
	const [isQueueOpen, setIsQueueOpen] = useState(false);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [sortBy, setSortBy] = useState<'recent' | 'name' | 'artist' | 'year'>('name');

	const route = parseMusicRoute(router.query.slug, router.query.q);
	const albumHash = route.name === 'album' ? route.hash : undefined;
	const catalogSearch = route.name === 'search' ? route.q : '';
	const showsGrid = route.name !== 'album';
	const selectedAlbumSummary = library?.albums.find((a) => a.hash === albumHash) ?? null;
	const [selectedAlbumDetail, setSelectedAlbumDetail] = useState<MusicAlbum | null>(null);
	const [selectedAlbumLoading, setSelectedAlbumLoading] = useState(false);
	const selectedAlbum =
		albumHash && selectedAlbumDetail?.hash === albumHash
			? selectedAlbumDetail
			: selectedAlbumSummary;

	// Scroll container ref, and each page's scroll offset for back and forward
	const mainRef = useRef<HTMLElement | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const scrollByPath = useRef(new Map<string, number>());
	const pushed = useRef(false);
	const libraryRequestId = useRef<number>(0);
	const loadedCatalogKey = useRef<string | null>(null);
	const recentAlbumsRequestId = useRef<number>(0);

	const navigate = useCallback(
		(to: MusicRoute, replace = false) => {
			pushed.current = true;
			void router[replace ? 'replace' : 'push'](musicHref(to), undefined, { shallow: true });
		},
		[router]
	);

	// The old album URL was /music/<hash>.
	const slugLength = Array.isArray(router.query.slug) ? router.query.slug.length : 0;
	useEffect(() => {
		if (slugLength === 1 && albumHash) navigate({ name: 'album', hash: albumHash }, true);
	}, [albumHash, navigate, slugLength]);

	// A new page starts at the top; back and forward return to where it was left.
	useEffect(() => {
		const main = mainRef.current;
		if (!main) return;
		const top = pushed.current ? 0 : (scrollByPath.current.get(router.asPath) ?? 0);
		pushed.current = false;
		const timeout = setTimeout(() => (main.scrollTop = top), 0);
		return () => clearTimeout(timeout);
	}, [router.asPath]);

	// The search box navigates as you type; back and forward bring its text along.
	const searchInput = useRef<HTMLInputElement | null>(null);
	const [searchText, setSearchText] = useState(catalogSearch);
	useEffect(() => {
		if (route.name === 'search' && document.activeElement !== searchInput.current) {
			setSearchText(route.q);
		}
	}, [route.name, catalogSearch]); // eslint-disable-line react-hooks/exhaustive-deps
	const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
	const search = (q: string) => {
		setSearchText(q);
		clearTimeout(searchTimeout.current);
		const replace = route.name === 'search';
		searchTimeout.current = setTimeout(() => navigate({ name: 'search', q }, replace), 250);
	};
	useEffect(() => () => clearTimeout(searchTimeout.current), []);
	const registerSearchInput = useCallback(
		(input: HTMLInputElement | null) => {
			searchInput.current = input;
			player.registerSearchInput(input);
		},
		[player.registerSearchInput] // eslint-disable-line react-hooks/exhaustive-deps
	);

	const selectAlbum = (album: MusicAlbum) => navigate({ name: 'album', hash: album.hash });

	const handleCoverLoaded = useCallback((album: MusicAlbum, coverUrl: string) => {
		setLibrary((prev) =>
			prev
				? {
						...prev,
						albums: prev.albums.map((existing) =>
							existing.mbid === album.mbid ? { ...existing, coverUrl } : existing
						),
					}
				: prev
		);
		setRecentAlbums((prev) =>
			prev.map((existing) =>
				existing.mbid === album.mbid ? { ...existing, coverUrl } : existing
			)
		);
		setSelectedAlbumDetail((prev) =>
			prev?.mbid === album.mbid ? { ...prev, coverUrl } : prev
		);
	}, []);

	const fetchLibraryPage = useCallback(
		async (pageToLoad: number = 1, append: boolean = false) => {
			const requestId = ++libraryRequestId.current;
			try {
				setLibraryError(null);
				if (append) {
					setLibraryLoadingMore(true);
				} else {
					setLibraryLoading(true);
				}
				const params = new URLSearchParams({
					summary: '1',
					page: String(pageToLoad),
					limit: String(MUSIC_PAGE_SIZE),
					sortBy,
				});
				const trimmedSearch = catalogSearch.trim();
				if (trimmedSearch) params.set('search', trimmedSearch);

				const response = await fetch(`/api/music/library?${params.toString()}`);
				if (!response.ok) throw new Error('Failed to fetch library');
				const data: MusicLibraryResponse = await response.json();
				if (requestId !== libraryRequestId.current) return;

				setLibrary((prev) => {
					if (!append || !prev) return data;
					const existingHashes = new Set(prev.albums.map((album) => album.hash));
					const nextAlbums = data.albums.filter(
						(album) => !existingHashes.has(album.hash)
					);
					return {
						...data,
						albums: [...prev.albums, ...nextAlbums],
					};
				});
			} catch (err) {
				if (requestId === libraryRequestId.current) {
					setLibraryError(err instanceof Error ? err.message : 'Failed to load library');
				}
			} finally {
				if (requestId === libraryRequestId.current) {
					setLibraryLoading(false);
					setLibraryLoadingMore(false);
				}
			}
		},
		[catalogSearch, sortBy]
	);

	const fetchRecentAlbums = useCallback(async () => {
		const requestId = ++recentAlbumsRequestId.current;
		try {
			const params = new URLSearchParams({
				summary: '1',
				page: '1',
				limit: String(RECENT_ALBUM_LIMIT),
				sortBy: 'recent',
			});
			const response = await fetch(`/api/music/library?${params.toString()}`);
			if (!response.ok) throw new Error('Failed to fetch recent albums');
			const data: MusicLibraryResponse = await response.json();
			if (requestId === recentAlbumsRequestId.current) {
				setRecentAlbums(data.albums);
				setCatalogTotals({ totalAlbums: data.totalAlbums, totalTracks: data.totalTracks });
			}
		} catch (err) {
			console.error('Failed to fetch recent albums:', err);
		}
	}, []);

	// Kept while another page shows, so coming back keeps the loaded pages and the scroll.
	useEffect(() => {
		const key = `${catalogSearch.trim()}\n${sortBy}`;
		if (!showsGrid || key === loadedCatalogKey.current) return;
		loadedCatalogKey.current = key;
		fetchLibraryPage(1, false);
	}, [catalogSearch, fetchLibraryPage, showsGrid, sortBy]);

	useEffect(() => {
		fetchRecentAlbums();
	}, [fetchRecentAlbums]);

	useEffect(() => {
		if (
			!showsGrid ||
			!library?.hasMore ||
			libraryLoading ||
			libraryLoadingMore ||
			!loadMoreRef.current
		) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting) && library.hasMore) {
					fetchLibraryPage(library.nextPage ?? (library.page ?? 1) + 1, true);
				}
			},
			{ rootMargin: '600px' }
		);
		observer.observe(loadMoreRef.current);
		return () => observer.disconnect();
	}, [
		showsGrid,
		fetchLibraryPage,
		library?.hasMore,
		library?.nextPage,
		library?.page,
		libraryLoading,
		libraryLoadingMore,
	]);

	useEffect(() => {
		if (!albumHash) {
			setSelectedAlbumDetail(null);
			setSelectedAlbumLoading(false);
			return;
		}

		let isCancelled = false;
		const activeAlbumHash = albumHash;

		async function fetchAlbumDetail() {
			try {
				setSelectedAlbumLoading(true);
				const album = await fetchAlbum(activeAlbumHash);
				if (!isCancelled) {
					setSelectedAlbumDetail(album);
					if (album) {
						setLibrary((prev) =>
							prev
								? {
										...prev,
										albums: prev.albums.map((existing) =>
											existing.hash === album.hash ? album : existing
										),
									}
								: prev
						);
					}
				}
			} catch (err) {
				console.error('Failed to fetch album detail:', err);
				if (!isCancelled) setSelectedAlbumDetail(null);
			} finally {
				if (!isCancelled) setSelectedAlbumLoading(false);
			}
		}

		fetchAlbumDetail();

		return () => {
			isCancelled = true;
		};
	}, [albumHash]);

	// UI shortcuts; the player provider handles the playback ones.
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement).tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

			switch (e.key) {
				case 'q':
				case 'Q':
					setIsQueueOpen((prev) => !prev);
					break;
				case '?':
					setShowShortcuts((prev) => !prev);
					break;
				case 'F1':
					e.preventDefault();
					setShowShortcuts((prev) => !prev);
					break;
				case 'Escape':
					setShowShortcuts(false);
					break;
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, []);

	const playAlbum = async (album: MusicAlbum, startIndex: number = 0) => {
		try {
			const full = album.tracks.length ? album : await fetchAlbum(album.hash);
			if (full) player.playContext(albumItems(full), startIndex, `album:${full.hash}`);
		} catch (err) {
			console.error('Failed to play album:', err);
		}
	};

	// Download a track
	const triggerBrowserDownload = (streamUrl: string, filename: string) => {
		const a = document.createElement('a');
		a.href = streamUrl;
		a.download = filename;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};

	const downloadTrack = async (track: MusicTrack) => {
		const streamUrl = await resolveStreamUrl(track);
		if (!streamUrl) return;
		triggerBrowserDownload(streamUrl, track.filename);
	};

	const downloadAlbum = async (album: MusicAlbum) => {
		for (const track of album.tracks) {
			const streamUrl = await resolveStreamUrl(track);
			if (!streamUrl) continue;
			triggerBrowserDownload(streamUrl, track.filename);
			await new Promise((resolve) => setTimeout(resolve, ALBUM_DOWNLOAD_DELAY_MS));
		}
	};

	const visibleAlbums = library?.albums ?? [];
	const sidebarAlbums = useMemo(() => recentAlbums.slice(0, RECENT_ALBUM_LIMIT), [recentAlbums]);

	const spinner = (
		<div className="flex h-full items-center justify-center">
			<Loader2 className="h-8 w-8 animate-spin text-green-500" />
		</div>
	);

	const grid = libraryLoading ? (
		spinner
	) : libraryError ? (
		<div className="flex h-full items-center justify-center text-red-400">{libraryError}</div>
	) : (
		<>
			<AlbumGrid
				albums={visibleAlbums}
				searchQuery={catalogSearch}
				matchCount={catalogSearch.trim() ? library?.totalAlbums : undefined}
				onSelect={selectAlbum}
				onPlay={playAlbum}
				sortBy={sortBy}
				onSortChange={setSortBy}
				nowPlayingAlbumHash={currentTrack?.album.hash ?? null}
				isPlaying={player.isPlaying}
				onCoverLoaded={handleCoverLoaded}
			/>
			<div
				ref={loadMoreRef}
				className="flex min-h-20 items-center justify-center pb-8 text-sm text-gray-400"
			>
				{libraryLoadingMore ? (
					<Loader2 className="h-5 w-5 animate-spin text-green-500" />
				) : library?.hasMore ? (
					<span>Loading more albums...</span>
				) : visibleAlbums.length > 0 ? (
					<span>End of library</span>
				) : null}
			</div>
		</>
	);

	let content: ReactNode;
	switch (route.name) {
		case 'album':
			content =
				selectedAlbum && selectedAlbum.tracks.length > 0 ? (
					<AlbumDetailView
						album={selectedAlbum}
						currentTrack={currentTrack}
						playerState={player}
						onPlay={playAlbum}
						onAddToQueue={(album) => player.addToQueue(albumItems(album))}
						onPlayNext={(album) => player.playNext(albumItems(album))}
						onPlayTrackNext={(track, album) => player.playNext([{ track, album }])}
						onBack={() => navigate({ name: 'browse' })}
						onDownload={downloadTrack}
						onDownloadAlbum={downloadAlbum}
						onCoverLoaded={handleCoverLoaded}
					/>
				) : selectedAlbumLoading ? (
					spinner
				) : (
					<div className="flex h-full items-center justify-center text-gray-400">
						This album is not in the catalog.
					</div>
				);
			break;
		case 'artist':
			content = (
				<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-gray-400">
					<p className="text-lg font-bold text-white">Artist pages are coming</p>
					<button
						type="button"
						onClick={() => navigate({ name: 'browse' })}
						className="text-sm text-green-500 hover:underline"
					>
						Browse the catalog
					</button>
				</div>
			);
			break;
		default:
			content = grid;
	}

	return (
		<>
			<Head>
				<title>
					{currentTrack && player.isPlaying
						? `${trackTitle(currentTrack.track)} - ${currentTrack.album.artist} - DMM`
						: selectedAlbum
							? `${selectedAlbum.album} - ${selectedAlbum.artist} - DMM`
							: 'Music - DMM'}
				</title>
			</Head>

			<div className="flex h-screen flex-col bg-gradient-to-b from-gray-900 via-gray-900 to-black text-white">
				{/* Header */}
				<header className="flex flex-col gap-3 border-b border-white/5 bg-black/30 px-4 py-3 backdrop-blur-md md:flex-row md:items-center md:justify-between md:px-6 md:py-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Music2 className="h-5 w-5 text-green-500 md:h-6 md:w-6" />
							<h1 className="text-lg font-bold md:text-xl">Music</h1>
						</div>
						{/* Stats + shortcuts - mobile */}
						<div className="flex items-center gap-2 md:hidden">
							{catalogTotals && (
								<span className="text-xs text-gray-400">
									{catalogTotals.totalAlbums} albums &middot;{' '}
									{catalogTotals.totalTracks} tracks
								</span>
							)}
							<button
								type="button"
								onClick={() => setShowShortcuts(true)}
								className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs text-gray-400"
								aria-label="Keyboard shortcuts"
								title="Keyboard shortcuts"
							>
								?
							</button>
						</div>
					</div>

					{/* Search */}
					<div className="relative w-full md:w-96">
						<input
							ref={registerSearchInput}
							type="text"
							placeholder="Search artists or albums..."
							value={searchText}
							onChange={(e) => search(e.target.value)}
							aria-label="Search artists or albums"
							className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 pr-9 text-sm placeholder-gray-400 outline-hidden backdrop-blur-sm transition-all duration-200 focus:border-green-500/50 focus:bg-white/10 focus:ring-1 focus:ring-green-500/30"
						/>
						{searchText && (
							<button
								type="button"
								onClick={() => search('')}
								className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-0.5 text-gray-400 transition-colors hover:text-white"
								aria-label="Clear search"
								title="Clear search"
							>
								<X className="h-4 w-4" />
							</button>
						)}
					</div>

					{/* Stats + shortcuts button - desktop */}
					<div className="hidden items-center gap-3 md:flex">
						{catalogTotals && (
							<div className="flex items-center gap-2 text-sm text-gray-400">
								<Library className="h-4 w-4" />
								<span>
									{catalogTotals.totalAlbums} albums &middot;{' '}
									{catalogTotals.totalTracks} tracks
								</span>
							</div>
						)}
						<button
							type="button"
							onClick={() => setShowShortcuts(true)}
							className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-400 transition-all duration-200 hover:border-white/20 hover:bg-white/10 hover:text-white"
							aria-label="Keyboard shortcuts"
							title="Keyboard shortcuts (?)"
						>
							<Keyboard className="h-3.5 w-3.5" />
							<span>?</span>
						</button>
					</div>
				</header>

				<div className="flex min-h-0 flex-1">
					<aside className="hidden w-72 flex-col border-r border-white/5 bg-black/25 lg:flex">
						<div className="border-b border-white/5 p-4">
							<button
								type="button"
								onClick={() => navigate({ name: 'home' })}
								aria-current={!albumHash ? 'page' : undefined}
								className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-bold transition-colors ${
									albumHash
										? 'text-gray-300 hover:bg-white/5 hover:text-white'
										: 'bg-white/10 text-white'
								}`}
							>
								<Library className="h-4 w-4" />
								Your Library
							</button>
						</div>
						{/* The floating player bar sits over the bottom of this list. */}
						<div
							className={`min-h-0 flex-1 overflow-y-auto p-2 ${currentTrack ? 'pb-32' : ''}`}
						>
							<p className="px-3 py-2 text-xs font-bold text-gray-400 uppercase">
								Recently added
							</p>
							{sidebarAlbums.map((album) => (
								<SidebarAlbumButton
									key={album.hash}
									album={album}
									isSelected={album.hash === albumHash}
									onSelect={selectAlbum}
									onCoverLoaded={handleCoverLoaded}
								/>
							))}
						</div>
					</aside>

					{/* Main content */}
					<main
						ref={mainRef}
						onScroll={(e) =>
							scrollByPath.current.set(router.asPath, e.currentTarget.scrollTop)
						}
						className="flex-1 overflow-y-auto pb-24 md:pb-32"
					>
						{content}
					</main>
				</div>

				{/* Queue Panel */}
				{currentTrack && isQueueOpen && (
					<QueuePanel
						nowPlaying={currentTrack}
						upNext={player.upNext}
						isPlaying={player.isPlaying}
						onPlayTrack={player.playAt}
						onClose={() => setIsQueueOpen(false)}
						onDownload={downloadTrack}
						onRemoveTrack={player.removeAt}
						onClearQueue={() => {
							player.clearQueue();
							setIsQueueOpen(false);
						}}
					/>
				)}

				{/* Floating Player Bar */}
				{currentTrack && (
					<MusicPlayerBar
						currentTrack={currentTrack}
						playerState={player}
						onTogglePlay={player.togglePlay}
						onSkipNext={player.next}
						onSkipPrev={player.prev}
						onToggleShuffle={player.toggleShuffle}
						onToggleRepeat={player.cycleRepeat}
						onSeek={player.seek}
						onVolumeChange={player.setVolume}
						onToggleMute={player.toggleMute}
						onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
						isQueueOpen={isQueueOpen}
					/>
				)}
			</div>

			{showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
		</>
	);
}
