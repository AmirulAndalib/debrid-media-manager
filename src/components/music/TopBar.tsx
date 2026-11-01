import { ChevronLeft, ChevronRight, Keyboard, Library, X } from 'lucide-react';

interface TopBarProps {
	searchText: string;
	onSearch: (q: string) => void;
	registerSearchInput: (input: HTMLInputElement | null) => void;
	catalogTotals: { totalAlbums: number; totalTracks: number } | null;
	onShowShortcuts: () => void;
}

/** The catalog search: the top bar's, and on phones the search page's own. */
export function SearchBox({
	value,
	onSearch,
	inputRef,
}: {
	value: string;
	onSearch: (q: string) => void;
	inputRef: (input: HTMLInputElement | null) => void;
}) {
	return (
		<div className="relative min-w-0 flex-1 md:max-w-md">
			<input
				ref={inputRef}
				type="text"
				placeholder="Search artists or albums..."
				value={value}
				onChange={(e) => onSearch(e.target.value)}
				aria-label="Search artists or albums"
				className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 pr-9 text-sm placeholder-gray-400 outline-hidden backdrop-blur-sm transition-all duration-200 focus:border-green-500/50 focus:bg-white/10 focus:ring-1 focus:ring-green-500/30"
			/>
			{value && (
				<button
					type="button"
					onClick={() => onSearch('')}
					className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-0.5 text-gray-400 transition-colors hover:text-white"
					aria-label="Clear search"
					title="Clear search"
				>
					<X className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}

const roundButton =
	'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/40 text-gray-300 transition-colors hover:bg-black/60 hover:text-white';

export default function TopBar({
	searchText,
	onSearch,
	registerSearchInput,
	catalogTotals,
	onShowShortcuts,
}: TopBarProps) {
	return (
		<div className="flex items-center gap-2 px-4 py-3">
			<button
				type="button"
				onClick={() => window.history.back()}
				className={roundButton}
				aria-label="Go back"
				title="Go back"
			>
				<ChevronLeft className="h-5 w-5" />
			</button>
			<button
				type="button"
				onClick={() => window.history.forward()}
				className={roundButton}
				aria-label="Go forward"
				title="Go forward"
			>
				<ChevronRight className="h-5 w-5" />
			</button>

			<SearchBox value={searchText} onSearch={onSearch} inputRef={registerSearchInput} />

			<div className="ml-auto flex min-w-0 items-center gap-3 pl-2">
				{catalogTotals && (
					<div className="flex min-w-0 items-center gap-2 text-sm text-gray-400">
						<Library className="h-4 w-4 shrink-0" />
						<span className="truncate">
							{catalogTotals.totalAlbums} albums &middot; {catalogTotals.totalTracks}{' '}
							tracks
						</span>
					</div>
				)}
				<button
					type="button"
					onClick={onShowShortcuts}
					className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-400 transition-all duration-200 hover:border-white/20 hover:bg-white/10 hover:text-white"
					aria-label="Keyboard shortcuts"
					title="Keyboard shortcuts (?)"
				>
					<Keyboard className="h-3.5 w-3.5" />
					<span>?</span>
				</button>
			</div>
		</div>
	);
}
