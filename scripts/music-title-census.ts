/**
 * Every catalog album's tracks matched to its stored MusicBrainz titles the
 * way the album page matches them (`withTracks`), counted: fully titled,
 * partly, or not at all, and why (see `titleCensusReason`). Writes
 * music-title-census.json, which the backfill's --untitled reads. With --fix it
 * then re-enriches every album not fully titled and counts again.
 *
 *   npx tsx scripts/music-title-census.ts [--fix]
 */
import { execFileSync } from 'child_process';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
// Next loads `.env.local` over `.env` on its own; a plain tsx run does not.
config({ path: '.env.local', override: true });

const OUTPUT = 'music-title-census.json';
const BATCH = 200;

async function main() {
	// After the environment is loaded: the catalog's Prisma client is made on import.
	const { MUSIC_SORTS, queryAlbums, titleCensusReason, withTracks } =
		await import('../src/services/musicCatalog');
	const { prisma } = await import('../src/utils/prisma');

	const census = async () => {
		const { albums } = await queryAlbums({ order: MUSIC_SORTS.name, limit: 1_000_000 });
		const metas = new Map(
			(
				await prisma.musicMetadata.findMany({
					select: { mbid: true, enrichedAt: true, mbReleaseId: true },
				})
			).map((meta) => [meta.mbid, meta])
		);
		const matched: Awaited<ReturnType<typeof withTracks>> = [];
		for (let i = 0; i < albums.length; i += BATCH) {
			matched.push(...(await withTracks(albums.slice(i, i + BATCH))));
		}
		const rows = matched.map((album) => ({
			hash: album.hash,
			mbid: album.mbid,
			artist: album.artist,
			album: album.album,
			files: album.tracks.length,
			titled: album.tracks.filter((track) => track.title).length,
			mbTrackCount: album.mbTrackCount ?? null,
			reason: titleCensusReason(album, metas.get(album.mbid)),
		}));
		const summary = {
			albums: rows.length,
			fullyTitled: rows.filter((row) => row.reason === 'titled').length,
			partly: rows.filter((row) => row.reason !== 'titled' && row.titled > 0).length,
			none: rows.filter((row) => row.titled === 0).length,
			byReason: Object.fromEntries(
				[...new Set(rows.map((row) => row.reason))]
					.filter((reason) => reason !== 'titled')
					.map((reason) => {
						const of = rows.filter((row) => row.reason === reason);
						return [
							reason,
							{
								partly: of.filter((row) => row.titled > 0).length,
								none: of.filter((row) => row.titled === 0).length,
							},
						];
					})
			),
		};
		console.log(JSON.stringify(summary, null, 2));
		writeFileSync(OUTPUT, JSON.stringify({ at: new Date(), summary, albums: rows }, null, 1));
		console.log(`Wrote ${OUTPUT}`);
		return summary;
	};

	try {
		await census();
		if (process.argv.includes('--fix')) {
			execFileSync(
				'npx',
				['-y', 'tsx', 'scripts/music-backfill-musicbrainz.ts', '--untitled'],
				{ stdio: 'inherit' }
			);
			await census();
		}
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
