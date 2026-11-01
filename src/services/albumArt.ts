import { MUSICBRAINZ_USER_AGENT } from '@/services/musicBrainz';
import { isStoreConfigured, putStoredObject } from '@/services/newznab/store';
import { albumArtObject, albumArtUrl } from '@/utils/posterHost';

/** The public B2 bucket behind posters0…9.debridmediamanager.com. */
const BUCKET = 'posters';
const DOWNLOAD_TIMEOUT_MS = 10_000;

/** Whether the B2 key that writes the posters bucket is in the environment. */
export const canMirrorAlbumArt = () => isStoreConfigured(BUCKET);

/**
 * Copies an album's cover (a Cover Art Archive URL, redirects followed) into
 * the posters bucket, where Cloudflare serves and caches it like the movie
 * posters, and answers its posters URL; null when the download or the upload
 * fails, so the caller keeps the archive's URL.
 */
export async function mirrorAlbumArt(mbid: string, source: string): Promise<string | null> {
	try {
		const response = await fetch(source, {
			headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT },
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		});
		if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
			await response.body?.cancel();
			return null;
		}
		const body = Buffer.from(await response.arrayBuffer());
		return (await putStoredObject(albumArtObject(mbid), body, 'image/jpeg', BUCKET))
			? albumArtUrl(mbid)
			: null;
	} catch {
		return null; // a timeout or a dropped connection: the archive's URL stays
	}
}
