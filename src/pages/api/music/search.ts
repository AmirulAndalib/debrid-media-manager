import {
	albumSearchSql,
	MUSIC_SORTS,
	MusicAlbum,
	MusicArtistHit,
	MusicTrack,
	queryAlbums,
	searchArtists,
	trackSearchSql,
	withPackFlags,
	withTracks,
} from '@/services/musicCatalog';
import { prisma } from '@/utils/prisma';
import { Prisma } from '@prisma/client';
import { NextApiRequest, NextApiResponse } from 'next';

export interface MusicSearchResponse {
	artists: MusicArtistHit[];
	/** Summaries: `tracks` is empty. */
	albums: MusicAlbum[];
	/** `album` is a summary of the album the track plays from. */
	tracks: { track: MusicTrack; album: MusicAlbum }[];
}

/** `GET /api/music/search?q=&limit=` (limit 1-50, default 20): artists, albums and tracks, best match first. */
export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<MusicSearchResponse | { error: string }>
) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
	if (!q) {
		return res.status(400).json({ error: 'Missing q' });
	}
	const limit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 20, 1), 50);

	try {
		const albumSearch = albumSearchSql(q);
		const trackSearch = trackSearchSql(q);
		const [albums, artists, trackHits] = await Promise.all([
			queryAlbums({
				filters: [albumSearch],
				// Fulltext relevance, then name; a LIKE match is 1 for every row.
				order: Prisma.sql`${albumSearch} DESC, ${MUSIC_SORTS.name}`,
				limit,
			}).then(({ albums }) => withPackFlags(albums)),
			searchArtists(albumSearch, limit),
			// Disc 0 holds titles of other releases, not the album's own tracklist.
			prisma.$queryRaw<{ mbid: string; title: string; lengthMs: number | null }[]>(
				Prisma.sql`SELECT t.mbid, t.title, t.lengthMs
				FROM MusicTrackMetadata t
				WHERE t.disc > 0 AND ${trackSearch}
				ORDER BY ${trackSearch} DESC, t.mbid, t.disc, t.position
				LIMIT ${limit}`
			),
		]);

		// The files of each hit's album, matched to its tracklist the way the album page does.
		const mbids = [...new Set(trackHits.map((hit) => hit.mbid))];
		const hitAlbums = mbids.length
			? await withTracks(
					(
						await queryAlbums({
							filters: [Prisma.sql`b.mbid IN (${Prisma.join(mbids)})`],
							order: MUSIC_SORTS.name,
							limit: mbids.length,
						})
					).albums
				)
			: [];
		const tracks = trackHits.flatMap((hit) => {
			const album = hitAlbums.find((candidate) => candidate.mbid === hit.mbid);
			const track = album?.tracks.find(
				(candidate) =>
					candidate.title === hit.title && candidate.durationMs === hit.lengthMs
			);
			return album && track ? [{ track, album: { ...album, tracks: [] } }] : [];
		});

		res.status(200).json({ artists, albums, tracks });
	} catch (error) {
		console.error('Error searching music:', error);
		res.status(500).json({ error: 'Failed to search music' });
	}
}
