import { MusicAlbum } from '@/pages/api/music/library';
import { ArrowDownAZ, Calendar, Clock, Music2, User } from 'lucide-react';
import { MouseEvent } from 'react';
import AlbumCard from './AlbumCard';

type SortOption = 'recent' | 'name' | 'artist' | 'year';
export type AlbumTypeFilter = 'all' | 'album' | 'ep' | 'single' | 'compilation';

interface AlbumCardGridProps {
	albums: MusicAlbum[];
	onSelect: (album: MusicAlbum) => void;
	onPlay: (album: MusicAlbum) => void;
	nowPlayingAlbumHash: string | null;
	isPlaying: boolean;
	onCoverLoaded?: (album: MusicAlbum, coverUrl: string) => void;
	onAlbumMenu?: (e: MouseEvent, album: MusicAlbum) => void;
}

interface AlbumGridProps extends AlbumCardGridProps {
	sortBy: SortOption;
	onSortChange: (sort: SortOption) => void;
	type?: AlbumTypeFilter;
	onTypeChange?: (type: AlbumTypeFilter) => void;
}

const sortOptions: { value: SortOption; label: string; icon: typeof Clock }[] = [
	{ value: 'recent', label: 'Recent', icon: Clock },
	{ value: 'name', label: 'Name', icon: ArrowDownAZ },
	{ value: 'artist', label: 'Artist', icon: User },
	{ value: 'year', label: 'Year', icon: Calendar },
];

const typeOptions: [AlbumTypeFilter, string][] = [
	['album', 'Albums'],
	['ep', 'EPs'],
	['single', 'Singles'],
	['compilation', 'Compilations'],
	['all', 'All'],
];

/** Whether MusicBrainz files the album under `type`. */
export const isAlbumType = (album: MusicAlbum, type: AlbumTypeFilter) =>
	type === 'all' || album.primaryType?.toLowerCase() === type;

/**
 * Release-type chips: every type, or only those `albums` hold. None while no
 * album has a type, as before the MusicBrainz backfill, unless one is chosen.
 */
export function TypeChips({
	albums,
	value,
	onChange,
	every = false,
}: {
	albums: MusicAlbum[];
	value: AlbumTypeFilter;
	onChange: (type: AlbumTypeFilter) => void;
	every?: boolean;
}) {
	if (value === 'all' && !albums.some((album) => album.primaryType)) return null;
	const shown = typeOptions.filter(
		([type]) => every || type === 'all' || albums.some((album) => isAlbumType(album, type))
	);
	return (
		<div role="group" aria-label="Release type" className="flex flex-wrap gap-2">
			{shown.map(([type, label]) => (
				<button
					key={type}
					type="button"
					onClick={() => onChange(type)}
					aria-pressed={value === type}
					className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
						value === type
							? 'bg-white text-black'
							: 'bg-white/10 text-white hover:bg-white/20'
					}`}
				>
					{label}
				</button>
			))}
		</div>
	);
}

/** Album cards, as many columns as fit. */
export function AlbumCardGrid({
	albums,
	nowPlayingAlbumHash,
	onAlbumMenu,
	...card
}: AlbumCardGridProps) {
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-5">
			{albums.map((album) => (
				<AlbumCard
					key={album.hash}
					album={album}
					isNowPlaying={album.hash === nowPlayingAlbumHash}
					onMenu={onAlbumMenu}
					{...card}
				/>
			))}
		</div>
	);
}

export default function AlbumGrid({
	albums,
	sortBy,
	onSortChange,
	type = 'all',
	onTypeChange,
	...cards
}: AlbumGridProps) {
	return (
		<div className="p-3 md:p-6">
			<div className="mb-3 flex flex-wrap items-center justify-end gap-2 md:mb-6 md:items-end md:justify-between">
				<div className="hidden md:block">
					<p className="text-xs font-bold text-gray-400 uppercase">Catalog</p>
					<h2 className="mt-1 text-2xl font-black text-white md:text-4xl">Browse</h2>
				</div>
				<div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
					{onTypeChange && (
						<TypeChips albums={albums} value={type} onChange={onTypeChange} every />
					)}
					<div className="flex items-center gap-1">
						{sortOptions.map(({ value, label, icon: Icon }) => (
							<button
								key={value}
								type="button"
								onClick={() => onSortChange(value)}
								aria-pressed={sortBy === value}
								className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
									sortBy === value
										? 'bg-green-500/20 text-green-500'
										: 'text-gray-400 hover:bg-white/5 hover:text-white'
								}`}
								title={`Sort by ${label}`}
							>
								<Icon className="h-3.5 w-3.5" />
								<span className="hidden sm:inline">{label}</span>
							</button>
						))}
					</div>
				</div>
			</div>

			{albums.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-20 text-gray-400">
					<Music2 className="mb-4 h-16 w-16" />
					<p className="text-lg">
						{type === 'all'
							? 'No music in the catalog yet'
							: 'No albums of this type yet'}
					</p>
					<p className="mt-2 text-sm text-gray-500">
						The catalog holds albums cached on Real-Debrid
					</p>
				</div>
			) : (
				<AlbumCardGrid albums={albums} {...cards} />
			)}
		</div>
	);
}
