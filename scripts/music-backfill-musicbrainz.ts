/**
 * Enrich every release group in the music catalog from MusicBrainz: its type,
 * genres and first release date, the tracklist of one of its releases (titles
 * and lengths for the player), its artists, and its Cover Art Archive cover.
 *
 * `MusicMetadata.mbid` is a release group. Of its releases the official one
 * with as many tracks as the catalog has audio files is taken, else the
 * earliest official one. Two MusicBrainz requests per group, one a second
 * (their limit), so the whole catalog takes a few hours.
 *
 * Resumable and idempotent: a group is done once `enrichedAt` is set, in the
 * same transaction that writes it, so a rerun picks up where one stopped.
 * `--force` redoes groups already done.
 *
 *   npx tsx scripts/music-backfill-musicbrainz.ts [--limit N] [--mbid X] [--force]
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import {
	caaCoverUrl,
	enrichment,
	fetchRelease,
	fetchReleaseGroup,
	hasCaaCover,
	pickRelease,
} from '../src/services/musicBrainz';
import { isAudioPath } from '../src/utils/musicTracks';
// Next loads `.env.local` over `.env` on its own; a plain tsx run does not, and
// `.env` carries placeholder database credentials.
config({ path: '.env.local', override: true });

const args = process.argv.slice(2);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const force = args.includes('--force');
const onlyMbid = option('--mbid');
const limit = option('--limit') ? parseInt(option('--limit')!, 10) : Infinity;
if (!(limit > 0)) throw new Error('--limit must be a positive number');

async function main() {
	const prisma = new PrismaClient();
	const counts = { enriched: 0, notInMusicBrainz: 0, noRelease: 0, caaCovers: 0, failed: 0 };
	try {
		const groups = await prisma.availableMusic.findMany({
			where: onlyMbid ? { mbid: onlyMbid } : undefined,
			distinct: ['mbid'],
			select: { mbid: true },
			orderBy: { mbid: 'asc' },
		});
		const done = force
			? new Set<string>()
			: new Set(
					(
						await prisma.musicMetadata.findMany({
							where: { enrichedAt: { not: null } },
							select: { mbid: true },
						})
					).map((row) => row.mbid)
				);
		const todo = groups
			.map((group) => group.mbid)
			.filter((mbid) => !done.has(mbid))
			.slice(0, limit);
		console.log(`${groups.length} release groups, ${done.size} done, ${todo.length} to do`);

		for (const [i, mbid] of todo.entries()) {
			const prefix = `[${i + 1}/${todo.length}] ${mbid}`;
			try {
				const group = await fetchReleaseGroup(mbid);
				if (!group) {
					// Marked done so it is not asked for again; --force retries it.
					await prisma.musicMetadata.updateMany({
						where: { mbid },
						data: { enrichedAt: new Date() },
					});
					counts.notInMusicBrainz++;
					console.log(`${prefix}: not in MusicBrainz`);
					continue;
				}

				// The torrent the library plays: the one with the most audio files.
				const files = await prisma.availableMusicFile.findMany({
					where: { availableMusic: { mbid } },
					select: { hash: true, path: true },
				});
				const audioPerHash = new Map<string, number>();
				for (const file of files) {
					if (isAudioPath(file.path)) {
						audioPerHash.set(file.hash, (audioPerHash.get(file.hash) ?? 0) + 1);
					}
				}
				const audioFiles = Math.max(0, ...audioPerHash.values());

				const picked = pickRelease(group, audioFiles);
				const release = picked ? await fetchRelease(picked.id) : null;
				const { metadata, tracks, artists } = enrichment(mbid, group, release);
				const existing = await prisma.musicMetadata.findUnique({
					where: { mbid },
					select: { coverSource: true },
				});
				// Replaces an iTunes guess; without CAA art the stored cover stays.
				const caa = existing?.coverSource !== 'caa' && (await hasCaaCover(mbid));
				const { artist, album, ...fields } = metadata;
				const data = {
					...fields,
					...(caa ? { coverUrl: caaCoverUrl(mbid), coverSource: 'caa' } : {}),
					enrichedAt: new Date(),
				};

				await prisma.$transaction([
					prisma.musicTrackMetadata.deleteMany({ where: { mbid } }),
					prisma.musicTrackMetadata.createMany({ data: tracks }),
					...artists.map((credit) =>
						prisma.musicArtist.upsert({
							where: { mbid: credit.mbid },
							create: { ...credit, enrichedAt: new Date() },
							update: {
								name: credit.name,
								sortName: credit.sortName,
								enrichedAt: new Date(),
							},
						})
					),
					prisma.musicMetadata.upsert({
						where: { mbid },
						create: { mbid, artist, album, ...data },
						update: data,
					}),
				]);

				counts.enriched++;
				if (!release) counts.noRelease++;
				if (caa) counts.caaCovers++;
				console.log(
					`${prefix}: ${artist} - ${album}, ${metadata.primaryType ?? 'no type'}, ` +
						(release
							? `release ${release.id} with ${tracks.length} tracks for ${audioFiles} files`
							: 'no release') +
						(caa ? ', CAA cover' : '')
				);
			} catch (error) {
				counts.failed++;
				console.error(`${prefix}: failed:`, error instanceof Error ? error.message : error);
			}
		}
	} finally {
		await prisma.$disconnect();
	}
	console.log('Summary:', counts);
	if (counts.failed) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
