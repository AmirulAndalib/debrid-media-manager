import { isMbid, requireMusicUser } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';
import { NextApiRequest, NextApiResponse } from 'next';

/** PUT follows, DELETE unfollows. Both idempotent, 204. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'PUT' && req.method !== 'DELETE') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userId = requireMusicUser(req, res);
	if (!userId) return;
	const artistMbid = req.query.mbid;
	if (!isMbid(artistMbid)) {
		return res.status(400).json({ error: 'Invalid mbid' });
	}

	try {
		if (req.method === 'PUT') {
			await prisma.musicFollowedArtist.createMany({
				data: { userId, artistMbid },
				skipDuplicates: true,
			});
		} else {
			await prisma.musicFollowedArtist.deleteMany({ where: { userId, artistMbid } });
		}
		return res.status(204).end();
	} catch (error) {
		console.error('Music artists update failed:', error);
		return res.status(500).json({ error: 'Failed to update artists' });
	}
}
