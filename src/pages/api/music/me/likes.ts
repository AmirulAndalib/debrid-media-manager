import { resolveMusicRows, type MusicTrackRow } from '@/utils/musicRows';
import { parseTrackRef, queryInt, requireMusicUser } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

/** PUT and DELETE body. */
export interface MusicLikeRequest {
	hash: string;
	fileId: number;
	mbid: string;
}

export interface MusicLikeItem extends MusicTrackRow {
	hash: string;
	fileId: number;
	mbid: string;
	likedAt: string;
}

/** GET ?page&limit (limit default 50, max 200). */
export interface MusicLikesResponse {
	items: MusicLikeItem[];
	total: number;
	hasMore: boolean;
}

/** GET ?ids=1: every liked track as `${hash}-${fileId}`, for rendering hearts. */
export interface MusicLikeIdsResponse {
	ids: string[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'PUT' && req.method !== 'DELETE') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userId = requireMusicUser(req, res);
	if (!userId) return;

	try {
		if (req.method === 'GET') {
			if (req.query.ids === '1') {
				const likes = await prisma.musicLike.findMany({
					where: { userId },
					select: { hash: true, fileId: true },
				});
				const body: MusicLikeIdsResponse = {
					ids: likes.map((like) => `${like.hash}-${like.fileId}`),
				};
				return res.status(200).json(body);
			}
			const page = queryInt(req.query.page, 1, 10_000);
			const limit = queryInt(req.query.limit, 50, 200);
			const [likes, total] = await Promise.all([
				prisma.musicLike.findMany({
					where: { userId },
					orderBy: { createdAt: 'desc' },
					skip: (page - 1) * limit,
					take: limit,
				}),
				prisma.musicLike.count({ where: { userId } }),
			]);
			const rows = await resolveMusicRows(likes);
			const body: MusicLikesResponse = {
				items: likes.map((like, i) => ({
					hash: like.hash,
					fileId: like.fileId,
					mbid: like.mbid,
					likedAt: like.createdAt.toISOString(),
					...rows[i],
				})),
				total,
				hasMore: page * limit < total,
			};
			return res.status(200).json(body);
		}

		const ref = parseTrackRef(req.body);
		if (!ref) {
			return res.status(400).json({ error: 'Body must be { hash, fileId, mbid }' });
		}
		if (req.method === 'PUT') {
			await prisma.musicLike.createMany({ data: { userId, ...ref }, skipDuplicates: true });
		} else {
			await prisma.musicLike.deleteMany({
				where: { userId, hash: ref.hash, fileId: ref.fileId },
			});
		}
		return res.status(204).end();
	} catch (error) {
		console.error('Music likes failed:', error);
		return res.status(500).json({ error: 'Failed to update likes' });
	}
}
