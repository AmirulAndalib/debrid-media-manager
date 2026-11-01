// @vitest-environment node
/**
 * The music catalog's SQL against a real MySQL 8.0.36, the server dmmdb runs:
 * window functions, ICU regular expressions in ORDER BY and fulltext matching,
 * none of which a mocked client checks.
 *
 * The catalog is the real one as /api/music/library served it on 2026-11-01
 * (the first page by name, where "¡Tré!" and "…And Justice for All" led, and a
 * page of recent albums), with the real files of ¡Tré! and of Metallica's
 * eight-disc …And Justice for All box set, and ¡Tré!'s real MusicBrainz
 * tracklist.
 *
 * Needs Docker. Skipped without it, like the other integration tests.
 */
import { enrichment, MbRelease, MbReleaseGroup } from '@/services/musicBrainz';
import { setBlocklistForTests } from '@/services/takedown/blocklist';
import catalog from '@/test/fixtures/musicbrainz/catalog-2026-11-01.json';
import release from '@/test/fixtures/musicbrainz/release-08205eae-c9e3-4174-8d69-2a67d742a19c.json';
import group from '@/test/fixtures/musicbrainz/release-group-4853b957-05f2-457b-ba47-18b2565abc69.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import type { NextApiHandler } from 'next';
import path from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dockerAvailable = false;
try {
	const { getContainerRuntimeClient } = await import('testcontainers');
	await getContainerRuntimeClient();
	dockerAvailable = true;
} catch {
	dockerAvailable = false;
}

const DDL = readFileSync(
	path.resolve(__dirname, '../test/fixtures/musicbrainz/music-tables.sql'),
	'utf8'
)
	.split(/^;$/m)
	.map((statement) =>
		statement
			.split('\n')
			.filter((line) => !line.startsWith('--'))
			.join('\n')
			.trim()
	)
	.filter(Boolean);

const TRE_HASH = '3237449d26653635ed3b3a0afb563b1087d5597b';
const TRE = '4853b957-05f2-457b-ba47-18b2565abc69';
const UNO = '6a0f0991-7af2-4dec-b623-6672051be668';
const JUSTICE_HASH = 'f590ebc219813f8765bd397b5c63d1413177287a';
const JUSTICE = '67553e23-8dad-3792-b6f2-8fedd5650ff3';
const GREEN_DAY = '084308bd-1654-436f-ba03-df6697104e19';
const DIAMOND_DOGS = catalog.albums.find((album) => album.album === 'Diamond Dogs')!;
const END_SEQUENCE = catalog.albums.find((album) => album.album === 'End Sequence EP')!;
const enriched = enrichment(
	TRE,
	group as unknown as MbReleaseGroup,
	release as unknown as MbRelease
);

/** What the name sort should key on, in JS. */
const nameKey = (name: string) => name.replace(/^[^\p{L}\p{N}]*((the|an?)\s+)?/iu, '');

describe.skipIf(!dockerAvailable)('Music catalog on MySQL 8.0.36 (Integration)', () => {
	let container: StartedTestContainer;
	let db: PrismaClient;
	let library: NextApiHandler;
	let search: NextApiHandler;
	let artist: NextApiHandler;

	const get = async (handler: NextApiHandler, query: Record<string, string>) => {
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'GET', query }), res);
		expect(res._getStatusCode()).toBe(200);
		return res._getData() as any;
	};

	beforeAll(async () => {
		container = await new GenericContainer('mysql:8.0.36')
			.withEnvironment({ MYSQL_ROOT_PASSWORD: 'test', MYSQL_DATABASE: 'dmm_test' })
			.withExposedPorts(3306)
			.withTmpFs({ '/var/lib/mysql': 'rw' })
			// The init run logs "ready for connections" on port 0 first.
			.withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306 /))
			.withStartupTimeout(180_000)
			.start();
		const url = `mysql://root:test@${container.getHost()}:${container.getMappedPort(3306)}/dmm_test`;
		db = new PrismaClient({ datasourceUrl: url });
		for (const statement of DDL) await db.$executeRawUnsafe(statement);

		const served = Date.UTC(2026, 10, 1);
		const files = (hash: string, count: number) =>
			(
				catalog.files as Record<
					string,
					{ fileId: number; path: string; trackNumber: number }[]
				>
			)[hash] ??
			Array.from({ length: count }, (_, i) => ({
				fileId: i + 1,
				path: `/${String(i + 1).padStart(2, '0')} - Track ${i + 1}.flac`,
				trackNumber: i + 1,
			}));
		const torrents = [
			...catalog.albums.map((album) => ({
				...album,
				files: files(album.hash, album.trackCount),
			})),
			// A second, smaller torrent of ¡Tré!, older than the first.
			{ ...catalog.albums[0], hash: 'tre-five-files', files: files('', 5) },
		];
		await db.availableMusic.createMany({
			data: torrents.map((torrent, i) => ({
				hash: torrent.hash,
				mbid: torrent.mbid,
				filename: torrent.album,
				originalFilename: torrent.album,
				bytes: BigInt(1000 * (i + 1)),
				originalBytes: BigInt(1000 * (i + 1)),
				host: 'real-debrid.com',
				progress: 100,
				status: 'downloaded',
				// Served order: the first row ended last.
				ended: new Date(served - i * 60_000),
			})),
		});
		await db.availableMusicFile.createMany({
			data: torrents.flatMap((torrent) =>
				torrent.files.map((file) => ({
					link: `${torrent.hash}/${file.fileId}`,
					file_id: file.fileId,
					hash: torrent.hash,
					path: file.path,
					bytes: BigInt(1000),
					trackNumber: file.trackNumber,
				}))
			),
		});
		await db.musicMetadata.createMany({
			data: catalog.albums.map((album) => ({
				mbid: album.mbid,
				artist: album.artist,
				album: album.album,
				year: album.year,
				artistMbid: album.mbid === TRE || album.mbid === UNO ? GREEN_DAY : null,
			})),
			skipDuplicates: true,
		});
		await db.musicMetadata.update({
			where: { mbid: TRE },
			data: { ...enriched.metadata, artist: 'Green Day', album: '¡Tré!' },
		});
		// The catalog's year is a 2004 reissue's; MusicBrainz has the 1974 original.
		await db.musicMetadata.update({
			where: { mbid: DIAMOND_DOGS.mbid },
			data: { firstReleaseDate: '1974-05-24' },
		});
		await db.musicMetadata.update({ where: { mbid: JUSTICE }, data: { mbTrackCount: 9 } });
		await db.musicMetadata.update({
			where: { mbid: END_SEQUENCE.mbid },
			data: { primaryType: 'EP' },
		});
		await db.musicTrackMetadata.createMany({ data: enriched.tracks });
		await db.musicArtist.createMany({
			data: enriched.artists.map((credit) => ({ ...credit, name: 'Green Day (MB)' })),
		});

		// The app's Prisma client is built from DATABASE_URL on first import.
		process.env.DATABASE_URL = url;
		({ default: library } = await import('@/pages/api/music/library'));
		({ default: search } = await import('@/pages/api/music/search'));
		({ default: artist } = await import('@/pages/api/music/artist'));
	}, 240_000);

	afterAll(async () => {
		await db?.$disconnect();
		await container?.stop();
	});

	it('sorts by name without leading punctuation or articles', async () => {
		const data = await get(library, { summary: '1', sortBy: 'name', limit: '96' });
		const names = data.albums.map((album: any) => album.album);

		expect(names[0]).toBe('Abominog');
		const collator = new Intl.Collator('en', { sensitivity: 'base' });
		expect(names).toEqual(
			[...names].sort((a: string, b: string) => collator.compare(nameKey(a), nameKey(b)))
		);
		expect(names.indexOf('¡Tré!')).toBe(names.indexOf('Tao') + 1);
		expect(names.indexOf('…And Justice for All')).toBe(names.indexOf('Agents of Fortune') + 1);
		expect(names.indexOf('The Clearing')).toBe(names.indexOf('Carrie & Lowell') + 1);
	});

	it('pages with totals over one album per release group', async () => {
		const mbids = new Set(catalog.albums.map((album) => album.mbid));
		const first = await get(library, { summary: '1', sortBy: 'name', limit: '10' });
		const last = await get(library, {
			summary: '1',
			sortBy: 'name',
			limit: '10',
			page: String(Math.ceil(mbids.size / 10)),
		});

		expect(first).toMatchObject({ totalAlbums: mbids.size, hasMore: true, nextPage: 2 });
		expect(first.totalTracks).toBe(
			catalog.albums.reduce((sum, album) => sum + album.trackCount, 0)
		);
		expect(last.albums).toHaveLength(mbids.size % 10 || 10);
		expect(last).toMatchObject({ hasMore: false, nextPage: null });
	});

	it('serves the torrent with the most files, and the next one when that is blocked', async () => {
		const tre = async () =>
			(await get(library, { summary: '1', search: 'tré' })).albums.find(
				(album: any) => album.mbid === TRE
			);

		expect(await tre()).toMatchObject({ hash: TRE_HASH, trackCount: 12 });
		setBlocklistForTests([TRE_HASH]);
		expect(await tre()).toMatchObject({ hash: 'tre-five-files', trackCount: 5 });
	});

	it.each([
		['justice', ['…And Justice for All', '…And Justice for All']],
		['white stripes', ['Elephant', 'The White Stripes Greatest Hits']],
		['the who', ['Who’s Next']],
		['Vs', ['Vs.']],
	])('searches %j', async (q, albums) => {
		const data = await get(library, { summary: '1', sortBy: 'name', search: q });

		expect(data.albums.map((album: any) => album.album)).toEqual(albums);
		expect(data.totalAlbums).toBe(albums.length);
	});

	it('filters by type and takes the year of the first release', async () => {
		const eps = await get(library, { summary: '1', type: 'ep' });
		expect(eps.albums.map((album: any) => album.album)).toEqual(['End Sequence EP']);

		const byYear = await get(library, { summary: '1', sortBy: 'year', limit: '96' });
		const years = byYear.albums.map((album: any) => album.year);
		expect(years.filter((year: number | null) => year !== null)).toEqual(
			years
				.filter((year: number | null) => year !== null)
				.sort((a: number, b: number) => b - a)
		);
		expect(years.at(-1)).toBeNull();
		expect(byYear.albums.find((album: any) => album.album === 'Diamond Dogs').year).toBe(1974);
	});

	it('sorts by the newest torrent of each release group', async () => {
		const data = await get(library, { summary: '1', limit: '3' });
		expect(data.albums.map((album: any) => album.hash)).toEqual(
			catalog.albums.slice(0, 3).map((album) => album.hash)
		);
	});

	it('returns an album with MusicBrainz titles, and a box set disc by disc', async () => {
		const tre = (await get(library, { hash: TRE_HASH })).albums[0];
		expect(tre).toMatchObject({
			primaryType: 'Album',
			genres: enriched.metadata.genres,
			pack: false,
		});
		expect(tre.tracks.map((track: any) => track.title)).toEqual(
			enriched.tracks.map((track) => track.title)
		);
		expect(tre.tracks[0].durationMs).toBe(294746);

		const box = (await get(library, { hash: JUSTICE_HASH })).albums[0];
		expect(box.tracks[0].path).toBe('/Disc 1/01 Blackened (Remastered).flac');
		expect(box).toMatchObject({ trackCount: 147, mbTrackCount: 9, pack: true });
		const summary = await get(library, { summary: '1', search: 'justice' });
		expect(summary.albums.find((album: any) => album.mbid === JUSTICE).pack).toBe(true);
	});

	it('searches artists, albums and track titles', async () => {
		const data = await get(search, { q: 'brutal love' });
		expect(data.tracks).toHaveLength(1);
		expect(data.tracks[0].track).toMatchObject({
			title: 'Brutal Love',
			path: '/01.Brutal Love.flac',
		});
		expect(data.tracks[0].album).toMatchObject({ mbid: TRE, tracks: [] });

		const greenDay = await get(search, { q: 'green day' });
		expect(greenDay.artists).toEqual([
			{ mbid: GREEN_DAY, name: 'Green Day (MB)', albumCount: 2, coverUrl: null },
		]);
		expect(greenDay.albums.map((album: any) => album.album).sort()).toEqual(['¡Tré!', '¡Uno!']);
	});

	it("lists an artist's albums newest first", async () => {
		const data = await get(artist, { mbid: GREEN_DAY });
		expect(data.artist).toEqual({
			mbid: GREEN_DAY,
			name: 'Green Day (MB)',
			sortName: 'Green Day',
		});
		expect(data.albums.map((album: any) => album.album)).toEqual(['¡Tré!', '¡Uno!']);
	});
});
