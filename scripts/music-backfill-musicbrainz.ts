/**
 * Enrich every release group in the music catalog: its type, genres and first
 * release date, the tracklist of one of its releases (titles and lengths for
 * the player), every other title its releases give (disc 0, for files that
 * release leaves untitled), its artists, and its cover: the Cover Art Archive's
 * for the group, else Lidarr's for one of its releases, copied into the B2
 * bucket behind posters0…9.debridmediamanager.com when B2_KEY_ID and
 * B2_APP_KEY are set (one download at a time, 10 s each; a failed copy keeps
 * the archive's URL). Albums already copied (`coverSource` b2) keep theirs.
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
 * `--force` redoes groups already done; `--untitled` redoes only those the last
 * `scripts/music-title-census.ts` found not fully titled (music-title-census.json).
 *
 * `--covers` only copies the covers of albums already enriched, enriching nothing.
 *
 *   npx tsx scripts/music-backfill-musicbrainz.ts [--limit N] [--mbid X] [--force] [--untitled] [--covers]
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { canMirrorAlbumArt, mirrorAlbumArt } from '../src/services/albumArt';
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
	lidarrCoverUrl,
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
const untitled = args.includes('--untitled');
const force = args.includes('--force') || untitled;
const onlyMbid = option('--mbid');
const limit = option('--limit') ? parseInt(option('--limit')!, 10) : Infinity;
if (!(limit > 0)) throw new Error('--limit must be a positive number');
const mirroring = canMirrorAlbumArt();

const caaReleaseCover = (release: string) =>
	`https://coverartarchive.org/release/${release}/front-500`;

/**
 * The cover to store for `mbid`: the group's Cover Art Archive art, else a
 * release's (`releaseArt`), copied to B2 when it can be; else the archive's own
 * URL, which replaces an iTunes guess; null to keep what is stored.
 */
async function albumCover(
	mbid: string,
	stored: string | null | undefined,
	groupArt: string | null,
	releaseArt: string | null,
	lidarrArt: string | null = null
): Promise<{ coverUrl: string; coverSource: string } | null> {
	if (stored === 'b2') return null;
	// Lidarr's image cache answers in ~0.2 s; the archive takes seconds and fails one time in ten.
	for (const source of mirroring ? [lidarrArt, groupArt, releaseArt] : []) {
		const mirrored = source && (await mirrorAlbumArt(mbid, source));
		if (mirrored) return { coverUrl: mirrored, coverSource: 'b2' };
	}
	if (stored === 'caa') return null;
	const archived = groupArt && (await hasCaaCover(mbid)) ? groupArt : releaseArt;
	return archived ? { coverUrl: archived, coverSource: 'caa' } : null;
}

/** `--covers`: copies the covers of enriched albums not on B2 yet, nothing else. */
async function mirrorCovers(prisma: PrismaClient) {
	if (!mirroring) throw new Error('--covers needs B2_KEY_ID and B2_APP_KEY');
	const rows = (
		await prisma.musicMetadata.findMany({
			where: {
				enrichedAt: { not: null },
				OR: [{ coverSource: null }, { coverSource: { not: 'b2' } }],
				...(onlyMbid ? { mbid: onlyMbid } : {}),
			},
			select: { mbid: true, coverUrl: true },
			orderBy: { mbid: 'asc' },
		})
	).slice(0, limit);
	let copied = 0;
	for (const [i, row] of rows.entries()) {
		// A group found by name stored its release's art.
		const releaseArt = row.coverUrl?.startsWith('https://coverartarchive.org/release/')
			? row.coverUrl
			: null;
		const lidarrAlbum = await fetchLidarrAlbum(row.mbid).catch(() => null);
		const cover = await albumCover(
			row.mbid,
			'caa',
			caaCoverUrl(row.mbid),
			releaseArt,
			lidarrAlbum ? lidarrCoverUrl(lidarrAlbum) : null
		);
		if (cover) {
			await prisma.musicMetadata.update({ where: { mbid: row.mbid }, data: cover });
			copied++;
		}
		console.log(
			`[${i + 1}/${rows.length}] ${row.mbid}: ${cover?.coverUrl ?? 'no cover copied'}`
		);
	}
	console.log(`Copied ${copied} of ${rows.length} covers to B2`);
}

async function main() {
	const prisma = new PrismaClient();
	if (args.includes('--covers')) {
		try {
			return await mirrorCovers(prisma);
		} finally {
			await prisma.$disconnect();
		}
	}
	const counts = {
		enriched: 0,
		lidarr: 0,
		musicBrainz: 0,
		foundByName: 0,
		noSource: 0,
		noRelease: 0,
		covers: 0,
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
		// The census's rows for albums it found not fully titled.
		const wanted = untitled
			? new Set(
					(
						JSON.parse(readFileSync('music-title-census.json', 'utf8')).albums as {
							mbid: string;
							reason: string;
						}[]
					)
						.filter((album) => album.reason !== 'titled')
						.map((album) => album.mbid)
				)
			: null;
		const todo = groups
			.map((group) => group.mbid)
			.filter((mbid) => !done.has(mbid) && (!wanted || wanted.has(mbid)))
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
				// A group found by name has its art under the other id: its release's.
				const coverRelease = album && lidarrCoverRelease(album);
				const cover = await albumCover(
					mbid,
					existing?.coverSource,
					foundByName ? null : caaCoverUrl(mbid),
					coverRelease ? caaReleaseCover(coverRelease) : null,
					album ? lidarrCoverUrl(album) : null
				);
				const { artist, album: title, ...fields } = metadata;
				const data = {
					...fields,
					// Lidarr may not list the album's artist; never forget the one stored.
					artistMbid: fields.artistMbid ?? undefined,
					...cover,
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
				if (cover) counts.covers++;
				console.log(
					`${prefix}: ${artist} - ${title}, ${metadata.primaryType ?? 'no type'}, from ${source}, ` +
						(release && picked
							? `release ${release.id} by ${picked.rule} with ${tracks.length} tracks ` +
								`for ${paths.length} files, ${pool.length} more titles`
							: 'no release') +
						(cover ? `, cover ${cover.coverUrl}` : '')
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
