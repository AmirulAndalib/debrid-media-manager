import { requireMusicUser } from '@/utils/musicUser';
import { prisma } from '@/utils/prisma';
import { Prisma } from '@prisma/client';
import { NextApiRequest, NextApiResponse } from 'next';

const MAX_STATE_BYTES = 200 * 1024;

/** PUT body. `state` is whatever the player saves: queue, position, shuffle, repeat. */
export interface MusicPlayerStateRequest {
	state: Record<string, unknown>;
}

/** GET and PUT answer. Both null before the first PUT. */
export interface MusicPlayerStateResponse {
	state: Record<string, unknown> | null;
	updatedAt: string | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET' && req.method !== 'PUT') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const userId = requireMusicUser(req, res);
	if (!userId) return;

	try {
		if (req.method === 'GET') {
			const row = await prisma.musicPlayerState.findUnique({ where: { userId } });
			const body: MusicPlayerStateResponse = {
				state: (row?.state as Record<string, unknown> | undefined) ?? null,
				updatedAt: row?.updatedAt.toISOString() ?? null,
			};
			return res.status(200).json(body);
		}

		const state = req.body?.state;
		if (!state || typeof state !== 'object' || Array.isArray(state)) {
			return res.status(400).json({ error: 'Body must be { state: {...} }' });
		}
		if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) {
			return res.status(413).json({ error: 'Player state is larger than 200 KB' });
		}
		const row = await prisma.musicPlayerState.upsert({
			where: { userId },
			create: { userId, state: state as Prisma.InputJsonObject },
			update: { state: state as Prisma.InputJsonObject },
		});
		const body: MusicPlayerStateResponse = {
			state: row.state as Record<string, unknown>,
			updatedAt: row.updatedAt.toISOString(),
		};
		return res.status(200).json(body);
	} catch (error) {
		console.error('Music player state failed:', error);
		return res.status(500).json({ error: 'Failed to read or save player state' });
	}
}
