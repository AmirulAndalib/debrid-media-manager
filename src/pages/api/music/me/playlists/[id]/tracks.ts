import { parseTrackRef, requireMusicUser, type MusicTrackRef } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

export const MAX_PLAYLIST_TRACKS = 10_000;

/** POST body: appends, or inserts before the track now at index `position` (0-based). */
export interface MusicPlaylistAddRequest {
	tracks: MusicTrackRef[];
	position?: number;
}

/** POST answers 201 with the new length. DELETE and PUT answer 204. */
export interface MusicPlaylistAddResponse {
	trackCount: number;
}

/** DELETE body: playlist entry ids (MusicPlaylistTrackItem.id). */
export interface MusicPlaylistRemoveRequest {
	trackIds: string[];
}

/** PUT body: every current entry id exactly once, in the new order. */
export interface MusicPlaylistReorderRequest {
	order: string[];
}

const isIdList = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.length <= MAX_PLAYLIST_TRACKS &&
	value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 191);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'POST' && req.method !== 'DELETE' && req.method !== 'PUT') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userId = requireMusicUser(req, res);
	if (!userId) return;
	const playlistId = req.query.id;
	if (typeof playlistId !== 'string')
		return res.status(404).json({ error: 'Playlist not found' });

	try {
		const playlist = await prisma.musicPlaylist.findUnique({
			where: { id: playlistId },
			select: { userId: true },
		});
		if (!playlist || playlist.userId !== userId) {
			return res.status(404).json({ error: 'Playlist not found' });
		}
		// Prisma queries are lazy: this runs only inside a $transaction below.
		const touch = prisma.musicPlaylist.update({
			where: { id: playlistId },
			data: { updatedAt: new Date() },
		});

		if (req.method === 'POST') {
			const raw = req.body?.tracks;
			const tracks = Array.isArray(raw) ? raw.map(parseTrackRef) : [];
			const position = req.body?.position;
			if (
				tracks.length === 0 ||
				tracks.some((track) => !track) ||
				(position !== undefined && (!Number.isInteger(position) || position < 0))
			) {
				return res.status(400).json({
					error: 'Body must be { tracks: [{ hash, fileId, mbid }], position? }',
				});
			}
			const count = await prisma.musicPlaylistTrack.count({ where: { playlistId } });
			if (count + tracks.length > MAX_PLAYLIST_TRACKS) {
				return res
					.status(400)
					.json({ error: `A playlist holds at most ${MAX_PLAYLIST_TRACKS} tracks` });
			}
			const inserting = position !== undefined && position < count;
			// Positions may have gaps, so find the value at that index rather than trust the index.
			const anchor = await prisma.musicPlaylistTrack.findFirst({
				where: { playlistId },
				orderBy: { position: inserting ? 'asc' : 'desc' },
				skip: inserting ? position : 0,
				select: { position: true },
			});
			const start = !anchor ? 0 : inserting ? anchor.position : anchor.position + 1;
			await prisma.$transaction([
				...(inserting
					? [
							prisma.musicPlaylistTrack.updateMany({
								where: { playlistId, position: { gte: start } },
								data: { position: { increment: tracks.length } },
							}),
						]
					: []),
				prisma.musicPlaylistTrack.createMany({
					data: tracks.map((track, i) => ({
						playlistId,
						position: start + i,
						...track!,
					})),
				}),
				touch,
			]);
			const body: MusicPlaylistAddResponse = { trackCount: count + tracks.length };
			return res.status(201).json(body);
		}

		if (req.method === 'DELETE') {
			const trackIds = req.body?.trackIds;
			if (!isIdList(trackIds)) {
				return res.status(400).json({ error: 'Body must be { trackIds: [id] }' });
			}
			await prisma.$transaction([
				prisma.musicPlaylistTrack.deleteMany({
					where: { playlistId, id: { in: trackIds } },
				}),
				touch,
			]);
			return res.status(204).end();
		}

		const order = req.body?.order;
		const current = await prisma.musicPlaylistTrack.findMany({
			where: { playlistId },
			select: { id: true, position: true },
		});
		const positionById = new Map(current.map((track) => [track.id, track.position]));
		if (
			!isIdList(order) ||
			order.length !== current.length ||
			new Set(order).size !== order.length ||
			!order.every((id) => positionById.has(id))
		) {
			return res
				.status(400)
				.json({ error: 'order must list every track id of the playlist exactly once' });
		}
		await prisma.$transaction([
			...order.flatMap((id, position) =>
				positionById.get(id) === position
					? []
					: [prisma.musicPlaylistTrack.update({ where: { id }, data: { position } })]
			),
			touch,
		]);
		return res.status(204).end();
	} catch (error) {
		console.error('Music playlist tracks failed:', error);
		return res.status(500).json({ error: 'Failed to change the playlist tracks' });
	}
}
