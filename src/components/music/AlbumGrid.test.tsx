import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AlbumGrid from './AlbumGrid';

const makeAlbum = (overrides = {}) => ({
	hash: 'abc123',
	mbid: 'mbid-1',
	artistMbid: null,
	artist: 'Test Artist',
	album: 'Test Album',
	year: 2023,
	coverUrl: null,
	tracks: [],
	totalBytes: 100 * 1024 * 1024,
	trackCount: 10,
	...overrides,
});

describe('AlbumGrid', () => {
	it('renders album cards', () => {
		render(
			<AlbumGrid
				albums={[makeAlbum(), makeAlbum({ hash: 'def456', album: 'Another Album' })]}
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="recent"
				onSortChange={vi.fn()}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);
		expect(screen.getByText('Test Album')).toBeInTheDocument();
		expect(screen.getByText('Another Album')).toBeInTheDocument();
	});

	it('shows empty state when no albums', () => {
		render(
			<AlbumGrid
				albums={[]}
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="recent"
				onSortChange={vi.fn()}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);
		expect(screen.getByText('No music in the catalog yet')).toBeInTheDocument();
	});

	it('renders sort buttons', () => {
		render(
			<AlbumGrid
				albums={[]}
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="recent"
				onSortChange={vi.fn()}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);
		expect(screen.getByTitle('Sort by Recent')).toBeInTheDocument();
		expect(screen.getByTitle('Sort by Name')).toBeInTheDocument();
		expect(screen.getByTitle('Sort by Artist')).toBeInTheDocument();
		expect(screen.getByTitle('Sort by Year')).toBeInTheDocument();
	});

	it('calls onSortChange when sort button clicked', async () => {
		const onSortChange = vi.fn();
		render(
			<AlbumGrid
				albums={[]}
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="recent"
				onSortChange={onSortChange}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);

		await userEvent.setup().click(screen.getByTitle('Sort by Name'));
		expect(onSortChange).toHaveBeenCalledWith('name');
	});

	it('highlights active sort button', () => {
		render(
			<AlbumGrid
				albums={[]}
				onSelect={vi.fn()}
				onPlay={vi.fn()}
				sortBy="artist"
				onSortChange={vi.fn()}
				nowPlayingAlbumHash={null}
				isPlaying={false}
			/>
		);
		const artistBtn = screen.getByTitle('Sort by Artist');
		expect(artistBtn.className).toContain('text-green-500');
	});

	// Before the MusicBrainz backfill no album has a type: a chip would filter to nothing.
	it('shows release-type chips once an album has a type, and filters by them', () => {
		const onTypeChange = vi.fn();
		const props = {
			onSelect: vi.fn(),
			onPlay: vi.fn(),
			sortBy: 'name' as const,
			onSortChange: vi.fn(),
			nowPlayingAlbumHash: null,
			isPlaying: false,
			onTypeChange,
		};
		const { rerender } = render(<AlbumGrid {...props} albums={[makeAlbum()]} />);
		expect(screen.queryByRole('group', { name: 'Release type' })).toBeNull();

		rerender(<AlbumGrid {...props} albums={[makeAlbum({ primaryType: 'Album' })]} />);
		const chips = screen.getByRole('group', { name: 'Release type' });
		expect(screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(
			expect.arrayContaining(['Albums', 'EPs', 'Singles', 'Compilations'])
		);
		expect(chips).toHaveTextContent('AlbumsEPsSinglesCompilationsAll');
		screen.getByRole('button', { name: 'EPs' }).click();
		expect(onTypeChange).toHaveBeenCalledWith('ep');

		// A chosen type stays changeable when it matches nothing.
		rerender(<AlbumGrid {...props} albums={[]} type="ep" />);
		expect(screen.getByRole('button', { name: 'EPs' })).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
	});
});
