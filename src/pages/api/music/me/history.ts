import {
	resolveAlbumSummaries,
	resolveMusicRows,
	type MusicAlbumSummary,
	type MusicTrackRow,
} from '@/utils/musicRows';
import { parseTrackRef, queryInt, requireMusicUser } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

/** POST body, sent once per play. */
export interface MusicPlayRequest {
	hash: string;
	fileId: number;
	mbid: string;
}

export interface MusicHistoryItem extends MusicTrackRow {
	playedAt: string;
	hash: string;
	fileId: number;
	mbid: string;
}

/** GET ?limit (default 50, max 200), newest first. */
export interface MusicHistoryResponse {
	items: MusicHistoryItem[];
}

/** GET ?group=album&limit (default 20, max 100): albums by their last play. */
export interface MusicRecentAlbumsResponse {
	items: { mbid: string; lastPlayedAt: string; album: MusicAlbumSummary | null }[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userId = requireMusicUser(req, res);
	if (!userId) return;

	try {
		if (req.method === 'POST') {
			const ref = parseTrackRef(req.body);
			if (!ref) {
				return res.status(400).json({ error: 'Body must be { hash, fileId, mbid }' });
			}
			// Plays feed everyone's /api/music/popular, so the album must be the release's own.
			const release = await prisma.availableMusic.findUnique({
				where: { hash: ref.hash },
				select: { mbid: true },
			});
			if (release?.mbid !== ref.mbid) {
				return res.status(400).json({ error: 'Unknown track' });
			}
			await prisma.musicPlayHistory.create({ data: { userId, ...ref } });
			return res.status(204).end();
		}

		if (req.query.group === 'album') {
			const groups = await prisma.musicPlayHistory.groupBy({
				by: ['mbid'],
				where: { userId },
				_max: { playedAt: true },
				orderBy: { _max: { playedAt: 'desc' } },
				take: queryInt(req.query.limit, 20, 100),
			});
			const albums = await resolveAlbumSummaries(groups.map((g) => g.mbid));
			const body: MusicRecentAlbumsResponse = {
				items: groups.map((g) => ({
					mbid: g.mbid,
					lastPlayedAt: (g._max.playedAt ?? new Date(0)).toISOString(),
					album: albums.get(g.mbid) ?? null,
				})),
			};
			return res.status(200).json(body);
		}

		const plays = await prisma.musicPlayHistory.findMany({
			where: { userId },
			orderBy: { playedAt: 'desc' },
			take: queryInt(req.query.limit, 50, 200),
			select: { hash: true, fileId: true, mbid: true, playedAt: true },
		});
		const rows = await resolveMusicRows(plays);
		const body: MusicHistoryResponse = {
			items: plays.map((play, i) => ({
				playedAt: play.playedAt.toISOString(),
				hash: play.hash,
				fileId: play.fileId,
				mbid: play.mbid,
				...rows[i],
			})),
		};
		return res.status(200).json(body);
	} catch (error) {
		console.error('Music history failed:', error);
		return res.status(500).json({ error: 'Failed to read or record history' });
	}
}
