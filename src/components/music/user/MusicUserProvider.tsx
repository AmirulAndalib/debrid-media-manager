import type { MusicUserLibraryResponse } from '@/pages/api/music/me/library';
import type { MusicLikeIdsResponse } from '@/pages/api/music/me/likes';
import type { MusicPlaylistAddResponse } from '@/pages/api/music/me/playlists/[id]/tracks';
import type { MusicSessionResponse } from '@/pages/api/music/session';
import type { MusicAlbumSummary, MusicPlaylistSummary } from '@/utils/musicRows';
import type { MusicTrackRef } from '@/utils/musicUser';
import {
	createContext,
	ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react';
import toast from 'react-hot-toast';

const SESSION_KEY = 'music:session';
// Mint a new token a minute early rather than send one that lapses in flight.
const EXPIRY_MARGIN_MS = 60_000;

export interface MusicUser {
	/** The session and the library have loaded, or signing in failed and the user features are off. */
	ready: boolean;
	/** null while signing in, and after signing in failed. */
	userId: string | null;
	library: MusicUserLibraryResponse;
	/** Liked tracks as `${hash}-${fileId}`, the catalog's track id. */
	likedIds: Set<string>;
	/** fetch for /api/music/me/*: adds the session token, and on a 401 mints a new one once. */
	musicFetch: (path: string, init?: RequestInit) => Promise<Response>;
	isSaved: (mbid: string) => boolean;
	isLiked: (trackId: string) => boolean;
	isFollowed: (mbid: string) => boolean;
	/** `album` fills Your Library's row before the server answers. */
	saveAlbum: (mbid: string, album?: MusicAlbumSummary) => void;
	unsaveAlbum: (mbid: string) => void;
	followArtist: (mbid: string, name?: string) => void;
	unfollowArtist: (mbid: string) => void;
	like: (ref: MusicTrackRef) => void;
	unlike: (ref: MusicTrackRef) => void;
	/** Without a name it is "My Playlist #n", as Spotify names them. */
	createPlaylist: (name?: string) => Promise<MusicPlaylistSummary | null>;
	renamePlaylist: (id: string, name: string) => Promise<boolean>;
	deletePlaylist: (id: string) => Promise<boolean>;
	addToPlaylist: (id: string, refs: MusicTrackRef[]) => Promise<boolean>;
	removeFromPlaylist: (id: string, trackIds: string[]) => Promise<boolean>;
	reorderPlaylist: (id: string, order: string[]) => Promise<boolean>;
	refreshLibrary: () => Promise<void>;
}

const emptyLibrary: MusicUserLibraryResponse = { albums: [], artists: [], playlists: [] };
const MusicUserContext = createContext<MusicUser | null>(null);

export function useMusicUser(): MusicUser {
	const user = useContext(MusicUserContext);
	if (!user) throw new Error('useMusicUser must be used inside a MusicUserProvider');
	return user;
}

function readSession(): MusicSessionResponse | null {
	try {
		const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
		return typeof saved?.token === 'string' && typeof saved.exp === 'number' ? saved : null;
	} catch {
		return null;
	}
}

const trackId = (ref: MusicTrackRef) => `${ref.hash}-${ref.fileId}`;

export function MusicUserProvider({
	accessToken,
	children,
}: {
	/** The Real-Debrid access token the session is minted from. */
	accessToken: string | null;
	children: ReactNode;
}) {
	const tokenRef = useRef(accessToken);
	tokenRef.current = accessToken;
	const session = useRef<MusicSessionResponse | null>(null);
	const minting = useRef<Promise<MusicSessionResponse> | null>(null);
	const gaveUp = useRef(false);
	const started = useRef(false);
	const [ready, setReady] = useState(false);
	const [userId, setUserId] = useState<string | null>(null);
	const [library, setLibrary] = useState(emptyLibrary);
	const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set());

	const musicFetch = useCallback(async (path: string, init: RequestInit = {}) => {
		const mint = () =>
			(minting.current ??= (async () => {
				const res = await fetch('/api/music/session', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ accessToken: tokenRef.current }),
				});
				if (!res.ok) throw new Error(`Music session refused: ${res.status}`);
				const minted: MusicSessionResponse = await res.json();
				session.current = minted;
				try {
					localStorage.setItem(SESSION_KEY, JSON.stringify(minted));
				} catch {}
				return minted;
			})().finally(() => (minting.current = null)));
		const giveUp = (err: unknown) => {
			if (!gaveUp.current) {
				gaveUp.current = true;
				session.current = null;
				try {
					localStorage.removeItem(SESSION_KEY);
				} catch {}
				setUserId(null);
				toast.error('Your music library could not sign in. Reload the page to try again.');
			}
			return err;
		};
		const send = (token: string) =>
			fetch(path, {
				...init,
				headers: {
					'Content-Type': 'application/json',
					...(init.headers as Record<string, string> | undefined),
					'x-dmm-music-token': token,
				},
			});

		if (gaveUp.current || !tokenRef.current) throw new Error('No music session');
		const saved = session.current ?? readSession();
		const current =
			saved && saved.exp > Date.now() + EXPIRY_MARGIN_MS
				? (session.current = saved)
				: await mint().catch((err) => Promise.reject(giveUp(err)));
		const res = await send(current.token);
		if (res.status !== 401) return res;
		// Revoked or signed with a rotated secret: one new token, then give up.
		session.current = null;
		const retried = await send(
			(await mint().catch((err) => Promise.reject(giveUp(err)))).token
		);
		if (retried.status === 401) throw giveUp(new Error('Music session refused'));
		return retried;
	}, []);

	const refreshLibrary = useCallback(async () => {
		try {
			const res = await musicFetch('/api/music/me/library');
			if (res.ok) setLibrary(await res.json());
		} catch (err) {
			console.error('Failed to load your music library:', err);
		}
	}, [musicFetch]);

	useEffect(() => {
		if (!accessToken || started.current) return;
		started.current = true;
		void (async () => {
			try {
				const [, likes] = await Promise.all([
					refreshLibrary(),
					musicFetch('/api/music/me/likes?ids=1'),
				]);
				if (likes.ok) {
					setLikedIds(new Set(((await likes.json()) as MusicLikeIdsResponse).ids));
				}
			} catch (err) {
				console.error('Failed to load your liked songs:', err);
			} finally {
				setUserId(session.current?.userId ?? null);
				setReady(true);
			}
		})();
	}, [accessToken, musicFetch, refreshLibrary]);

	// The request's answer when it succeeded, else null.
	const send = async (path: string, method: string, body?: unknown) => {
		try {
			const res = await musicFetch(path, {
				method,
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			return res.ok ? res : null;
		} catch {
			return null;
		}
	};

	// Shows the change at once; puts it back and says so when the server refuses it.
	const optimistic = async (
		apply: () => void,
		revert: () => void,
		path: string,
		method: 'PUT' | 'DELETE',
		body: unknown,
		failure: string
	) => {
		apply();
		if (await send(path, method, body)) return;
		revert();
		toast.error(failure);
	};

	const toggleLike = (ref: MusicTrackRef, liked: boolean) => {
		const id = trackId(ref);
		const set = (on: boolean) =>
			setLikedIds((ids) => {
				const next = new Set(ids);
				if (on) next.add(id);
				else next.delete(id);
				return next;
			});
		void optimistic(
			() => set(liked),
			() => set(!liked),
			'/api/music/me/likes',
			liked ? 'PUT' : 'DELETE',
			ref,
			liked ? 'Could not add to Liked Songs' : 'Could not remove from Liked Songs'
		);
	};

	const albumPath = (mbid: string) => `/api/music/me/albums/${encodeURIComponent(mbid)}`;
	const artistPath = (mbid: string) => `/api/music/me/artists/${encodeURIComponent(mbid)}`;
	const insertAt = <T,>(rows: T[], index: number, row: T) => [
		...rows.slice(0, index),
		row,
		...rows.slice(index),
	];

	const isSaved = (mbid: string) => library.albums.some((row) => row.mbid === mbid);
	const isFollowed = (mbid: string) => library.artists.some((row) => row.artistMbid === mbid);

	const saveAlbum = (mbid: string, album?: MusicAlbumSummary) => {
		if (isSaved(mbid)) return;
		const row = {
			mbid,
			savedAt: new Date().toISOString(),
			album: album
				? {
						hash: album.hash,
						mbid,
						artistMbid: album.artistMbid,
						artist: album.artist,
						album: album.album,
						year: album.year,
						coverUrl: album.coverUrl,
						trackCount: album.trackCount,
					}
				: null,
		};
		void optimistic(
			() => setLibrary((lib) => ({ ...lib, albums: [row, ...lib.albums] })),
			() => setLibrary((lib) => ({ ...lib, albums: lib.albums.filter((r) => r !== row) })),
			albumPath(mbid),
			'PUT',
			undefined,
			'Could not save the album to Your Library'
		);
	};

	const unsaveAlbum = (mbid: string) => {
		const index = library.albums.findIndex((row) => row.mbid === mbid);
		if (index < 0) return;
		const row = library.albums[index];
		void optimistic(
			() => setLibrary((lib) => ({ ...lib, albums: lib.albums.filter((r) => r !== row) })),
			() => setLibrary((lib) => ({ ...lib, albums: insertAt(lib.albums, index, row) })),
			albumPath(mbid),
			'DELETE',
			undefined,
			'Could not remove the album from Your Library'
		);
	};

	const followArtist = (mbid: string, name?: string) => {
		if (isFollowed(mbid)) return;
		const row = { artistMbid: mbid, name: name ?? null, followedAt: new Date().toISOString() };
		void optimistic(
			() => setLibrary((lib) => ({ ...lib, artists: [row, ...lib.artists] })),
			() => setLibrary((lib) => ({ ...lib, artists: lib.artists.filter((r) => r !== row) })),
			artistPath(mbid),
			'PUT',
			undefined,
			'Could not follow the artist'
		);
	};

	const unfollowArtist = (mbid: string) => {
		const index = library.artists.findIndex((row) => row.artistMbid === mbid);
		if (index < 0) return;
		const row = library.artists[index];
		void optimistic(
			() => setLibrary((lib) => ({ ...lib, artists: lib.artists.filter((r) => r !== row) })),
			() => setLibrary((lib) => ({ ...lib, artists: insertAt(lib.artists, index, row) })),
			artistPath(mbid),
			'DELETE',
			undefined,
			'Could not unfollow the artist'
		);
	};

	const playlistPath = (id: string) => `/api/music/me/playlists/${encodeURIComponent(id)}`;
	const updatePlaylist = (id: string, change: Partial<MusicPlaylistSummary>) =>
		setLibrary((lib) => ({
			...lib,
			playlists: lib.playlists.map((p) => (p.id === id ? { ...p, ...change } : p)),
		}));
	const failed = (message: string) => {
		toast.error(message);
		return false;
	};

	const user: MusicUser = {
		ready,
		userId,
		library,
		likedIds,
		musicFetch,
		isSaved,
		isLiked: (id) => likedIds.has(id),
		isFollowed,
		saveAlbum,
		unsaveAlbum,
		followArtist,
		unfollowArtist,
		like: (ref) => toggleLike(ref, true),
		unlike: (ref) => toggleLike(ref, false),
		createPlaylist: async (name) => {
			const res = await send('/api/music/me/playlists', 'POST', {
				name: name?.trim() || `My Playlist #${library.playlists.length + 1}`,
			});
			if (!res) {
				failed('Could not create the playlist');
				return null;
			}
			const created: MusicPlaylistSummary = await res.json();
			setLibrary((lib) => ({ ...lib, playlists: [created, ...lib.playlists] }));
			return created;
		},
		renamePlaylist: async (id, name) => {
			const res = await send(playlistPath(id), 'PATCH', { name });
			if (!res) return failed('Could not rename the playlist');
			updatePlaylist(id, await res.json());
			return true;
		},
		deletePlaylist: async (id) => {
			if (!(await send(playlistPath(id), 'DELETE'))) {
				return failed('Could not delete the playlist');
			}
			setLibrary((lib) => ({ ...lib, playlists: lib.playlists.filter((p) => p.id !== id) }));
			return true;
		},
		addToPlaylist: async (id, refs) => {
			const res = await send(`${playlistPath(id)}/tracks`, 'POST', { tracks: refs });
			if (!res) return failed('Could not add to the playlist');
			const { trackCount }: MusicPlaylistAddResponse = await res.json();
			updatePlaylist(id, { trackCount, updatedAt: new Date().toISOString() });
			const name = library.playlists.find((p) => p.id === id)?.name ?? 'the playlist';
			toast.success(`Added to ${name}`);
			return true;
		},
		removeFromPlaylist: async (id, trackIds) => {
			if (!(await send(`${playlistPath(id)}/tracks`, 'DELETE', { trackIds }))) {
				return failed('Could not remove from the playlist');
			}
			const playlist = library.playlists.find((p) => p.id === id);
			if (playlist) {
				updatePlaylist(id, {
					trackCount: Math.max(0, playlist.trackCount - trackIds.length),
				});
			}
			return true;
		},
		reorderPlaylist: async (id, order) =>
			(await send(`${playlistPath(id)}/tracks`, 'PUT', { order }))
				? true
				: failed('Could not reorder the playlist'),
		refreshLibrary,
	};

	return <MusicUserContext.Provider value={user}>{children}</MusicUserContext.Provider>;
}
