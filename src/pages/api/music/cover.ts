import { caaCoverUrl, hasCaaCover, servedCoverUrl } from '@/services/musicBrainz';
import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

interface CoverResponse {
	coverUrl: string | null;
	source?: string;
}

interface iTunesResult {
	artworkUrl100?: string;
	artworkUrl60?: string;
	collectionName?: string;
	artistName?: string;
}

interface iTunesSearchResponse {
	resultCount: number;
	results: iTunesResult[];
}

// Search iTunes for album artwork
async function searchItunesCover(artist: string, album: string): Promise<string | null> {
	try {
		// Clean up search terms - remove common suffixes like "(Remastered)", etc.
		const cleanAlbum = album
			.replace(/\s*\(.*?\)\s*/g, '')
			.replace(/\s*\[.*?\]\s*/g, '')
			.trim();
		const cleanArtist = artist.trim();

		const searchTerm = `${cleanArtist} ${cleanAlbum}`;
		const encodedSearch = encodeURIComponent(searchTerm);

		const response = await fetch(
			`https://itunes.apple.com/search?term=${encodedSearch}&entity=album&limit=5`,
			{ headers: { Accept: 'application/json' } }
		);

		if (!response.ok) {
			console.error(`iTunes API error: ${response.status}`);
			return null;
		}

		const data: iTunesSearchResponse = await response.json();

		if (data.resultCount === 0 || !data.results.length) {
			// Try with just the album name
			const albumOnlyResponse = await fetch(
				`https://itunes.apple.com/search?term=${encodeURIComponent(cleanAlbum)}&entity=album&limit=5`,
				{ headers: { Accept: 'application/json' } }
			);

			if (!albumOnlyResponse.ok) return null;

			const albumOnlyData: iTunesSearchResponse = await albumOnlyResponse.json();
			if (albumOnlyData.resultCount === 0) return null;

			// Find best match by artist name similarity
			const bestMatch =
				albumOnlyData.results.find((r) =>
					r.artistName?.toLowerCase().includes(cleanArtist.toLowerCase().split(' ')[0])
				) || albumOnlyData.results[0];

			if (bestMatch?.artworkUrl100) {
				// Get higher resolution (600x600)
				return bestMatch.artworkUrl100.replace('100x100', '600x600');
			}
			return null;
		}

		// Get the first result's artwork URL and upscale it
		const artwork = data.results[0]?.artworkUrl100;
		if (artwork) {
			// Replace 100x100 with 600x600 for higher resolution
			return artwork.replace('100x100', '600x600');
		}

		return null;
	} catch (error) {
		console.error('iTunes search error:', error);
		return null;
	}
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<CoverResponse | { error: string }>
) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const { mbid, artist, album } = req.body;

	if (!mbid || !artist || !album) {
		return res.status(400).json({ error: 'Missing required fields: mbid, artist, album' });
	}

	try {
		const existing = await prisma.musicMetadata.findUnique({
			where: { mbid },
			select: { coverUrl: true, coverSource: true },
		});

		if (existing?.coverUrl && existing.coverSource === 'caa') {
			return res
				.status(200)
				.json({ coverUrl: servedCoverUrl(existing.coverUrl), source: 'cached' });
		}

		// The Cover Art Archive files art under this very release group, so it
		// replaces a stored iTunes guess, which comes from a text search and is
		// sometimes another album's.
		if (await hasCaaCover(mbid)) {
			const coverUrl = caaCoverUrl(mbid);
			await prisma.musicMetadata.update({
				where: { mbid },
				data: { coverUrl, coverSource: 'caa' },
			});
			return res.status(200).json({ coverUrl: servedCoverUrl(coverUrl), source: 'caa' });
		}

		if (existing?.coverUrl) {
			return res
				.status(200)
				.json({ coverUrl: servedCoverUrl(existing.coverUrl), source: 'cached' });
		}

		const coverUrl = await searchItunesCover(artist, album);

		if (coverUrl) {
			await prisma.musicMetadata.update({
				where: { mbid },
				data: { coverUrl, coverSource: 'itunes' },
			});

			return res.status(200).json({ coverUrl, source: 'itunes' });
		}

		return res.status(200).json({ coverUrl: null });
	} catch (error) {
		console.error('Error fetching cover:', error);
		return res.status(500).json({ error: 'Failed to fetch cover' });
	}
}
