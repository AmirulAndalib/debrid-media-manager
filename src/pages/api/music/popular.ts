import { resolveMusicRows, type MusicTrackRow } from '@/utils/musicRows';
import { isMbid, queryInt } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface MusicPopularItem extends MusicTrackRow {
	hash: string;
	fileId: number;
	mbid: string;
	/** Plays by every user over the last 90 days. */
	plays: number;
}

/** GET ?artistMbid&limit (default 10, max 50). Only tracks that can still play. */
export interface MusicPopularResponse {
	items: MusicPopularItem[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const artistMbid = req.query.artistMbid;
	if (!isMbid(artistMbid)) {
		return res.status(400).json({ error: 'artistMbid is required' });
	}
	const limit = queryInt(req.query.limit, 10, 50);

	try {
		const albums = await prisma.musicMetadata.findMany({
			where: { artistMbid },
			select: { mbid: true },
		});
		const groups =
			albums.length === 0
				? []
				: await prisma.musicPlayHistory.groupBy({
						by: ['hash', 'fileId', 'mbid'],
						where: {
							mbid: { in: albums.map((a) => a.mbid) },
							playedAt: { gte: new Date(Date.now() - WINDOW_MS) },
						},
						_count: { _all: true },
						orderBy: { _count: { fileId: 'desc' } },
						// Headroom for tracks that are gone or blocked.
						take: limit * 2,
					});
		const rows = await resolveMusicRows(groups);
		const body: MusicPopularResponse = {
			items: groups
				.map((g, i) => ({
					hash: g.hash,
					fileId: g.fileId,
					mbid: g.mbid,
					plays: g._count._all,
					...rows[i],
				}))
				.filter((item) => item.track)
				.slice(0, limit),
		};
		return res.status(200).json(body);
	} catch (error) {
		console.error('Music popular failed:', error);
		return res.status(500).json({ error: 'Failed to read popular tracks' });
	}
}
