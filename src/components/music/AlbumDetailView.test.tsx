import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AlbumDetailView from './AlbumDetailView';

const makeTrack = (id: string, filename: string, trackNumber: number) => ({
	id,
	hash: 'abc123',
	fileId: trackNumber,
	link: `https://example.com/link-${id}`,
	path: `/music/${filename}`,
	bytes: 30 * 1024 * 1024,
	trackNumber,
	filename,
});

const makeAlbum = (overrides = {}) => ({
	hash: 'abc123',
	mbid: 'mbid-1',
	artist: 'Test Artist',
	album: 'Test Album',
	year: 2023,
	coverUrl: null as string | null,
	tracks: [makeTrack('t1', '01 - First.flac', 1), makeTrack('t2', '02 - Second.flac', 2)],
	totalBytes: 60 * 1024 * 1024,
	trackCount: 2,
	...overrides,
});

const defaultProps = () => ({
	album: makeAlbum(),
	currentTrack: null,
	playerState: {
		isPlaying: false,
		currentTime: 0,
		duration: 0,
		volume: 1,
		isMuted: false,
		isLoading: false,
		repeatMode: 'off' as const,
		isShuffled: false,
	},
	onPlay: vi.fn(),
	onAddToQueue: vi.fn(),
	onPlayNext: vi.fn(),
	onPlayTrackNext: vi.fn(),
	onBack: vi.fn(),
	onDownload: vi.fn(),
	onDownloadAlbum: vi.fn(),
});

describe('AlbumDetailView', () => {
	it('renders album name and artist', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.getByText('Test Album')).toBeInTheDocument();
		// Artist appears multiple times (header + each track row)
		const artists = screen.getAllByText('Test Artist');
		expect(artists.length).toBeGreaterThanOrEqual(1);
	});

	it('renders year and track count', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.getByText('2023')).toBeInTheDocument();
		expect(screen.getByText('2 songs')).toBeInTheDocument();
	});

	it('renders total size', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.getByText('60.0 MB')).toBeInTheDocument();
	});

	it('heads the last column Time once tracks carry durations', () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} />);
		expect(screen.getByText('Size')).toBeInTheDocument();
		props.album = makeAlbum({
			tracks: props.album.tracks.map((t) => ({ ...t, durationMs: 61_000 })),
		});
		render(<AlbumDetailView {...props} />);
		expect(screen.getByText('Time')).toBeInTheDocument();
		expect(screen.getAllByText('1:01')).toHaveLength(2);
	});

	it('renders all tracks', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.getByText('First')).toBeInTheDocument();
		expect(screen.getByText('Second')).toBeInTheDocument();
	});

	it('calls onBack when Back button clicked', async () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} />);
		await userEvent.setup().click(screen.getByText('Back to Albums'));
		expect(props.onBack).toHaveBeenCalledTimes(1);
	});

	it('calls onPlay when Play button clicked', async () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} />);
		// The main Play button
		const playButtons = screen.getAllByText('Play');
		await userEvent.setup().click(playButtons[0]);
		expect(props.onPlay).toHaveBeenCalledWith(props.album);
	});

	it('calls onAddToQueue when Add to Queue clicked', async () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} />);
		await userEvent.setup().click(screen.getByText('Add to Queue'));
		expect(props.onAddToQueue).toHaveBeenCalledWith(props.album);
	});

	it('opens the confirmation dialog instead of downloading when Download Album clicked', async () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} />);
		await userEvent.setup().click(screen.getByText('Download Album'));
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Download this album?')).toBeInTheDocument();
		expect(props.onDownloadAlbum).not.toHaveBeenCalled();
	});

	it('calls onDownloadAlbum only after the dialog is confirmed', async () => {
		const props = defaultProps();
		const user = userEvent.setup();
		render(<AlbumDetailView {...props} />);
		await user.click(screen.getByText('Download Album'));
		await user.click(screen.getByRole('button', { name: 'Download 2 tracks' }));
		expect(props.onDownloadAlbum).toHaveBeenCalledWith(props.album);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('does not download when the dialog is cancelled', async () => {
		const props = defaultProps();
		const user = userEvent.setup();
		render(<AlbumDetailView {...props} />);
		await user.click(screen.getByText('Download Album'));
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(props.onDownloadAlbum).not.toHaveBeenCalled();
	});

	// The button row must not shift when playback starts.
	it('shows Play Next before anything has played', () => {
		render(<AlbumDetailView {...defaultProps()} />);
		expect(screen.getByText('Play Next')).toBeInTheDocument();
		expect(screen.getAllByTitle('Play next')).toHaveLength(2);
	});

	it('calls onPlayNext when Play Next clicked', async () => {
		const props = defaultProps();
		render(<AlbumDetailView {...props} />);
		await userEvent.setup().click(screen.getByText('Play Next'));
		expect(props.onPlayNext).toHaveBeenCalledWith(props.album);
	});

	it('renders cover image when coverUrl is provided', () => {
		const props = defaultProps();
		props.album = makeAlbum({ coverUrl: 'https://example.com/cover.jpg' });
		render(<AlbumDetailView {...props} />);
		const img = screen.getByAltText('Test Album');
		expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
	});

	it('does not render year when null', () => {
		const props = defaultProps();
		props.album = makeAlbum({ year: null });
		render(<AlbumDetailView {...props} />);
		expect(screen.queryByText('2023')).not.toBeInTheDocument();
	});
});
