export const MUSIC_BASE_PATH = '/music';

export type MusicRoute =
	| { name: 'home' }
	| { name: 'browse' }
	| { name: 'search'; q: string }
	| { name: 'album'; hash: string }
	| { name: 'artist'; mbid: string }
	| { name: 'playlist'; id: string }
	| { name: 'liked' }
	| { name: 'library' };

/** The route for the catch-all's slug. A bare `/music/<hash>` is the old album URL. */
export function parseMusicRoute(
	slug: string | string[] | undefined,
	q?: string | string[]
): MusicRoute {
	const [first, second] = Array.isArray(slug) ? slug : slug ? [slug] : [];
	switch (first) {
		case undefined:
			return { name: 'home' };
		case 'browse':
		case 'liked':
		case 'library':
			return { name: first };
		case 'search':
			return { name: 'search', q: typeof q === 'string' ? q : '' };
		case 'album':
			return second ? { name: 'album', hash: second } : { name: 'browse' };
		case 'artist':
			return second ? { name: 'artist', mbid: second } : { name: 'browse' };
		case 'playlist':
			return second ? { name: 'playlist', id: second } : { name: 'library' };
		default:
			return { name: 'album', hash: first };
	}
}

export function musicHref(route: MusicRoute): string {
	switch (route.name) {
		case 'home':
			return MUSIC_BASE_PATH;
		case 'search':
			return route.q
				? `${MUSIC_BASE_PATH}/search?q=${encodeURIComponent(route.q)}`
				: `${MUSIC_BASE_PATH}/search`;
		case 'album':
			return `${MUSIC_BASE_PATH}/album/${encodeURIComponent(route.hash)}`;
		case 'artist':
			return `${MUSIC_BASE_PATH}/artist/${encodeURIComponent(route.mbid)}`;
		case 'playlist':
			return `${MUSIC_BASE_PATH}/playlist/${encodeURIComponent(route.id)}`;
		default:
			return `${MUSIC_BASE_PATH}/${route.name}`;
	}
}

/**
 * Where a player context lives: `album:<hash>`, `playlist:<id>`, `liked`,
 * `artist:<mbid>:popular` or `search:<q>`.
 */
export function contextRoute(contextId: string | null): MusicRoute | null {
	if (contextId === 'liked') return { name: 'liked' };
	const [kind, id] = contextId?.split(/:(.+)/) ?? [];
	if (kind === 'album' && id) return { name: 'album', hash: id };
	if (kind === 'playlist' && id) return { name: 'playlist', id };
	if (kind === 'artist' && id) return { name: 'artist', mbid: id.split(':')[0] };
	if (kind === 'search' && id) return { name: 'search', q: id };
	return null;
}

/** The artist's page, or a search by name for an album MusicBrainz names no artist id for. */
export const artistRoute = (album: { artist: string; artistMbid?: string | null }): MusicRoute =>
	album.artistMbid
		? { name: 'artist', mbid: album.artistMbid }
		: { name: 'search', q: album.artist };
