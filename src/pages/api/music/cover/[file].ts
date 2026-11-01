import { isMbid, MUSICBRAINZ_USER_AGENT } from '@/services/musicBrainz';
import { prisma } from '@/utils/prisma';
import Redis from 'ioredis';
import { NextApiRequest, NextApiResponse } from 'next';

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const CACHE_MAX_BYTES = 1024 * 1024;

type Cover = { type: string; body: Buffer };

// The Cover Art Archive redirects to archive.org, which redirects to one of its nodes.
const allowedHost = (host: string) =>
	host === 'coverartarchive.org' ||
	host === 'archive.org' ||
	host.endsWith('.archive.org') ||
	host.endsWith('.mzstatic.com');

let client: Redis | null = null;
let warned = false;

function redis(): Redis | null {
	if (client) return client;
	if (!process.env.REDIS_URL) return null;
	client = new Redis(process.env.REDIS_URL, {
		maxRetriesPerRequest: 1,
		connectTimeout: 2000,
		commandTimeout: 1000,
		lazyConnect: true,
	});
	// A connection failure surfaces as a rejected command below.
	client.on('error', () => {});
	return client;
}

function warnOnce(error: unknown) {
	if (warned) return;
	warned = true;
	console.warn(
		'Music cover cache unavailable, fetching covers upstream:',
		(error as Error).message
	);
}

// Stored as `<content type>\n<bytes>`.
async function cachedCover(key: string): Promise<Cover | null> {
	try {
		const value = await redis()?.getBuffer(key);
		if (!value) return null;
		const newline = value.indexOf(10);
		return { type: value.subarray(0, newline).toString(), body: value.subarray(newline + 1) };
	} catch (error) {
		warnOnce(error);
		return null;
	}
}

async function cacheCover(key: string, cover: Cover) {
	try {
		const value = Buffer.concat([Buffer.from(`${cover.type}\n`), cover.body]);
		await redis()?.set(key, value, 'EX', CACHE_TTL_SECONDS);
	} catch (error) {
		warnOnce(error);
	}
}

/** Follows redirects by hand so that every hop, not only the last, is on the allowlist. */
async function fetchCover(url: string): Promise<Cover | null> {
	const signal = AbortSignal.timeout(TIMEOUT_MS);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const target = new URL(url);
		if (target.protocol !== 'https:' || !allowedHost(target.hostname)) return null;
		const response = await fetch(target, {
			redirect: 'manual',
			signal,
			headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT },
		});
		const location = response.headers.get('location');
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel();
			url = new URL(location, target).href;
			continue;
		}
		const type = response.headers.get('content-type') ?? 'image/jpeg';
		if (!response.ok || !type.startsWith('image/')) {
			await response.body?.cancel();
			return null;
		}
		return { type, body: Buffer.from(await response.arrayBuffer()) };
	}
	return null;
}

/**
 * GET /api/music/cover/<mbid>.jpg: the album's stored cover, cached in Redis and
 * by every browser, so the archive is asked once per cover rather than per viewer.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== 'GET') {
		res.setHeader('Allow', 'GET');
		return res.status(405).json({ error: 'Method not allowed' });
	}
	const file = req.query.file;
	const mbid =
		typeof file === 'string' && file.endsWith('.jpg') ? file.slice(0, -4).toLowerCase() : null;
	if (!isMbid(mbid)) {
		return res.status(400).json({ error: 'Invalid cover' });
	}

	const notFound = () => {
		res.setHeader('Cache-Control', 'public, max-age=300');
		return res.status(404).json({ error: 'No cover' });
	};
	try {
		const key = `music:cover:${mbid}`;
		let cover = await cachedCover(key);
		if (!cover) {
			const meta = await prisma.musicMetadata.findUnique({
				where: { mbid },
				select: { coverUrl: true },
			});
			if (!meta?.coverUrl) return notFound();
			cover = await fetchCover(meta.coverUrl);
			if (!cover) return notFound();
			if (cover.body.length <= CACHE_MAX_BYTES) await cacheCover(key, cover);
		}
		res.setHeader('Content-Type', cover.type);
		res.setHeader('Content-Length', cover.body.length);
		res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
		return res.status(200).send(cover.body);
	} catch (error) {
		console.error('Music cover failed:', mbid, (error as Error).message);
		return notFound();
	}
}
