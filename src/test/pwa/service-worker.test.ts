import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The worker only runs in a production build, and Cypress (which drives it) runs
// in neither CI nor the commit hook. Load it against a stand-in Serwist so its
// caching rules are checked by `npm run test`.
const serwist = vi.hoisted(() => ({
	options: undefined as any,
	handlers: {} as Record<string, (event: any) => void>,
}));

vi.mock('serwist', () => {
	class Strategy {
		constructor(public options: any) {}
		handleAll() {
			return [Promise.resolve(), Promise.resolve()];
		}
	}
	return {
		CacheFirst: Strategy,
		NetworkFirst: Strategy,
		ExpirationPlugin: class {
			constructor(public config: any) {}
		},
		Serwist: class {
			constructor(options: any) {
				serwist.options = options;
			}
			addEventListeners() {}
		},
	};
});

const deleted: string[] = [];
const realSelf = globalThis.self;

beforeAll(async () => {
	vi.stubGlobal('self', {
		__SW_MANIFEST: [],
		location: new URL('https://debridmediamanager.com/'),
		addEventListener: (type: string, handler: (event: any) => void) => {
			serwist.handlers[type] = handler;
		},
	});
	vi.stubGlobal('caches', {
		delete: async (name: string) => (deleted.push(name), true),
	});
	await import('@/service-worker');
});

afterAll(() => {
	vi.unstubAllGlobals();
	globalThis.self = realSelf;
});

/** A runtime rule by its cache's name. */
const rule = (cacheName: string) =>
	serwist.options.runtimeCaching.find((r: any) => r.handler.options.cacheName === cacheName);

const navigation = (href: string) => {
	const rule = serwist.options.runtimeCaching.find((r: any) => typeof r.matcher === 'function');
	return rule.matcher({ request: { mode: 'navigate' }, url: new URL(href) });
};

describe('service worker', () => {
	it('removes the previous worker precache', () => {
		expect(serwist.options.precacheOptions.cleanupOutdatedCaches).toBe(true);
		expect(serwist.options.skipWaiting).toBe(true);
		expect(serwist.options.clientsClaim).toBe(true);
	});

	it('deletes next-pwa runtime caches and the previous build documents on activate', async () => {
		let settled: Promise<unknown> = Promise.resolve();
		serwist.handlers.activate({ waitUntil: (p: Promise<unknown>) => (settled = p) });
		await settled;
		expect(deleted).toEqual(
			expect.arrayContaining(['start-url', 'next-data', 'others', 'pages'])
		);
	});

	it('caches application documents but never API navigations', () => {
		expect(navigation('https://debridmediamanager.com/library')).toBe(true);
		expect(navigation('https://debridmediamanager.com/api/torznab/rd?apikey=x')).toBe(false);
		expect(navigation('https://debridmediamanager.com/api')).toBe(false);
		expect(navigation('https://elsewhere.example/library')).toBe(false);
	});

	it('bounds the document cache', () => {
		const pages = rule('pages').handler.options;
		expect(pages.cacheName).toBe('pages');
		expect(pages.plugins.find((p: any) => p.config)?.config.maxEntries).toBeGreaterThan(0);
	});

	it('stores only successful HTML documents', async () => {
		const guard = rule('pages').handler.options.plugins.find((p: any) => p.cacheWillUpdate);
		const response = (status: number, type: string, url = 'https://debridmediamanager.com/x') =>
			({ status, url, headers: new Headers({ 'content-type': type }) }) as Response;
		expect(await guard.cacheWillUpdate({ response: response(200, 'text/html') })).toBeTruthy();
		expect(await guard.cacheWillUpdate({ response: response(500, 'text/html') })).toBeNull();
		expect(
			await guard.cacheWillUpdate({ response: response(200, 'application/json') })
		).toBeNull();
		expect(
			await guard.cacheWillUpdate({
				response: response(200, 'text/html', 'https://debridmediamanager.com/api/x'),
			})
		).toBeNull();
	});

	it('keeps album covers on the posters hosts in a cache of 500 of their own, before posters', () => {
		const albumArt = rule('album-art');
		const cover =
			'https://posters2.debridmediamanager.com/music-48e8b712-4f5d-34e0-9492-22f936854662.jpg';
		expect(albumArt.matcher.test(cover)).toBe(true);
		expect(albumArt.matcher.test('https://posters3.debridmediamanager.com/tt1-small.jpg')).toBe(
			false
		);
		expect(albumArt.matcher.test('https://example.com/music-1.jpg')).toBe(false);
		// Serwist takes the first rule that matches.
		expect(serwist.options.runtimeCaching.find((r: any) => r.matcher.test?.(cover))).toBe(
			albumArt
		);
		expect(albumArt.handler.options.plugins[0].config).toEqual({
			maxEntries: 500,
			maxAgeSeconds: 60 * 60 * 24 * 30,
		});
	});

	it('keeps the poster cache to 200 images for 30 days', () => {
		const posters = rule('poster-images');
		expect(posters.matcher.test('https://posters3.debridmediamanager.com/tt1-small.jpg')).toBe(
			true
		);
		const { config } = posters.handler.options.plugins[0];
		expect(config).toEqual({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 });
	});

	it('falls back to the offline page for documents', () => {
		const [entry] = serwist.options.fallbacks.entries;
		expect(entry.url).toBe('/_offline');
		expect(entry.matcher({ request: { destination: 'document' } })).toBe(true);
		expect(entry.matcher({ request: { destination: 'image' } })).toBe(false);
	});

	it('refuses to cache an API URL sent by a page', () => {
		const posted: unknown[] = [];
		serwist.handlers.message({
			data: { type: 'CACHE_APP_DOCUMENT', url: 'https://debridmediamanager.com/api/x' },
			waitUntil: (p: unknown) => posted.push(p),
		});
		expect(posted).toEqual([]);
	});
});
