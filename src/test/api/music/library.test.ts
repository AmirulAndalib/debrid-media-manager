import handler from '@/pages/api/music/library';
import { enrichment, MbRelease, MbReleaseGroup } from '@/services/musicBrainz';
import monkees from '@/test/fixtures/music/library-dc925f67cd67936b4a8fbeb17d6decb648fd3479.json';
import catalog from '@/test/fixtures/musicbrainz/catalog-2026-11-01.json';
import release from '@/test/fixtures/musicbrainz/release-08205eae-c9e3-4174-8d69-2a67d742a19c.json';
import monkeesRelease from '@/test/fixtures/musicbrainz/release-0c6324c1-5968-4675-84bc-8f20b44cabc4.json';
import group from '@/test/fixtures/musicbrainz/release-group-4853b957-05f2-457b-ba47-18b2565abc69.json';
import monkeesGroup from '@/test/fixtures/musicbrainz/release-group-48e8b712-4f5d-34e0-9492-22f936854662.json';
import { createMockRequest, createMockResponse } from '@/test/utils/api';
import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/prisma', () => ({
	prisma: {
		$queryRaw: vi.fn(),
		availableMusic: { findMany: vi.fn() },
		availableMusicFile: { findMany: vi.fn() },
		musicTrackMetadata: { findMany: vi.fn() },
	},
}));

import { setBlocklistForTests } from '@/services/takedown/blocklist';
import { prisma } from '@/utils/prisma';

const mockedPrisma = vi.mocked(prisma, true);

const TRE_HASH = '3237449d26653635ed3b3a0afb563b1087d5597b';
const TRE_MBID = '4853b957-05f2-457b-ba47-18b2565abc69';
const JUSTICE_HASH = 'f590ebc219813f8765bd397b5c63d1413177287a';

function row(overrides: Record<string, unknown> = {}) {
	return {
		hash: 'hash1',
		mbid: 'mbid-1',
		filename: 'Test Album',
		bytes: BigInt(50000000),
		fileCount: BigInt(12),
		artistMbid: null,
		artist: 'Test Artist',
		album: 'Test Album',
		year: BigInt(2024),
		coverUrl: null,
		primaryType: null,
		genres: null,
		mbTrackCount: null,
		...overrides,
	};
}

/** The real files of an album in the catalog fixture, as AvailableMusicFile rows. */
function realFiles(hash: keyof typeof catalog.files) {
	return catalog.files[hash].map((file) => ({
		link: `https://example.com/${file.fileId}`,
		file_id: file.fileId,
		hash,
		path: file.path,
		bytes: BigInt(file.bytes),
		trackNumber: file.trackNumber,
	}));
}

function file(fileId: number, path: string, hash = 'hash1') {
	return {
		link: `https://example.com/${fileId}`,
		file_id: fileId,
		hash,
		path,
		bytes: BigInt(5000000),
		trackNumber: null,
	};
}

/** Answers the page query with `rows`, each carrying `totals`, and the totals query with them. */
function serve(rows: object[], totals = { totalAlbums: rows.length, totalTracks: 0 }) {
	const carried = {
		totalAlbums: BigInt(totals.totalAlbums),
		totalTracks: BigInt(totals.totalTracks),
	};
	mockedPrisma.$queryRaw.mockImplementation((async (query: Prisma.Sql) =>
		query.sql.includes('COUNT(DISTINCT')
			? [carried]
			: rows.map((r) => ({ ...r, ...carried }))) as any);
}

const queries = () =>
	mockedPrisma.$queryRaw.mock.calls.map(([query]) => query as unknown as Prisma.Sql);
const pageQuery = () => queries().find((query) => !query.sql.includes('COUNT(DISTINCT'))!;
const countQuery = () => queries().find((query) => query.sql.includes('COUNT(DISTINCT'))!;

async function get(query: Record<string, string>) {
	const res = createMockResponse();
	await handler(createMockRequest({ method: 'GET', query }), res);
	return res;
}

describe('/api/music/library', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setBlocklistForTests(['blockedhash']);
		serve([]);
		mockedPrisma.availableMusicFile.findMany.mockResolvedValue([]);
		mockedPrisma.musicTrackMetadata.findMany.mockResolvedValue([]);
	});

	it('rejects non-GET methods', async () => {
		const res = createMockResponse();
		await handler(createMockRequest({ method: 'POST' }), res);
		expect(res._getStatusCode()).toBe(405);
		expect(res._getData()).toEqual({ error: 'Method not allowed' });
	});

	describe('pages', () => {
		it.each(['recent', 'name', 'artist', 'year'])(
			'sorts by %s and pages in SQL without reading the whole table',
			async (sortBy) => {
				await get({ summary: '1', sortBy, page: '3', limit: '10' });

				expect(mockedPrisma.availableMusic.findMany).not.toHaveBeenCalled();
				expect(pageQuery().sql).toMatch(/LIMIT \? OFFSET \?$/);
				expect(pageQuery().values.slice(-2)).toEqual([10, 20]);
				// One row per release group: the unblocked torrent with the most files.
				expect(pageQuery().sql).toContain('ROW_NUMBER() OVER w AS rn');
				expect(pageQuery().sql).toContain(
					'WINDOW w AS (PARTITION BY m.mbid ORDER BY f.fileCount DESC, m.hash)'
				);
				expect(pageQuery().sql).toContain('m.hash NOT IN (?)');
				expect(pageQuery().values).toContain('blockedhash');
			}
		);

		it('takes the totals from the page, and counts on its own only past the end', async () => {
			serve([row()], { totalAlbums: 5812, totalTracks: 89209 });
			const data = (await get({ summary: '1', sortBy: 'name' }))._getData() as any;

			expect(data).toMatchObject({ totalAlbums: 5812, totalTracks: 89209, hasMore: true });
			expect(pageQuery().sql).toContain('COUNT(*) OVER () AS totalAlbums');
			expect(countQuery()).toBeUndefined();

			vi.clearAllMocks();
			serve([], { totalAlbums: 5812, totalTracks: 89209 });
			const past = (await get({ summary: '1', page: '999' }))._getData() as any;

			expect(past).toMatchObject({ albums: [], totalAlbums: 5812, hasMore: false });
			expect(countQuery().sql).toContain('COUNT(DISTINCT b.mbid)');
		});

		it('sorts names without their leading punctuation or article', async () => {
			await get({ summary: '1', sortBy: 'name' });

			// The pattern is a literal: bound, MySQL recompiles it for every row.
			expect(pageQuery().sql).toContain(
				"ORDER BY REGEXP_REPLACE(COALESCE(md.album, b.filename), '(?i)^[^[:alnum:]]*((the|an?)[[:space:]]+)?', '')"
			);
		});

		it('searches with the fulltext index, every word a required prefix', async () => {
			await get({ summary: '1', sortBy: 'name', search: ' Pink Floyd ' });

			expect(pageQuery().sql).toContain(
				'MATCH(md.artist, md.album) AGAINST (? IN BOOLEAN MODE)'
			);
			expect(pageQuery().values).toContain('+Pink* +Floyd*');
			expect(mockedPrisma.availableMusic.findMany).not.toHaveBeenCalled();
		});

		it.each([
			['u2', '%u2%'],
			['the who', '%the who%'],
			['5%', '%5\\%%'],
		])('searches %j with LIKE, which the index cannot answer', async (search, pattern) => {
			await get({ summary: '1', search });

			expect(pageQuery().sql).toContain('(md.artist LIKE ? OR md.album LIKE ?)');
			expect(pageQuery().values).toContain(pattern);
		});

		it('filters by release type', async () => {
			await get({ summary: '1', type: 'ep' });

			expect(pageQuery().sql).toContain('md.primaryType = ?');
			expect(pageQuery().values).toContain('EP');
		});

		it.each(['podcast', 'constructor'])('ignores an unknown type %j', async (type) => {
			await get({ summary: '1', type });

			expect(pageQuery().sql).not.toContain('primaryType =');
		});

		it('answers with the page, the totals and MusicBrainz fields', async () => {
			serve(
				[
					row({
						artistMbid: '084308bd-1654-436f-ba03-df6697104e19',
						primaryType: 'Album',
						genres: ['pop punk', 'rock'],
						mbTrackCount: 12,
						year: BigInt(2012),
					}),
					row({
						hash: 'hash2',
						mbid: 'mbid-2',
						artist: null,
						album: null,
						filename: 'Raw',
					}),
				],
				{ totalAlbums: 5, totalTracks: 60 }
			);

			const data = (await get({ summary: '1', page: '1', limit: '2' }))._getData() as any;

			expect(data).toMatchObject({
				totalAlbums: 5,
				totalTracks: 60,
				page: 1,
				limit: 2,
				hasMore: true,
				nextPage: 2,
			});
			expect(data.albums[0]).toEqual({
				hash: 'hash1',
				mbid: 'mbid-1',
				artistMbid: '084308bd-1654-436f-ba03-df6697104e19',
				artist: 'Test Artist',
				album: 'Test Album',
				year: 2012,
				coverUrl: null,
				tracks: [],
				totalBytes: 50000000,
				trackCount: 12,
				primaryType: 'Album',
				genres: ['pop punk', 'rock'],
				mbTrackCount: 12,
				pack: false,
			});
			expect(pageQuery().sql).toContain('md.artistMbid');
			expect(data.albums[1]).toMatchObject({
				artistMbid: null,
				artist: 'Unknown Artist',
				album: 'Raw',
				genres: [],
				pack: false,
			});
			// Nothing looked like a pack, so no file was read.
			expect(mockedPrisma.availableMusicFile.findMany).not.toHaveBeenCalled();
		});

		it("hands out archive covers as DMM's cached copy and iTunes covers as stored", async () => {
			const itunes = 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg';
			serve([
				row({
					mbid: TRE_MBID,
					coverUrl: `https://coverartarchive.org/release-group/${TRE_MBID}/front-500`,
				}),
				row({ hash: 'hash2', mbid: 'mbid-2', coverUrl: itunes }),
			]);

			const data = (await get({ summary: '1' }))._getData() as any;

			expect(data.albums.map((album: any) => album.coverUrl)).toEqual([
				`/api/music/cover/${TRE_MBID}.jpg`,
				itunes,
			]);
		});

		it('says there is no next page on the last one', async () => {
			serve([row()], { totalAlbums: 3, totalTracks: 30 });

			const data = (await get({ summary: '1', page: '2', limit: '2' }))._getData() as any;

			expect(data).toMatchObject({ hasMore: false, nextPage: null });
		});

		it('flags a box set as a pack, counting only its audio files', async () => {
			// Metallica's …And Justice for All box set: 147 tracks over eight discs,
			// filed under a release group whose release has 9.
			const scans = [
				...Array.from({ length: 12 }, (_, i) =>
					file(i + 1, `/${i + 1} - Song.flac`, 'scans')
				),
				...Array.from({ length: 14 }, (_, i) => file(i + 20, `/Scans/${i}.jpg`, 'scans')),
			];
			serve([
				row({ hash: JUSTICE_HASH, fileCount: BigInt(147), mbTrackCount: 9 }),
				row({ hash: 'scans', mbid: 'mbid-2', fileCount: BigInt(26), mbTrackCount: 12 }),
				row({ hash: 'small', mbid: 'mbid-3', fileCount: BigInt(12), mbTrackCount: 12 }),
			]);
			mockedPrisma.availableMusicFile.findMany.mockResolvedValue([
				...realFiles(JUSTICE_HASH),
				...scans,
			] as any);

			const data = (await get({ summary: '1' }))._getData() as any;

			expect(data.albums.map((album: any) => album.pack)).toEqual([true, false, false]);
			expect(mockedPrisma.availableMusicFile.findMany).toHaveBeenCalledWith({
				where: { hash: { in: [JUSTICE_HASH, 'scans'] } },
				select: { hash: true, path: true, file_id: true },
			});
		});
	});

	describe('one album', () => {
		async function album(files: unknown[], overrides: Record<string, unknown> = {}) {
			serve([row(overrides)]);
			mockedPrisma.availableMusicFile.findMany.mockResolvedValue(files as any);
			const data = (await get({ hash: String(overrides.hash ?? 'hash1') }))._getData() as any;
			return data;
		}

		it('reads only that album', async () => {
			await album([]);

			// Files are counted for that torrent alone, not across the whole table.
			expect(pageQuery().sql).toMatch(/FROM AvailableMusicFile\s+WHERE hash = \?/);
			expect(pageQuery().values).toContain('hash1');
			expect(countQuery()).toBeUndefined();
			expect(mockedPrisma.availableMusic.findMany).not.toHaveBeenCalled();
		});

		it('returns its audio tracks only, once per file', async () => {
			const data = await album([
				file(1, '/music/01 - Song.flac'),
				file(2, '/music/cover.jpg'),
				file(3, '/music/info.nfo'),
				file(4, '/music/02 - Song.mp3'),
				file(5, '/music/playlist.m3u'),
				{ ...file(4, '/music/02 - Song.mp3'), link: 'https://example.com/other' },
			]);

			expect(data).toMatchObject({ totalAlbums: 1, totalTracks: 2 });
			expect(data.page).toBeUndefined();
			expect(data.albums[0].trackCount).toBe(2);
			expect(data.albums[0].tracks.map((t: any) => t.filename)).toEqual([
				'01 - Song.flac',
				'02 - Song.mp3',
			]);
		});

		it('returns no album when it has no audio', async () => {
			const data = await album([file(1, '/music/cover.jpg')]);
			expect(data).toEqual({ albums: [], totalAlbums: 0, totalTracks: 0 });
		});

		it.each([
			['/music/02 - Second.flac', 2],
			['/music/track03.mp3', 3],
			['/music/[05] Track Five.flac', 5],
			['/music/07) Track Seven.flac', 7],
		])('reads the track number from %s', async (path, trackNumber) => {
			const data = await album([file(1, path)]);
			expect(data.albums[0].tracks[0].trackNumber).toBe(trackNumber);
		});

		it('orders tracks by track number', async () => {
			const data = await album([
				file(1, '/music/03 - Third.flac'),
				file(2, '/music/01 - First.flac'),
				file(3, '/music/02 - Second.flac'),
			]);
			expect(data.albums[0].tracks.map((t: any) => t.trackNumber)).toEqual([1, 2, 3]);
		});

		it('plays a multi-disc box set disc by disc', async () => {
			// Served on 2026-11-01 as Disc 3/01, Disc 8/01, Disc 1/01…: every
			// disc's first track, then every disc's second.
			const data = await album(realFiles(JUSTICE_HASH), {
				hash: JUSTICE_HASH,
				fileCount: BigInt(147),
				mbTrackCount: 9,
			});

			const paths = data.albums[0].tracks.map((t: any) => t.path);
			expect(paths.slice(0, 3)).toEqual([
				'/Disc 1/01 Blackened (Remastered).flac',
				'/Disc 1/02 ...And Justice for All (Remastered).flac',
				'/Disc 1/03 Eye of the Beholder (Remastered).flac',
			]);
			expect(paths[9]).toMatch(/^\/Disc 2\/01 /);
			expect(paths[146]).toMatch(/^\/Disc 8\//);
			expect(data.albums[0]).toMatchObject({ trackCount: 147, pack: true });
		});

		it('titles and times tracks from the MusicBrainz tracklist', async () => {
			const { tracks } = enrichment(
				TRE_MBID,
				group as unknown as MbReleaseGroup,
				release as unknown as MbRelease
			);
			mockedPrisma.musicTrackMetadata.findMany.mockResolvedValue(tracks as any);

			const data = await album(realFiles(TRE_HASH), {
				hash: TRE_HASH,
				mbid: TRE_MBID,
				mbTrackCount: 12,
			});

			expect(mockedPrisma.musicTrackMetadata.findMany).toHaveBeenCalledWith({
				where: { mbid: { in: [TRE_MBID] } },
			});
			expect(data.albums[0].tracks[0]).toMatchObject({
				filename: '01.Brutal Love.flac',
				title: 'Brutal Love',
				durationMs: 294746,
			});
			expect(data.albums[0].tracks.map((t: any) => t.title)).toEqual(
				tracks.map((t) => t.title)
			);
			expect(data.albums[0].pack).toBe(false);
		});

		it('titles no track from its file without a tracklist', async () => {
			const data = await album([file(1, '/music/01 - Song.flac')]);
			expect(data.albums[0].tracks[0]).toMatchObject({ title: null, durationMs: null });
		});

		describe("The Monkees' 4-disc deluxe set, named 01_01 - … to 04_15 - …", () => {
			const files = monkees.files.map((f) => ({
				...f,
				hash: monkees.hash,
				link: `https://example.com/${f.file_id}`,
				bytes: BigInt(f.bytes),
			}));
			const serveMonkees = () =>
				album(files, { hash: monkees.hash, mbid: monkees.mbid, fileCount: BigInt(61) });
			// 12, 16, 18 and 15 tracks, each disc counted from 1.
			const discs = [12, 16, 18, 15].flatMap((count, d) =>
				Array.from({ length: count }, (_, i) => [d + 1, i + 1])
			);

			it('numbers tracks disc by disc and titles none from a file', async () => {
				const { tracks } = (await serveMonkees()).albums[0];

				expect(tracks.map((t: any) => [t.disc, t.trackNumber])).toEqual(discs);
				expect(tracks.map((t: any) => t.title)).toEqual(Array(61).fill(null));
				const served = JSON.stringify(
					tracks.map(({ title, disc }: any) => ({ title, disc }))
				);
				expect(served).not.toMatch(/Monkees|Stereo Mix/);
			});

			it('titles a disc from MusicBrainz by disc and position once enriched', async () => {
				// The release the backfill picks for it (see pickRelease): the 12-track 1966 album.
				const { tracks: tracklist } = enrichment(
					monkees.mbid,
					monkeesGroup as unknown as MbReleaseGroup,
					monkeesRelease as unknown as MbRelease
				);
				mockedPrisma.musicTrackMetadata.findMany.mockResolvedValue(tracklist as any);

				const { tracks } = (await serveMonkees()).albums[0];

				// Disc 1 is the album; MusicBrainz spells "Papa Jean's Blues", the file "Papa Gene's".
				expect(tracks.slice(0, 12).map((t: any) => t.title)).toEqual(
					tracklist.map((t) => t.title)
				);
				expect(tracks[4]).toMatchObject({
					title: "Papa Jean's Blues",
					disc: 1,
					trackNumber: 5,
					durationMs: 115000,
				});
				expect(tracks.slice(12).map((t: any) => t.title)).toEqual(Array(49).fill(null));
				expect(tracks.map((t: any) => [t.disc, t.trackNumber])).toEqual(discs);
			});
		});
	});

	it('returns 500 on error', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockedPrisma.$queryRaw.mockRejectedValue(new Error('DB error'));

		const res = await get({});

		expect(res._getStatusCode()).toBe(500);
		expect(res._getData()).toEqual({ error: 'Failed to fetch music library' });
	});
});
