/**
 * Enrich every release group in the music catalog: its type, genres and first
 * release date, the tracklist of one of its releases (titles and lengths for
 * the player), every other title its releases give (disc 0, for files that
 * release leaves untitled), its artists, and its Cover Art Archive cover.
 *
 * `MusicMetadata.mbid` is a release group. Lidarr's metadata server is asked
 * first: one request, at most two a second, gives every release with its
 * tracks. MusicBrainz is asked when Lidarr fails or lacks the group (a lookup,
 * a browse of its releases when there are 25 or more, the chosen release; one
 * a second). A group both have deleted is looked for by its artist and album in
 * Lidarr's search and stored, if its titles name the files, under the catalog's
 * own mbid. `pickRelease` chooses the release and the log line says by which rule.
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
	fetchLidarrAlbum,
	fetchRelease,
	fetchReleaseGroup,
	findLidarrAlbum,
	fromLidarr,
	hasCaaCover,
	LidarrAlbum,
	lidarrCoverRelease,
	MbRelease,
	MbReleaseGroup,
	namesFiles,
	pickRelease,
	searchLidarrAlbums,
	titlePool,
} from '../src/services/musicBrainz';
import { discTrackCounts, getFilename, isAudioPath } from '../src/utils/musicTracks';
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
	const counts = {
		enriched: 0,
		lidarr: 0,
		musicBrainz: 0,
		foundByName: 0,
		noSource: 0,
		noRelease: 0,
		caaCovers: 0,
		failed: 0,
	};
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
				// The torrent the library plays: the one with the most audio files.
				const files = await prisma.availableMusicFile.findMany({
					where: { availableMusic: { mbid } },
					select: { hash: true, path: true },
				});
				const audioPerHash = new Map<string, string[]>();
				for (const file of files.filter((file) => isAudioPath(file.path))) {
					audioPerHash.set(file.hash, [
						...(audioPerHash.get(file.hash) ?? []),
						file.path,
					]);
				}
				const paths =
					[...audioPerHash.values()].sort((a, b) => b.length - a.length)[0] ?? [];
				const filenames = paths.map(getFilename);

				let source = 'Lidarr';
				let group: MbReleaseGroup | null = null;
				let releases: MbRelease[] = [];
				let album = await fetchLidarrAlbum(mbid).catch((error) => {
					console.warn(`${prefix}: Lidarr failed:`, (error as Error).message);
					return undefined;
				});
				if (album) ({ group, releases } = fromLidarr(album));
				else {
					source = 'MusicBrainz';
					group = await fetchReleaseGroup(mbid);
				}
				// Deleted from MusicBrainz: the same album by its artist and title, if any.
				let foundByName: LidarrAlbum | null = null;
				if (!group) {
					const stored = await prisma.musicMetadata.findUnique({
						where: { mbid },
						select: { artist: true, album: true, artistMbid: true },
					});
					foundByName =
						stored &&
						findLidarrAlbum(
							await searchLidarrAlbums(`${stored.artist} ${stored.album}`),
							stored
						);
					if (foundByName) {
						({ group, releases } = fromLidarr(foundByName));
						album = foundByName;
						source = `Lidarr's search, as ${foundByName.id}`;
					}
				}

				const picked =
					group && pickRelease(group, discTrackCounts(paths), filenames, releases);
				const release = picked
					? (releases.find((other) => other.id === picked.id) ??
						(await fetchRelease(picked.id)))
					: null;
				if (!group || (foundByName && !(release && namesFiles(release, filenames)))) {
					// Marked done so it is not asked for again; --force retries it.
					await prisma.musicMetadata.updateMany({
						where: { mbid },
						data: { enrichedAt: new Date() },
					});
					counts.noSource++;
					console.log(
						`${prefix}: no metadata source` +
							(foundByName ? ` (${foundByName.id} does not name its files)` : '')
					);
					continue;
				}

				const { metadata, tracks, artists } = enrichment(mbid, group, release);
				const pool = titlePool(mbid, group, releases, tracks);
				const existing = await prisma.musicMetadata.findUnique({
					where: { mbid },
					select: { coverSource: true },
				});
				// Replaces an iTunes guess; without CAA art the stored cover stays. A group
				// found by name has its art under the other id: its release's, as Lidarr has it.
				const coverRelease = foundByName && lidarrCoverRelease(foundByName);
				const cover =
					existing?.coverSource === 'caa'
						? null
						: coverRelease
							? `https://coverartarchive.org/release/${coverRelease}/front-500`
							: !foundByName && (await hasCaaCover(mbid))
								? caaCoverUrl(mbid)
								: null;
				const { artist, album: title, ...fields } = metadata;
				const data = {
					...fields,
					// Lidarr may not list the album's artist; never forget the one stored.
					artistMbid: fields.artistMbid ?? undefined,
					...(cover ? { coverUrl: cover, coverSource: 'caa' } : {}),
					enrichedAt: new Date(),
				};

				await prisma.$transaction([
					prisma.musicTrackMetadata.deleteMany({ where: { mbid } }),
					prisma.musicTrackMetadata.createMany({ data: [...tracks, ...pool] }),
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
						create: { mbid, artist, album: title, ...data },
						update: data,
					}),
				]);

				counts.enriched++;
				if (foundByName) counts.foundByName++;
				else if (album) counts.lidarr++;
				else counts.musicBrainz++;
				if (!release) counts.noRelease++;
				if (cover) counts.caaCovers++;
				console.log(
					`${prefix}: ${artist} - ${title}, ${metadata.primaryType ?? 'no type'}, from ${source}, ` +
						(release && picked
							? `release ${release.id} by ${picked.rule} with ${tracks.length} tracks ` +
								`for ${paths.length} files, ${pool.length} more titles`
							: 'no release') +
						(cover ? ', CAA cover' : '')
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
