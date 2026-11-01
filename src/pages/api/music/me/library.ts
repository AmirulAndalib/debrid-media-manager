import {
	playlistSummaries,
	resolveAlbumSummaries,
	type MusicAlbumSummary,
	type MusicPlaylistSummary,
} from '@/utils/musicRows';
import { requireMusicUser } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

/** Saved albums and followed artists newest first, playlists most recently updated first. */
export interface MusicUserLibraryResponse {
	albums: { mbid: string; savedAt: string; album: MusicAlbumSummary | null }[];
	/** `name` is null when no album in the catalog carries that artist. */
	artists: { artistMbid: string; name: string | null; followedAt: string }[];
	playlists: MusicPlaylistSummary[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userId = requireMusicUser(req, res);
	if (!userId) return;

	try {
		const [saved, followed, playlists] = await Promise.all([
			prisma.musicSavedAlbum.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
			prisma.musicFollowedArtist.findMany({
				where: { userId },
				orderBy: { createdAt: 'desc' },
			}),
			prisma.musicPlaylist.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
		]);
		const [albums, artistRows, playlistItems] = await Promise.all([
			resolveAlbumSummaries(saved.map((s) => s.mbid)),
			followed.length === 0
				? []
				: prisma.musicMetadata.findMany({
						where: { artistMbid: { in: followed.map((f) => f.artistMbid) } },
						select: { artistMbid: true, artist: true },
					}),
			playlistSummaries(playlists),
		]);
		const nameByArtist = new Map(artistRows.map((row) => [row.artistMbid, row.artist]));
		const body: MusicUserLibraryResponse = {
			albums: saved.map((s) => ({
				mbid: s.mbid,
				savedAt: s.createdAt.toISOString(),
				album: albums.get(s.mbid) ?? null,
			})),
			artists: followed.map((f) => ({
				artistMbid: f.artistMbid,
				name: nameByArtist.get(f.artistMbid) ?? null,
				followedAt: f.createdAt.toISOString(),
			})),
			playlists: playlistItems,
		};
		return res.status(200).json(body);
	} catch (error) {
		console.error('Music user library failed:', error);
		return res.status(500).json({ error: 'Failed to read your library' });
	}
}
