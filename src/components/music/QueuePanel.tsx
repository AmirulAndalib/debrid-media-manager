import { MusicTrack } from '@/pages/api/music/library';
import { ListMusic, Trash2, X } from 'lucide-react';
import TrackListItem from './TrackListItem';
import { QueuedTrack } from './types';

interface QueuePanelProps {
	nowPlaying: QueuedTrack;
	upNext: QueuedTrack[];
	isPlaying: boolean;
	/** Position in `upNext`; -1 is the track playing now. */
	onPlayTrack: (position: number) => void;
	onClose: () => void;
	onDownload: (track: MusicTrack) => Promise<void>;
	onRemoveTrack: (position: number) => void;
	onClearQueue: () => void;
}

export default function QueuePanel({
	nowPlaying,
	upNext,
	isPlaying,
	onPlayTrack,
	onClose,
	onDownload,
	onRemoveTrack,
	onClearQueue,
}: QueuePanelProps) {
	const queue = [nowPlaying, ...upNext];

	return (
		<div
			className="fixed right-0 bottom-[4.5rem] left-0 z-50 flex flex-col border-t border-white/10 bg-black/95 backdrop-blur-xl md:right-4 md:bottom-24 md:left-auto md:w-96 md:rounded-xl md:border md:bg-black/90 md:shadow-music-2xl"
			aria-label="Playback queue"
		>
			{/* Header */}
			<div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
				<div className="flex items-center gap-2">
					<ListMusic className="h-5 w-5 text-green-500" />
					<h3 className="font-bold text-white">Queue</h3>
					<span className="text-sm text-gray-400">
						{queue.length} {queue.length === 1 ? 'track' : 'tracks'}
					</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={onClearQueue}
						className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
						aria-label="Clear queue"
						title="Clear queue"
					>
						<Trash2 className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={onClose}
						className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
						aria-label="Close queue"
						title="Close queue"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			</div>

			{/* Track list */}
			<div className="max-h-96 overflow-y-auto">
				{queue.map((item, index) => (
					<TrackListItem
						key={`${item.track.id}-${index}`}
						track={item.track}
						index={index}
						album={item.album}
						isCurrentTrack={index === 0}
						isPlaying={isPlaying}
						onPlay={() => onPlayTrack(index - 1)}
						onDownload={onDownload}
						onRemove={() => onRemoveTrack(index - 1)}
						showRemove
					/>
				))}
			</div>
		</div>
	);
}
