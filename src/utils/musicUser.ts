import { readSignedPayload, signPayload } from '@/utils/sponsorToken';
import { NextApiRequest, NextApiResponse } from 'next';

export const MUSIC_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface MusicTrackRef {
	hash: string;
	fileId: number;
	mbid: string;
}

const HASH = /^[0-9a-f]{40}$/i;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signMusicToken(userId: string): { token: string; exp: number } {
	const exp = Date.now() + MUSIC_TOKEN_TTL_MS;
	return { token: signPayload({ kind: 'music', userId, exp }), exp };
}

/** The userId of a valid music token, or null. A sponsor token has no `kind` and never passes. */
export function verifyMusicToken(token: string | undefined | null): string | null {
	const payload = readSignedPayload(token) as {
		kind?: unknown;
		userId?: unknown;
		exp?: unknown;
	} | null;
	if (
		payload?.kind !== 'music' ||
		typeof payload.userId !== 'string' ||
		typeof payload.exp !== 'number'
	) {
		return null;
	}
	return payload.exp > Date.now() ? payload.userId : null;
}

/** The caller's userId from `x-dmm-music-token`; answers 401 and returns null otherwise. */
export function requireMusicUser(req: NextApiRequest, res: NextApiResponse): string | null {
	const header = req.headers['x-dmm-music-token'];
	const userId = typeof header === 'string' ? verifyMusicToken(header) : null;
	if (!userId) res.status(401).json({ error: 'Music session required' });
	return userId;
}

export const isMbid = (value: unknown): value is string =>
	typeof value === 'string' && MBID.test(value);

export function parseTrackRef(value: unknown): MusicTrackRef | null {
	const { hash, fileId, mbid } = (value ?? {}) as Record<string, unknown>;
	if (typeof hash !== 'string' || !HASH.test(hash) || !isMbid(mbid)) return null;
	if (
		typeof fileId !== 'number' ||
		!Number.isInteger(fileId) ||
		fileId < 0 ||
		fileId > 2 ** 31 - 1
	)
		return null;
	return { hash, fileId, mbid };
}

/** `name` 1-200 characters after trimming, `description` up to 1000 or null. */
export function parsePlaylistFields(
	body: unknown,
	partial: boolean
): { name?: string; description?: string | null } | null {
	const { name, description } = (body ?? {}) as Record<string, unknown>;
	const fields: { name?: string; description?: string | null } = {};
	if (name !== undefined || !partial) {
		if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) return null;
		fields.name = name.trim();
	}
	if (description !== undefined) {
		if (description !== null && (typeof description !== 'string' || description.length > 1000))
			return null;
		fields.description = description;
	}
	return Object.keys(fields).length > 0 ? fields : null;
}

/** A positive integer query value capped at `max`, or `fallback`. */
export function queryInt(value: string | string[] | undefined, fallback: number, max: number) {
	const parsed = typeof value === 'string' ? parseInt(value, 10) : NaN;
	return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}
