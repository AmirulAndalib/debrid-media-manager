import { describe, expect, it } from 'vitest';
import { artistRoute, contextRoute, musicHref, MusicRoute, parseMusicRoute } from './routes';

describe('music routes', () => {
	it.each<[string[] | undefined, string | undefined, MusicRoute]>([
		[undefined, undefined, { name: 'home' }],
		[[], undefined, { name: 'home' }],
		[['browse'], undefined, { name: 'browse' }],
		[['search'], 'daft punk', { name: 'search', q: 'daft punk' }],
		[['search'], undefined, { name: 'search', q: '' }],
		[['album', 'abc123'], undefined, { name: 'album', hash: 'abc123' }],
		[['artist', 'mb-1'], undefined, { name: 'artist', mbid: 'mb-1' }],
		[['playlist', 'p1'], undefined, { name: 'playlist', id: 'p1' }],
		[['liked'], undefined, { name: 'liked' }],
		[['library'], undefined, { name: 'library' }],
		// The old album URL, which the page replaces with /music/album/<hash>.
		[['abc123'], undefined, { name: 'album', hash: 'abc123' }],
		[['album'], undefined, { name: 'browse' }],
		[['playlist'], undefined, { name: 'library' }],
	])('parses %j (q=%s)', (slug, q, route) => {
		expect(parseMusicRoute(slug, q)).toEqual(route);
	});

	it('builds the URL each route parses back from', () => {
		const routes: MusicRoute[] = [
			{ name: 'home' },
			{ name: 'browse' },
			{ name: 'search', q: 'a&b c' },
			{ name: 'album', hash: 'abc' },
			{ name: 'artist', mbid: 'mb-1' },
			{ name: 'playlist', id: 'p1' },
			{ name: 'liked' },
			{ name: 'library' },
		];
		for (const route of routes) {
			const url = new URL(musicHref(route), 'https://dmm.test');
			const slug = url.pathname.split('/').slice(2).map(decodeURIComponent);
			expect(parseMusicRoute(slug, url.searchParams.get('q') ?? undefined)).toEqual(route);
		}
		expect(musicHref({ name: 'search', q: 'a&b c' })).toBe('/music/search?q=a%26b%20c');
		expect(musicHref({ name: 'search', q: '' })).toBe('/music/search');
	});

	it('maps a player context to its page', () => {
		expect(contextRoute('album:h1')).toEqual({ name: 'album', hash: 'h1' });
		expect(contextRoute('playlist:p1')).toEqual({ name: 'playlist', id: 'p1' });
		expect(contextRoute('liked')).toEqual({ name: 'liked' });
		expect(contextRoute('artist:ar1:popular')).toEqual({ name: 'artist', mbid: 'ar1' });
		expect(contextRoute('search:a:b')).toEqual({ name: 'search', q: 'a:b' });
		expect(contextRoute(null)).toBeNull();
		expect(contextRoute('album:')).toBeNull();
	});

	it("opens an album's artist page, or searches by name when it has no artist id", () => {
		expect(artistRoute({ artist: 'Green Day', artistMbid: 'ar-1' })).toEqual({
			name: 'artist',
			mbid: 'ar-1',
		});
		expect(artistRoute({ artist: 'Green Day', artistMbid: null })).toEqual({
			name: 'search',
			q: 'Green Day',
		});
	});
});
