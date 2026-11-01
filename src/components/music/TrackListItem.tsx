import { MusicAlbum, MusicTrack } from '@/pages/api/music/library';
import { Download, Ellipsis, Heart, ListEnd, Loader2, LucideIcon, Play, X } from 'lucide-react';
import { MouseEvent, useState } from 'react';
import { PlayableTrack } from './types';
import { formatDuration, formatSize, trackTitle } from './utils';

interface TrackListItemProps {
	track: PlayableTrack;
	index: number;
	album: MusicAlbum;
	isCurrentTrack: boolean;
	isPlaying: boolean;
	onPlay: () => void;
	/** A download button on the row; without it the row's menu holds the download. */
	onDownload?: (track: MusicTrack) => Promise<void>;
	onRemove?: () => void;
	showRemove?: boolean;
	removeLabel?: string;
	onPlayNext?: (track: MusicTrack, album: MusicAlbum) => void;
	/** Opens the track's context menu, from a right-click or the "..." button. */
	onMenu?: (e: MouseEvent) => void;
	isLiked?: boolean;
	onToggleLike?: () => void;
	/** The album's artist under the title: an album's own page leaves it out. */
	showArtist?: boolean;
	/** The # column: the track's own number unless the list ranks it. */
	number?: number;
}

export default function TrackListItem({
	track,
	index,
	album,
	isCurrentTrack,
	isPlaying,
	onPlay,
	onDownload,
	onRemove,
	showRemove = false,
	removeLabel = 'Remove from queue',
	onPlayNext,
	onMenu,
	isLiked = false,
	onToggleLike,
	showArtist = true,
	number,
}: TrackListItemProps) {
	const [isDownloading, setIsDownloading] = useState(false);

	// Phones show the menu, which holds these, rather than a row of small buttons.
	const wideOnly = onMenu ? 'hidden sm:flex' : 'flex';

	const handleDownload = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (isDownloading || !onDownload) return;
		setIsDownloading(true);
		try {
			await onDownload(track);
		} finally {
			setIsDownloading(false);
		}
	};

	return (
		<button
			type="button"
			onClick={onPlay}
			onContextMenu={onMenu}
			aria-label={`Play ${trackTitle(track)} by ${album.artist}`}
			className={`group grid w-full grid-cols-[32px_1fr_auto_auto] items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-all duration-200 sm:grid-cols-[40px_1fr_auto_auto] sm:gap-4 sm:px-4 sm:py-3 ${
				isCurrentTrack
					? 'border-l-[3px] border-l-green-500 bg-green-500/10 pl-[calc(1rem-3px)] text-green-500'
					: 'border-l-[3px] border-l-transparent text-gray-300 hover:bg-white/5 hover:text-white'
			}`}
		>
			<span className="flex items-center justify-center text-sm">
				{isCurrentTrack && isPlaying ? (
					<span className="flex h-4 items-end gap-0.5">
						<span className="h-3 w-0.5 animate-pulse bg-green-500" />
						<span
							className="h-4 w-0.5 animate-pulse bg-green-500"
							style={{ animationDelay: '0.15s' }}
						/>
						<span
							className="h-2 w-0.5 animate-pulse bg-green-500"
							style={{ animationDelay: '0.3s' }}
						/>
					</span>
				) : (
					<>
						<span
							className={`block font-mono text-gray-500 group-hover:hidden ${isCurrentTrack ? 'text-green-500' : ''}`}
						>
							{number ?? track.trackNumber ?? index + 1}
						</span>
						<Play className="hidden h-4 w-4 group-hover:block" fill="currentColor" />
					</>
				)}
			</span>

			<div className="flex flex-col overflow-hidden">
				<span
					className={`truncate font-medium ${isCurrentTrack ? 'text-green-500' : 'text-white'}`}
				>
					{trackTitle(track)}
				</span>
				{showArtist && (
					<span className="truncate text-xs text-gray-500 group-hover:text-gray-400">
						{album.artist}
					</span>
				)}
			</div>

			<span className="w-16 text-right font-mono text-sm text-gray-500 group-hover:text-gray-400">
				{track.durationMs != null
					? formatDuration(track.durationMs / 1000)
					: formatSize(track.bytes)}
			</span>

			<div className="flex items-center gap-0.5">
				{onPlayNext && (
					<span
						onClick={(e) => {
							e.stopPropagation();
							onPlayNext(track, album);
						}}
						className={`${wideOnly} items-center justify-center rounded-full p-1.5 text-gray-500 opacity-0 transition-all duration-200 group-hover:opacity-100 hover:bg-white/10 hover:text-white`}
						title="Play next"
					>
						<ListEnd className="h-4 w-4" />
					</span>
				)}
				{onToggleLike && (
					<span
						onClick={(e) => {
							e.stopPropagation();
							onToggleLike();
						}}
						className={`flex items-center justify-center rounded-full p-1.5 transition-all duration-200 hover:bg-white/10 ${
							isLiked ? 'text-green-500' : 'text-gray-500 hover:text-white'
						}`}
						title={isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
						aria-label={isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
					>
						<Heart className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} />
					</span>
				)}
				{onDownload && (
					<span
						onClick={handleDownload}
						className={`${wideOnly} items-center justify-center rounded-full p-1.5 transition-all duration-200 ${
							isDownloading
								? 'text-green-500'
								: 'text-gray-500 hover:bg-white/10 hover:text-white'
						}`}
						title="Download"
					>
						{isDownloading ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Download className="h-4 w-4" />
						)}
					</span>
				)}
				{showRemove && onRemove && (
					<span
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
						className="flex items-center justify-center rounded-full p-1.5 text-gray-500 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400"
						title={removeLabel}
					>
						<X className="h-4 w-4" />
					</span>
				)}
				{onMenu && (
					<span
						onClick={onMenu}
						className="flex items-center justify-center rounded-full p-1.5 text-gray-500 transition-all duration-200 hover:bg-white/10 hover:text-white"
						title="More options"
						aria-label={`More options for ${trackTitle(track)}`}
					>
						<Ellipsis className="h-4 w-4" />
					</span>
				)}
			</div>
		</button>
	);
}

/** A liked or playlist track whose file left the catalog: listed, never played. */
export function UnavailableTrackRow({
	index,
	albumName,
	action,
}: {
	index: number;
	albumName?: string | null;
	action: { label: string; icon: LucideIcon; active?: boolean; onClick: () => void };
}) {
	const Icon = action.icon;
	return (
		<div
			aria-disabled="true"
			className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-2 rounded-lg border-l-[3px] border-l-transparent px-3 py-2.5 text-gray-600 sm:grid-cols-[40px_1fr_auto] sm:gap-4 sm:px-4 sm:py-3"
		>
			<span className="text-center font-mono text-sm">{index + 1}</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate font-medium">{albumName ?? 'Unknown album'}</span>
				<span className="truncate text-xs">No longer available</span>
			</span>
			<button
				type="button"
				onClick={action.onClick}
				aria-label={action.label}
				title={action.label}
				className={`flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-white/10 ${
					action.active ? 'text-green-500' : 'text-gray-500 hover:text-white'
				}`}
			>
				<Icon className="h-4 w-4" fill={action.active ? 'currentColor' : 'none'} />
			</button>
		</div>
	);
}
