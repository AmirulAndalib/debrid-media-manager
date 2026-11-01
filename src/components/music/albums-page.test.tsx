import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerMock = {
	query: {} as Record<string, string[]>,
	push: vi.fn(),
};

vi.mock('next/router', () => ({ __esModule: true, useRouter: () => routerMock }));
vi.mock('next/head', () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/auth', () => ({
	useRealDebridAccessToken: () => ['rd-token', false, false],
}));

import AlbumsPage from '@/pages/albums/[[...slug]]';

const track = (fileId: number, filename: string) => ({
	id: `h1-${fileId}`,
	hash: 'h1',
	fileId,
	link: `https://real-debrid.com/d/${fileId}`,
	path: `/${filename}`,
	bytes: 8 * 1024 * 1024,
	trackNumber: fileId,
	filename,
});

const summary = {
	hash: 'h1',
	mbid: 'mb1',
	artist: 'Test Artist',
	album: 'First Album',
	year: 2020,
	coverUrl: 'https://covers.example/h1.jpg',
	tracks: [],
	totalBytes: 16 * 1024 * 1024,
	trackCount: 2,
};
const fullAlbum = {
	...summary,
	tracks: [track(1, '01 - Opening.flac'), track(2, '02 - Closing.flac')],
};

const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
	if (url === '/api/music/unrestrict') {
		return json({ streamUrl: `https://cdn.example/${JSON.parse(String(init?.body)).fileId}` });
	}
	if (url.includes('hash=')) return json({ albums: [fullAlbum], totalAlbums: 1, totalTracks: 2 });
	if (url.includes('search=')) {
		return json({ albums: [summary], totalAlbums: 11, totalTracks: 260, hasMore: false });
	}
	return json({ albums: [summary], totalAlbums: 120, totalTracks: 1500, hasMore: false });
});

describe('music page', () => {
	const spies: { mockRestore: () => void }[] = [];
	beforeEach(() => {
		localStorage.clear();
		routerMock.query = {};
		vi.stubGlobal('fetch', fetchMock);
		spies.push(
			vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
				this: HTMLMediaElement
			) {
				this.dispatchEvent(new Event('play'));
				return Promise.resolve();
			}),
			vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
		);
	});
	afterEach(() => {
		spies.splice(0).forEach((spy) => spy.mockRestore());
		vi.unstubAllGlobals();
		fetchMock.mockClear();
	});

	it('pads the sidebar list while a track is loaded so the player bar covers none of it', async () => {
		localStorage.setItem(
			'music:player',
			JSON.stringify({
				queue: {
					contextId: 'album:h1',
					context: [{ track: fullAlbum.tracks[0], album: summary }],
					contextIndex: 0,
					originalOrder: [],
					priority: [],
					priorityItem: null,
				},
				repeatMode: 'off',
				isShuffled: false,
				volume: 1,
			})
		);
		render(<AlbumsPage />);
		const sidebarList = (await screen.findByText('Recently added')).parentElement!;
		expect(sidebarList).toHaveClass('pb-32');

		fireEvent.keyDown(window, { key: 'q' });
		fireEvent.click(await screen.findByTitle('Clear queue'));
		expect(screen.queryByRole('button', { name: 'Next track' })).toBeNull();
		expect(sidebarList).not.toHaveClass('pb-32');
	});

	it('plays an album through the player provider and saves the queue', async () => {
		routerMock.query = { slug: ['h1'] };
		const { container } = render(<AlbumsPage />);
		fireEvent.click(await screen.findByRole('button', { name: 'Play' }));

		await waitFor(() =>
			expect(container.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example/1')
		);
		expect(await screen.findAllByRole('button', { name: 'Next track' })).not.toHaveLength(0);
		const saved = JSON.parse(localStorage.getItem('music:player')!);
		expect(saved.queue.contextId).toBe('album:h1');
		expect(saved.queue.context).toHaveLength(2);
	});
});
