import {
	Disc3,
	Heart,
	House,
	Library,
	ListMusic,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	Search,
	UserRound,
} from 'lucide-react';
import { ReactNode, useState } from 'react';
import { musicHref, MusicRoute } from './routes';
import { useMusicUser } from './user/MusicUserProvider';

type Kind = 'playlist' | 'album' | 'artist';

interface Entry {
	key: string;
	kind: Kind;
	name: string;
	subtitle: string;
	coverUrl: string | null;
	/** When it was saved, followed or last changed. */
	at: string;
	route: MusicRoute | null;
}

const kindIcon = { playlist: ListMusic, album: Disc3, artist: UserRound };
const filters: { kind: Kind; label: string }[] = [
	{ kind: 'playlist', label: 'Playlists' },
	{ kind: 'album', label: 'Albums' },
	{ kind: 'artist', label: 'Artists' },
];

interface LibraryPaneProps {
	route: MusicRoute;
	navigate: (route: MusicRoute) => void;
	/** Covers only, as on tablets. */
	collapsed?: boolean;
	onToggleCollapsed?: () => void;
	/** Home, Search and Browse above the library; phones have their tab bar instead. */
	onFocusSearch?: () => void;
}

export default function LibraryPane({
	route,
	navigate,
	collapsed = false,
	onToggleCollapsed,
	onFocusSearch,
}: LibraryPaneProps) {
	const user = useMusicUser();
	const [kind, setKind] = useState<Kind | null>(null);
	const [filter, setFilter] = useState('');
	const [sort, setSort] = useState<'recent' | 'name'>('recent');
	const here = musicHref(route);

	const entries: Entry[] = [
		...user.library.playlists.map((p) => ({
			key: `playlist:${p.id}`,
			kind: 'playlist' as const,
			name: p.name,
			subtitle: `Playlist · ${p.trackCount} ${p.trackCount === 1 ? 'song' : 'songs'}`,
			coverUrl: p.coverUrl,
			at: p.updatedAt,
			route: { name: 'playlist' as const, id: p.id },
		})),
		...user.library.albums.map((a) => ({
			key: `album:${a.mbid}`,
			kind: 'album' as const,
			name: a.album?.album ?? 'Unavailable album',
			subtitle: `Album · ${a.album?.artist ?? 'no longer in the catalog'}`,
			coverUrl: a.album?.coverUrl ?? null,
			at: a.savedAt,
			route: a.album?.hash ? { name: 'album' as const, hash: a.album.hash } : null,
		})),
		...user.library.artists.map((a) => ({
			key: `artist:${a.artistMbid}`,
			kind: 'artist' as const,
			name: a.name ?? 'Unknown artist',
			subtitle: 'Artist',
			coverUrl: null,
			at: a.followedAt,
			route: { name: 'artist' as const, mbid: a.artistMbid },
		})),
	];
	const needle = filter.trim().toLowerCase();
	const shown = entries
		.filter(
			(e) => (!kind || e.kind === kind) && (!needle || e.name.toLowerCase().includes(needle))
		)
		.sort((a, b) =>
			sort === 'name' ? a.name.localeCompare(b.name) : b.at.localeCompare(a.at)
		);

	const createPlaylist = async () => {
		const created = await user.createPlaylist();
		if (created) navigate({ name: 'playlist', id: created.id });
	};

	const row = (
		key: string,
		name: string,
		subtitle: string,
		cover: ReactNode,
		to: MusicRoute | null
	) => {
		const current = to !== null && musicHref(to) === here;
		return (
			<button
				key={key}
				type="button"
				disabled={!to}
				onClick={() => to && navigate(to)}
				aria-current={current ? 'page' : undefined}
				aria-label={collapsed ? name : undefined}
				title={collapsed ? name : undefined}
				className={`flex w-full min-w-0 items-center gap-3 rounded-md p-2 text-left transition-colors disabled:opacity-50 ${
					current
						? 'bg-white/10 text-white'
						: 'text-gray-300 hover:bg-white/5 hover:text-white'
				} ${collapsed ? 'justify-center' : ''}`}
			>
				{cover}
				{!collapsed && (
					<span className="min-w-0">
						<span className="block truncate text-sm font-medium">{name}</span>
						<span className="block truncate text-xs text-gray-400">{subtitle}</span>
					</span>
				)}
			</button>
		);
	};

	const coverOf = (entry: Entry) => {
		const Icon = kindIcon[entry.kind];
		return (
			<span
				className={`relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden bg-gray-800 ${
					entry.kind === 'artist' ? 'rounded-full' : 'rounded'
				}`}
			>
				<Icon className="h-5 w-5 text-gray-500" />
				{entry.coverUrl && (
					// oxlint-disable-next-line nextjs/no-img-element
					<img
						src={entry.coverUrl}
						alt=""
						loading="lazy"
						className="absolute inset-0 h-full w-full object-cover"
						onError={(e) => {
							(e.target as HTMLImageElement).style.display = 'none';
						}}
					/>
				)}
			</span>
		);
	};

	const navItem = (label: string, Icon: typeof House, onClick: () => void, active: boolean) => (
		<button
			type="button"
			onClick={onClick}
			aria-current={active ? 'page' : undefined}
			aria-label={collapsed ? label : undefined}
			title={collapsed ? label : undefined}
			className={`flex w-full items-center gap-4 rounded-md px-3 py-2 text-sm font-bold transition-colors ${
				active ? 'text-white' : 'text-gray-400 hover:text-white'
			} ${collapsed ? 'justify-center' : ''}`}
		>
			<Icon className="h-6 w-6 shrink-0" />
			{!collapsed && label}
		</button>
	);

	const chip = (active: boolean) =>
		`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
			active ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
		}`;

	return (
		<div className="flex h-full min-h-0 flex-col gap-2">
			{onFocusSearch && (
				<nav className="rounded-lg bg-black/25 p-2" aria-label="Music">
					{navItem(
						'Home',
						House,
						() => navigate({ name: 'home' }),
						route.name === 'home'
					)}
					{navItem('Search', Search, onFocusSearch, route.name === 'search')}
					{navItem(
						'Browse',
						Disc3,
						() => navigate({ name: 'browse' }),
						route.name === 'browse'
					)}
				</nav>
			)}

			<section
				className="flex min-h-0 flex-1 flex-col rounded-lg bg-black/25"
				aria-label="Your Library"
			>
				<div
					className={`flex items-center gap-2 px-4 pt-3 pb-2 ${collapsed ? 'flex-col px-2' : ''}`}
				>
					{onToggleCollapsed ? (
						<button
							type="button"
							onClick={onToggleCollapsed}
							className="flex min-w-0 items-center gap-3 text-sm font-bold text-gray-300 transition-colors hover:text-white"
							aria-label={collapsed ? 'Expand Your Library' : 'Collapse Your Library'}
							title={collapsed ? 'Expand Your Library' : 'Collapse Your Library'}
						>
							{collapsed ? (
								<PanelLeftOpen className="h-6 w-6 shrink-0" />
							) : (
								<PanelLeftClose className="h-6 w-6 shrink-0" />
							)}
							{!collapsed && <span className="truncate">Your Library</span>}
						</button>
					) : (
						<span
							className="flex min-w-0 items-center gap-3 text-sm font-bold text-gray-300"
							title="Your Library"
						>
							<Library className="h-6 w-6 shrink-0" />
							{!collapsed && <span className="truncate">Your Library</span>}
						</span>
					)}
					<button
						type="button"
						onClick={() => void createPlaylist()}
						className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white/10 hover:text-white ${collapsed ? '' : 'ml-auto'}`}
						aria-label="Create playlist"
						title="Create playlist"
					>
						<Plus className="h-5 w-5" />
					</button>
				</div>

				{!collapsed && (
					<div className="flex flex-col gap-2 px-4 pb-2">
						<div className="flex gap-2 overflow-x-auto">
							{filters.map((f) => (
								<button
									key={f.kind}
									type="button"
									onClick={() => setKind(kind === f.kind ? null : f.kind)}
									aria-pressed={kind === f.kind}
									className={chip(kind === f.kind)}
								>
									{f.label}
								</button>
							))}
						</div>
						<div className="flex items-center gap-2">
							<input
								type="search"
								value={filter}
								onChange={(e) => setFilter(e.target.value)}
								placeholder="Search in Your Library"
								aria-label="Search in Your Library"
								className="min-w-0 flex-1 rounded-md bg-white/5 px-3 py-1.5 text-sm placeholder-gray-500 outline-hidden focus:bg-white/10"
							/>
							<button
								type="button"
								onClick={() => setSort(sort === 'recent' ? 'name' : 'recent')}
								className="shrink-0 text-xs text-gray-400 transition-colors hover:text-white"
								title="Change the order"
							>
								{sort === 'recent' ? 'Recents' : 'Alphabetical'}
							</button>
						</div>
					</div>
				)}

				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
					{row(
						'liked',
						'Liked Songs',
						`Playlist · ${user.likedIds.size} ${user.likedIds.size === 1 ? 'song' : 'songs'}`,
						<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gradient-to-br from-green-600 to-gray-900">
							<Heart className="h-5 w-5 text-white" fill="currentColor" />
						</span>,
						{ name: 'liked' }
					)}
					{shown.map((entry) =>
						row(entry.key, entry.name, entry.subtitle, coverOf(entry), entry.route)
					)}
					{!collapsed && user.ready && entries.length === 0 && (
						<div className="mt-2 rounded-lg bg-white/5 p-4 text-sm">
							{user.userId ? (
								<>
									<p className="font-bold text-white">Make this music yours</p>
									<p className="mt-1 text-gray-400">
										Save albums with their heart, like songs and build
										playlists. They all wait for you here.
									</p>
									<button
										type="button"
										onClick={() => navigate({ name: 'browse' })}
										className="mt-3 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black transition-transform hover:scale-105"
									>
										Browse the catalog
									</button>
								</>
							) : (
								<p className="text-gray-400">
									Your library could not load. Reload the page to try again.
								</p>
							)}
						</div>
					)}
					{!collapsed && needle && entries.length > 0 && shown.length === 0 && (
						<p className="p-4 text-sm text-gray-400">
							Nothing in Your Library matches.
						</p>
					)}
				</div>
			</section>
		</div>
	);
}
