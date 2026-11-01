import { playlistSummaries, type MusicPlaylistSummary } from '@/utils/musicRows';
import { parsePlaylistFields, requireMusicUser } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

/** POST body. */
export interface MusicPlaylistCreateRequest {
	name: string;
	description?: string | null;
}

/** GET answer, most recently updated first. POST answers 201 with one MusicPlaylistSummary. */
export interface MusicPlaylistsResponse {
	playlists: MusicPlaylistSummary[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userId = requireMusicUser(req, res);
	if (!userId) return;

	try {
		if (req.method === 'GET') {
			const playlists = await prisma.musicPlaylist.findMany({
				where: { userId },
				orderBy: { updatedAt: 'desc' },
			});
			const body: MusicPlaylistsResponse = { playlists: await playlistSummaries(playlists) };
			return res.status(200).json(body);
		}

		const fields = parsePlaylistFields(req.body, false);
		if (!fields?.name) {
			return res
				.status(400)
				.json({ error: 'name must be 1-200 characters, description up to 1000' });
		}
		const playlist = await prisma.musicPlaylist.create({
			data: { userId, name: fields.name, description: fields.description ?? null },
		});
		const [summary] = await playlistSummaries([playlist]);
		return res.status(201).json(summary);
	} catch (error) {
		console.error('Music playlists failed:', error);
		return res.status(500).json({ error: 'Failed to read or create playlists' });
	}
}
