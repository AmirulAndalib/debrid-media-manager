import { getCurrentUser } from '@/services/realDebrid';
import { generateUserId } from '@/utils/castApiHelpers';
import { signMusicToken } from '@/utils/musicUser';
import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';

export interface MusicSessionRequest {
	accessToken: string;
}

export interface MusicSessionResponse {
	/** Send as `x-dmm-music-token` to /api/music/me/*. */
	token: string;
	userId: string;
	/** Expiry, epoch milliseconds. */
	exp: number;
}

/** Exchanges a Real-Debrid access token for a 7-day music token bound to that RD account. */
export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<MusicSessionResponse | { error: string }>
) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const accessToken = req.body?.accessToken;
	if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 512) {
		return res.status(400).json({ error: 'accessToken is required' });
	}

	try {
		await getCurrentUser(accessToken);
	} catch (error) {
		const status = axios.isAxiosError(error) ? error.response?.status : undefined;
		return status === 401 || status === 403
			? res.status(401).json({ error: 'Real-Debrid rejected the access token' })
			: res.status(503).json({ error: 'Real-Debrid did not answer, try again' });
	}

	try {
		// Reuses getCurrentUser's in-flight answer, so RD is asked once.
		const userId = await generateUserId(accessToken);
		return res.status(200).json({ userId, ...signMusicToken(userId) });
	} catch (error) {
		console.error('Music session failed:', error instanceof Error ? error.message : error);
		return res.status(500).json({ error: 'Failed to start a music session' });
	}
}
