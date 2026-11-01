import {
	playlistSummaries,
	resolveMusicRows,
	type MusicPlaylistSummary,
	type MusicTrackRow,
} from '@/utils/musicRows';
import { parsePlaylistFields, requireMusicUser } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

/** PATCH body: at least one field; `description: null` clears it. */
export interface MusicPlaylistUpdateRequest {
	name?: string;
	description?: string | null;
}

export interface MusicPlaylistTrackItem extends MusicTrackRow {
	/** Playlist entry id, used by DELETE and PUT on ./tracks. */
	id: string;
	position: number;
	addedAt: string;
	hash: string;
	fileId: number;
	mbid: string;
}

/** GET answer. PATCH answers with a MusicPlaylistSummary, DELETE with 204. */
export interface MusicPlaylistDetail extends MusicPlaylistSummary {
	tracks: MusicPlaylistTrackItem[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'DELETE') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userId = requireMusicUser(req, res);
	if (!userId) return;
	const id = req.query.id;
	if (typeof id !== 'string') return res.status(404).json({ error: 'Playlist not found' });

	try {
		const playlist = await prisma.musicPlaylist.findUnique({ where: { id } });
		if (!playlist || playlist.userId !== userId) {
			return res.status(404).json({ error: 'Playlist not found' });
		}

		if (req.method === 'GET') {
			const tracks = await prisma.musicPlaylistTrack.findMany({
				where: { playlistId: id },
				orderBy: { position: 'asc' },
			});
			const rows = await resolveMusicRows(tracks);
			const body: MusicPlaylistDetail = {
				id,
				name: playlist.name,
				description: playlist.description,
				trackCount: tracks.length,
				coverUrl: rows[0]?.album?.coverUrl ?? null,
				updatedAt: playlist.updatedAt.toISOString(),
				tracks: tracks.map((track, i) => ({
					id: track.id,
					position: track.position,
					addedAt: track.addedAt.toISOString(),
					hash: track.hash,
					fileId: track.fileId,
					mbid: track.mbid,
					...rows[i],
				})),
			};
			return res.status(200).json(body);
		}

		if (req.method === 'PATCH') {
			const fields = parsePlaylistFields(req.body, true);
			if (!fields) {
				return res
					.status(400)
					.json({ error: 'name must be 1-200 characters, description up to 1000' });
			}
			const updated = await prisma.musicPlaylist.update({ where: { id }, data: fields });
			const [summary] = await playlistSummaries([updated]);
			return res.status(200).json(summary);
		}

		await prisma.$transaction([
			prisma.musicPlaylistTrack.deleteMany({ where: { playlistId: id } }),
			prisma.musicPlaylist.delete({ where: { id } }),
		]);
		return res.status(204).end();
	} catch (error) {
		console.error('Music playlist failed:', error);
		return res.status(500).json({ error: 'Failed to read or change the playlist' });
	}
}
