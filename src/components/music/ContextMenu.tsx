import type { MusicAlbum, MusicTrack } from '@/pages/api/music/library';
import type { MusicTrackRef } from '@/utils/musicUser';
import {
	ChevronLeft,
	ChevronRight,
	CircleCheck,
	CirclePlus,
	Disc3,
	Download,
	Heart,
	HeartOff,
	ListEnd,
	ListMusic,
	ListPlus,
	ListStart,
	LucideIcon,
	Play,
	Plus,
	UserRound,
} from 'lucide-react';
import { KeyboardEvent, MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MusicPlayer } from './player/MusicPlayerProvider';
import { artistRoute, type MusicRoute } from './routes';
import type { QueuedTrack } from './types';
import type { MusicUser } from './user/MusicUserProvider';
import { albumItems, trackRef } from './utils';

export interface MenuItem {
	label: string;
	icon?: LucideIcon;
	onSelect?: () => void;
	/** A submenu, shown in place of this menu with a way back. */
	items?: MenuItem[];
}

export interface OpenMenu {
	items: MenuItem[];
	x: number;
	y: number;
}

/** Where a menu opens: at the pointer, or under the button for a keyboard click. */
export function menuAt(e: MouseEvent, items: MenuItem[]): OpenMenu {
	e.preventDefault();
	e.stopPropagation();
	if (e.type === 'click' && e.detail === 0) {
		const rect = e.currentTarget.getBoundingClientRect();
		return { items, x: rect.left, y: rect.bottom };
	}
	return { items, x: e.clientX, y: e.clientY };
}

const MARGIN = 8;

export default function ContextMenu({
	menu,
	sheet = false,
	onClose,
}: {
	menu: OpenMenu;
	/** Phones get a bottom sheet instead of a menu at the pointer. */
	sheet?: boolean;
	onClose: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [stack, setStack] = useState([menu.items]);
	const shown = stack[stack.length - 1];
	const [position, setPosition] = useState({ left: menu.x, top: menu.y });

	// Kept on screen: it opens left of or above the pointer when it would not fit.
	useLayoutEffect(() => {
		if (sheet || !ref.current) return;
		const { width, height } = ref.current.getBoundingClientRect();
		setPosition({
			left: Math.max(MARGIN, Math.min(menu.x, window.innerWidth - width - MARGIN)),
			top:
				menu.y + height > window.innerHeight - MARGIN
					? Math.max(MARGIN, menu.y - height)
					: menu.y,
		});
	}, [menu.x, menu.y, sheet, shown]);

	useEffect(() => {
		ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	}, [shown]);

	// Bound once: the page re-renders as the track plays, and focus must stay put.
	const close = useRef(onClose);
	close.current = onClose;
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		const outside = (e: Event) => {
			if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) close.current();
		};
		const escape = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close.current();
		const resize = () => close.current();
		document.addEventListener('mousedown', outside);
		window.addEventListener('scroll', outside, true);
		window.addEventListener('resize', resize);
		window.addEventListener('keydown', escape);
		return () => {
			document.removeEventListener('mousedown', outside);
			window.removeEventListener('scroll', outside, true);
			window.removeEventListener('resize', resize);
			window.removeEventListener('keydown', escape);
			opener?.focus?.();
		};
	}, []);

	// The menu owns the keyboard while it has focus: the player's shortcuts wait.
	const onKeyDown = (e: KeyboardEvent) => {
		e.stopPropagation();
		const items = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
		const at = items.indexOf(document.activeElement as HTMLElement);
		const focus = (index: number) => {
			e.preventDefault();
			items[(index + items.length) % items.length]?.focus();
		};
		switch (e.key) {
			case 'ArrowDown':
				return focus(at + 1);
			case 'ArrowUp':
				return focus(at - 1);
			case 'Home':
				return focus(0);
			case 'End':
				return focus(-1);
			case 'ArrowLeft':
				if (stack.length > 1) setStack((s) => s.slice(0, -1));
				return;
			case 'ArrowRight':
				if (at >= 0 && items[at].getAttribute('aria-haspopup')) items[at].click();
				return;
			case 'Escape':
			case 'Tab':
				e.preventDefault();
				return onClose();
		}
	};

	const itemClass =
		'flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left text-sm text-gray-200 transition-colors outline-none hover:bg-white/10 focus:bg-white/10 sm:py-2';
	const list = (
		<>
			{stack.length > 1 && (
				<button
					type="button"
					role="menuitem"
					onClick={() => setStack((s) => s.slice(0, -1))}
					className={`${itemClass} text-gray-400`}
				>
					<ChevronLeft className="h-4 w-4 shrink-0" />
					Back
				</button>
			)}
			{shown.map((item, index) => {
				const Icon = item.icon;
				return (
					<button
						key={`${item.label}-${index}`}
						type="button"
						role="menuitem"
						aria-haspopup={item.items ? 'menu' : undefined}
						onClick={() => {
							if (item.items) return setStack((s) => [...s, item.items!]);
							onClose();
							item.onSelect?.();
						}}
						className={itemClass}
					>
						{Icon && <Icon className="h-4 w-4 shrink-0 text-gray-400" />}
						<span className="min-w-0 flex-1 truncate">{item.label}</span>
						{item.items && <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
					</button>
				);
			})}
		</>
	);

	if (sheet) {
		return (
			<div className="fixed inset-0 z-[90] flex items-end bg-black/60">
				<div
					ref={ref}
					role="menu"
					onKeyDown={onKeyDown}
					className="max-h-[70dvh] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 bg-gray-900 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
				>
					{list}
				</div>
			</div>
		);
	}
	return (
		<div
			ref={ref}
			role="menu"
			onKeyDown={onKeyDown}
			onContextMenu={(e) => e.preventDefault()}
			style={position}
			className="fixed z-[90] max-h-[min(70vh,28rem)] w-60 overflow-y-auto rounded-md border border-white/10 bg-gray-900 p-1 shadow-music-2xl"
		>
			{list}
		</div>
	);
}

/** What the menus act with; the page supplies it. */
export interface MenuActions {
	player: Pick<MusicPlayer, 'playContext' | 'playNext' | 'addToQueue'>;
	user: MusicUser;
	navigate: (route: MusicRoute) => void;
	/** The album with its tracks, fetched when it is a summary; null when that fails. */
	withTracks: (album: MusicAlbum) => Promise<MusicAlbum | null>;
	download: (track: MusicTrack) => void;
	/** Asks first: the browser holds a burst of downloads behind a prompt. */
	downloadAlbum: (album: MusicAlbum) => void;
}

const addToPlaylistItem = (a: MenuActions, refs: () => Promise<MusicTrackRef[]>): MenuItem => {
	const add = async (id?: string) => {
		const tracks = await refs();
		const playlistId = id ?? (await a.user.createPlaylist())?.id;
		if (playlistId && tracks.length) await a.user.addToPlaylist(playlistId, tracks);
	};
	return {
		label: 'Add to playlist',
		icon: ListPlus,
		items: [
			{ label: 'New playlist', icon: Plus, onSelect: () => void add() },
			...a.user.library.playlists.map((playlist) => ({
				label: playlist.name,
				icon: ListMusic,
				onSelect: () => void add(playlist.id),
			})),
		],
	};
};

const goToArtist = (a: MenuActions, album: MusicAlbum): MenuItem => ({
	label: 'Go to artist',
	icon: UserRound,
	onSelect: () => a.navigate(artistRoute(album)),
});

export function trackMenuItems({ track, album }: QueuedTrack, a: MenuActions): MenuItem[] {
	const ref = trackRef(track, album);
	const item = { track, album };
	return [
		{ label: 'Play next', icon: ListStart, onSelect: () => a.player.playNext([item]) },
		{ label: 'Add to queue', icon: ListEnd, onSelect: () => a.player.addToQueue([item]) },
		addToPlaylistItem(a, async () => [ref]),
		a.user.isLiked(track.id)
			? {
					label: 'Remove from Liked Songs',
					icon: HeartOff,
					onSelect: () => a.user.unlike(ref),
				}
			: { label: 'Save to Liked Songs', icon: Heart, onSelect: () => a.user.like(ref) },
		{
			label: 'Go to album',
			icon: Disc3,
			onSelect: () => a.navigate({ name: 'album', hash: album.hash }),
		},
		goToArtist(a, album),
		{ label: 'Download', icon: Download, onSelect: () => a.download(track) },
	];
}

export function albumMenuItems(album: MusicAlbum, a: MenuActions): MenuItem[] {
	const withTracks = (act: (full: MusicAlbum) => void) => () =>
		void a.withTracks(album).then((full) => full && act(full));
	return [
		{
			label: 'Play',
			icon: Play,
			onSelect: withTracks((full) =>
				a.player.playContext(albumItems(full), 0, `album:${full.hash}`)
			),
		},
		{
			label: 'Play next',
			icon: ListStart,
			onSelect: withTracks((full) => a.player.playNext(albumItems(full))),
		},
		{
			label: 'Add to queue',
			icon: ListEnd,
			onSelect: withTracks((full) => a.player.addToQueue(albumItems(full))),
		},
		a.user.isSaved(album.mbid)
			? {
					label: 'Remove from Your Library',
					icon: CircleCheck,
					onSelect: () => a.user.unsaveAlbum(album.mbid),
				}
			: {
					label: 'Save to Your Library',
					icon: CirclePlus,
					onSelect: () => a.user.saveAlbum(album.mbid, album),
				},
		addToPlaylistItem(a, async () => {
			const full = await a.withTracks(album);
			return full ? full.tracks.map((track) => trackRef(track, full)) : [];
		}),
		{ label: 'Download album', icon: Download, onSelect: withTracks(a.downloadAlbum) },
		goToArtist(a, album),
	];
}
