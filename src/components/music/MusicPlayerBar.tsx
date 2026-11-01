import {
	Disc3,
	Heart,
	ListMusic,
	Loader2,
	Pause,
	Play,
	Repeat,
	Repeat1,
	Shuffle,
	SkipBack,
	SkipForward,
	Volume2,
	VolumeX,
} from 'lucide-react';
import { PlayerState, QueuedTrack } from './types';
import { formatDuration, trackTitle } from './utils';

interface MusicPlayerBarProps {
	currentTrack: QueuedTrack;
	playerState: PlayerState;
	onTogglePlay: () => void;
	onSkipNext: () => void;
	onSkipPrev: () => void;
	onToggleShuffle: () => void;
	onToggleRepeat: () => void;
	onSeek: (seconds: number) => void;
	onVolumeChange: (volume: number) => void;
	onToggleMute: () => void;
	onToggleQueue: () => void;
	isQueueOpen: boolean;
	/** The current track is in Liked Songs. */
	isLiked?: boolean;
	onToggleLike?: () => void;
	/** Phones: the cover and title open the full-screen Now Playing. */
	onOpenNowPlaying?: () => void;
}

export default function MusicPlayerBar({
	currentTrack,
	playerState,
	onTogglePlay,
	onSkipNext,
	onSkipPrev,
	onToggleShuffle,
	onToggleRepeat,
	onSeek,
	onVolumeChange,
	onToggleMute,
	onToggleQueue,
	isQueueOpen,
	isLiked = false,
	onToggleLike,
	onOpenNowPlaying,
}: MusicPlayerBarProps) {
	const heart = (size: string) =>
		onToggleLike && (
			<button
				type="button"
				onClick={onToggleLike}
				aria-pressed={isLiked}
				aria-label={isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
				title={isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
				className={`shrink-0 transition-colors ${
					isLiked
						? 'text-green-500 hover:text-green-400'
						: 'text-gray-400 hover:text-white'
				}`}
			>
				<Heart className={size} fill={isLiked ? 'currentColor' : 'none'} />
			</button>
		);

	return (
		<div className="relative z-40 shrink-0 animate-slide-up border-t border-white/10 bg-black/90 px-3 py-2 backdrop-blur-xl md:px-4 md:py-3">
			{/* Mobile layout */}
			<div className="flex flex-col gap-2 md:hidden">
				{/* Row 1: Track info + controls */}
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={onOpenNowPlaying}
						disabled={!onOpenNowPlaying}
						aria-label="Open Now Playing"
						className="flex min-w-0 flex-1 items-center gap-3 text-left"
					>
						{/* Cover */}
						<div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-800">
							<div className="flex h-full w-full items-center justify-center">
								<Disc3 className="h-5 w-5 text-gray-500" />
							</div>
							{currentTrack.album.coverUrl && (
								// oxlint-disable-next-line nextjs/no-img-element
								<img
									src={currentTrack.album.coverUrl}
									alt={currentTrack.album.album}
									className="absolute inset-0 h-full w-full object-cover"
									onError={(e) => {
										(e.target as HTMLImageElement).style.display = 'none';
									}}
								/>
							)}
						</div>

						{/* Track info */}
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium text-white">
								{trackTitle(currentTrack.track)}
							</p>
							<p className="truncate text-xs text-gray-400">
								{currentTrack.album.artist}
							</p>
						</div>
					</button>

					{/* Core controls */}
					<div className="flex items-center gap-3">
						{heart('h-5 w-5')}
						<button
							type="button"
							onClick={onSkipPrev}
							className="text-gray-400 active:text-white"
							aria-label="Previous track"
							title="Previous"
						>
							<SkipBack className="h-5 w-5" fill="currentColor" />
						</button>
						<button
							type="button"
							onClick={onTogglePlay}
							disabled={playerState.isLoading}
							aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
							title={playerState.isPlaying ? 'Pause' : 'Play'}
							className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black disabled:opacity-50"
						>
							{playerState.isLoading ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : playerState.isPlaying ? (
								<Pause className="h-4 w-4" fill="currentColor" />
							) : (
								<Play className="h-4 w-4 pl-0.5" fill="currentColor" />
							)}
						</button>
						<button
							type="button"
							onClick={onSkipNext}
							className="text-gray-400 active:text-white"
							aria-label="Next track"
							title="Next"
						>
							<SkipForward className="h-5 w-5" fill="currentColor" />
						</button>
						<button
							type="button"
							onClick={onToggleQueue}
							className={isQueueOpen ? 'text-green-500' : 'text-gray-400'}
							aria-label="Queue"
							aria-pressed={isQueueOpen}
							title="Queue"
						>
							<ListMusic className="h-5 w-5" />
						</button>
					</div>
				</div>

				{/* Row 2: Progress bar */}
				<div className="flex items-center gap-2">
					<span className="w-8 text-right font-mono text-[10px] text-gray-400">
						{formatDuration(playerState.currentTime)}
					</span>
					<input
						type="range"
						min={0}
						max={playerState.duration || 100}
						value={playerState.currentTime}
						onChange={(e) => onSeek(parseFloat(e.target.value))}
						aria-label="Playback position"
						className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-gray-600 accent-green-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
					/>
					<span className="w-8 font-mono text-[10px] text-gray-400">
						{formatDuration(playerState.duration)}
					</span>
				</div>
			</div>

			{/* Desktop layout */}
			<div className="mx-auto hidden max-w-screen-2xl items-center gap-4 md:flex">
				{/* Track info */}
				<div className="flex w-72 items-center gap-4">
					<div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-800 shadow-lg">
						{/* Fallback icon */}
						<div className="flex h-full w-full items-center justify-center">
							<Disc3 className="h-8 w-8 text-gray-500" />
						</div>
						{/* Album cover */}
						{currentTrack.album.coverUrl && (
							// oxlint-disable-next-line nextjs/no-img-element
							<img
								src={currentTrack.album.coverUrl}
								alt={currentTrack.album.album}
								className="absolute inset-0 h-full w-full object-cover"
								onError={(e) => {
									(e.target as HTMLImageElement).style.display = 'none';
								}}
							/>
						)}
					</div>
					<div className="min-w-0">
						<p className="truncate font-medium text-white">
							{trackTitle(currentTrack.track)}
						</p>
						<p className="truncate text-sm text-gray-400">
							{currentTrack.album.artist}
						</p>
					</div>
					{heart('h-4 w-4')}
				</div>

				{/* Player controls */}
				<div className="flex flex-1 flex-col items-center gap-2">
					<div className="flex items-center gap-6">
						<button
							type="button"
							onClick={onToggleShuffle}
							className={`transition-all duration-200 hover:scale-110 ${
								playerState.isShuffled
									? 'text-green-500'
									: 'text-gray-400 hover:text-white'
							}`}
							aria-label="Shuffle"
							aria-pressed={playerState.isShuffled}
							title="Shuffle"
						>
							<Shuffle className="h-4 w-4" />
						</button>

						<button
							type="button"
							onClick={onSkipPrev}
							className="text-gray-400 transition-all duration-200 hover:scale-110 hover:text-white"
							aria-label="Previous track"
							title="Previous"
						>
							<SkipBack className="h-5 w-5" fill="currentColor" />
						</button>

						<button
							type="button"
							onClick={onTogglePlay}
							disabled={playerState.isLoading}
							aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
							title={playerState.isPlaying ? 'Pause' : 'Play'}
							className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50"
						>
							{playerState.isLoading ? (
								<Loader2 className="h-5 w-5 animate-spin" />
							) : playerState.isPlaying ? (
								<Pause className="h-5 w-5" fill="currentColor" />
							) : (
								<Play className="h-5 w-5 pl-0.5" fill="currentColor" />
							)}
						</button>

						<button
							type="button"
							onClick={onSkipNext}
							className="text-gray-400 transition-all duration-200 hover:scale-110 hover:text-white"
							aria-label="Next track"
							title="Next"
						>
							<SkipForward className="h-5 w-5" fill="currentColor" />
						</button>

						<button
							type="button"
							onClick={onToggleRepeat}
							className={`transition-all duration-200 hover:scale-110 ${
								playerState.repeatMode !== 'off'
									? 'text-green-500'
									: 'text-gray-400 hover:text-white'
							}`}
							aria-label={`Repeat: ${playerState.repeatMode}`}
							aria-pressed={playerState.repeatMode !== 'off'}
							title="Repeat"
						>
							{playerState.repeatMode === 'one' ? (
								<Repeat1 className="h-4 w-4" />
							) : (
								<Repeat className="h-4 w-4" />
							)}
						</button>
					</div>

					{/* Progress bar */}
					<div className="group flex w-full max-w-xl items-center gap-2">
						<span className="w-10 text-right font-mono text-xs text-gray-400">
							{formatDuration(playerState.currentTime)}
						</span>
						<input
							type="range"
							min={0}
							max={playerState.duration || 100}
							value={playerState.currentTime}
							onChange={(e) => onSeek(parseFloat(e.target.value))}
							aria-label="Playback position"
							className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-gray-600 accent-green-500 transition-all hover:h-1.5 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:transition-all group-hover:[&::-webkit-slider-thumb]:h-4 group-hover:[&::-webkit-slider-thumb]:w-4"
						/>
						<span className="w-10 font-mono text-xs text-gray-400">
							{formatDuration(playerState.duration)}
						</span>
					</div>
				</div>

				{/* Volume & Queue */}
				<div className="flex w-48 items-center justify-end gap-2">
					<button
						type="button"
						onClick={onToggleQueue}
						className={`transition-colors ${
							isQueueOpen ? 'text-green-500' : 'text-gray-400 hover:text-white'
						}`}
						aria-label="Queue"
						aria-pressed={isQueueOpen}
						title="Queue"
					>
						<ListMusic className="h-5 w-5" />
					</button>
					<button
						type="button"
						onClick={onToggleMute}
						className="text-gray-400 transition-colors hover:text-white"
						aria-label={
							playerState.isMuted || playerState.volume === 0 ? 'Unmute' : 'Mute'
						}
						title={playerState.isMuted || playerState.volume === 0 ? 'Unmute' : 'Mute'}
					>
						{playerState.isMuted || playerState.volume === 0 ? (
							<VolumeX className="h-5 w-5" />
						) : (
							<Volume2 className="h-5 w-5" />
						)}
					</button>
					<input
						type="range"
						min={0}
						max={1}
						step={0.01}
						value={playerState.isMuted ? 0 : playerState.volume}
						onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
						aria-label="Volume"
						className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-gray-600 accent-green-500 hover:h-1.5 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
					/>
				</div>
			</div>
		</div>
	);
}
