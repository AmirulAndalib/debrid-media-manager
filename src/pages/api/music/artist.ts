import { isMbid } from '@/services/musicBrainz';
import { MUSIC_SORTS, MusicAlbum, queryAlbums, withPackFlags } from '@/services/musicCatalog';
import { prisma } from '@/utils/prisma';
import { Prisma } from '@prisma/client';
import { NextApiRequest, NextApiResponse } from 'next';

export interface MusicArtistResponse {
	artist: { mbid: string; name: string; sortName?: string };
	/** Summaries, newest first; group them by `primaryType`. */
	albums: MusicAlbum[];
}

// ponytail: one unpaged list; page it if an artist ever has more albums than this.
const MAX_ALBUMS = 500;

/** `GET /api/music/artist?mbid=`: the artist and every album of theirs in the catalog. */
export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<MusicArtistResponse | { error: string }>
) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const mbid = req.query.mbid;
	if (!isMbid(mbid)) {
		return res.status(400).json({ error: 'mbid must be a MusicBrainz id' });
	}

	try {
		const [artist, albums] = await Promise.all([
			prisma.musicArtist.findUnique({ where: { mbid } }),
			queryAlbums({
				filters: [Prisma.sql`md.artistMbid = ${mbid}`],
				order: MUSIC_SORTS.year,
				limit: MAX_ALBUMS,
			}).then(({ albums }) => withPackFlags(albums)),
		]);
		if (!albums.length) {
			return res.status(404).json({ error: 'Artist not found' });
		}
		res.status(200).json({
			artist: artist
				? { mbid, name: artist.name, sortName: artist.sortName }
				: { mbid, name: albums[0].artist },
			albums,
		});
	} catch (error) {
		console.error('Error fetching music artist:', error);
		res.status(500).json({ error: 'Failed to fetch artist' });
	}
}
