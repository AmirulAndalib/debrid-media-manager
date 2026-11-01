import { MusicAlbum } from '@/pages/api/music/library';
import { ArrowDownAZ, Calendar, Clock, Music2, User } from 'lucide-react';
import { MouseEvent } from 'react';
import AlbumCard from './AlbumCard';

type SortOption = 'recent' | 'name' | 'artist' | 'year';

interface AlbumGridProps {
	albums: MusicAlbum[];
	searchQuery: string;
	/** Albums matching the search, shown while one is active. */
	matchCount?: number;
	onSelect: (album: MusicAlbum) => void;
	onPlay: (album: MusicAlbum) => void;
	sortBy: SortOption;
	onSortChange: (sort: SortOption) => void;
	nowPlayingAlbumHash: string | null;
	isPlaying: boolean;
	onCoverLoaded?: (album: MusicAlbum, coverUrl: string) => void;
	onAlbumMenu?: (e: MouseEvent, album: MusicAlbum) => void;
	heading?: string;
}

const sortOptions: { value: SortOption; label: string; icon: typeof Clock }[] = [
	{ value: 'recent', label: 'Recent', icon: Clock },
	{ value: 'name', label: 'Name', icon: ArrowDownAZ },
	{ value: 'artist', label: 'Artist', icon: User },
	{ value: 'year', label: 'Year', icon: Calendar },
];

export default function AlbumGrid({
	albums,
	searchQuery,
	matchCount,
	onSelect,
	onPlay,
	sortBy,
	onSortChange,
	nowPlayingAlbumHash,
	isPlaying,
	onCoverLoaded,
	onAlbumMenu,
	heading = 'Browse',
}: AlbumGridProps) {
	return (
		<div className="p-3 md:p-6">
			<div className="mb-3 flex justify-end md:mb-6 md:items-end md:justify-between">
				<div className="hidden md:block">
					<p className="text-xs font-bold text-gray-400 uppercase">Catalog</p>
					<h2 className="mt-1 text-2xl font-black text-white md:text-4xl">{heading}</h2>
					{matchCount !== undefined && (
						<p className="mt-1 text-sm text-gray-400">
							{matchCount} {matchCount === 1 ? 'album matches' : 'albums match'}
						</p>
					)}
				</div>
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

			{albums.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-20 text-gray-400">
					<Music2 className="mb-4 h-16 w-16" />
					<p className="text-lg">
						{searchQuery ? 'No albums match your search' : 'No music in your library'}
					</p>
					<p className="mt-2 text-sm text-gray-500">
						Add music torrents from your debrid service to see them here
					</p>
				</div>
			) : (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-5">
					{albums.map((album) => (
						<AlbumCard
							key={album.hash}
							album={album}
							onSelect={onSelect}
							onPlay={onPlay}
							isNowPlaying={album.hash === nowPlayingAlbumHash}
							isPlaying={isPlaying}
							onCoverLoaded={onCoverLoaded}
							onMenu={onAlbumMenu}
						/>
					))}
				</div>
			)}
		</div>
	);
}
