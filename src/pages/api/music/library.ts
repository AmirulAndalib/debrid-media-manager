import {
	albumSearchSql,
	countAlbums,
	MUSIC_ALBUM_TYPES,
	MUSIC_SORTS,
	MusicAlbum,
	MusicAlbumType,
	MusicSortOption,
	queryAlbums,
	withPackFlags,
	withTracks,
} from '@/services/musicCatalog';
import { Prisma } from '@prisma/client';
import { NextApiRequest, NextApiResponse } from 'next';

export type { MusicAlbum, MusicTrack } from '@/services/musicCatalog';

export interface MusicLibraryResponse {
	albums: MusicAlbum[];
	totalAlbums: number;
	totalTracks: number;
	page?: number;
	limit?: number;
	hasMore?: boolean;
	nextPage?: number | null;
}

function getStringQuery(value: string | string[] | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function getPositiveInt(value: string | string[] | undefined, fallback: number): number {
	const rawValue = getStringQuery(value);
	const parsed = rawValue ? parseInt(rawValue, 10) : NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getSortOption(value: string | string[] | undefined): MusicSortOption {
	const sortBy = getStringQuery(value);
	return sortBy === 'name' || sortBy === 'artist' || sortBy === 'year' ? sortBy : 'recent';
}

/**
 * `?hash=` is one album with its tracks. Otherwise a page of albums, one per
 * release group, searched (`search`), filtered (`type`) and sorted (`sortBy`)
 * in SQL; `summary=1` leaves the tracks out.
 */
export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse<MusicLibraryResponse | { error: string }>
) {
	if (req.method !== 'GET') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	try {
		const includeTracks = req.query.summary !== '1';
		const hash = getStringQuery(req.query.hash);
		const attach = includeTracks ? withTracks : withPackFlags;

		if (hash) {
			const albums = await attach(
				(await queryAlbums({ hash, order: MUSIC_SORTS.recent, limit: 1 })).albums
			);
			return res.status(200).json({
				albums,
				totalAlbums: albums.length,
				totalTracks: albums.reduce((sum, album) => sum + album.trackCount, 0),
			});
		}

		const page = getPositiveInt(req.query.page, 1);
		const limit = Math.min(getPositiveInt(req.query.limit, 48), 96);
		const offset = (page - 1) * limit;
		const search = getStringQuery(req.query.search)?.trim() ?? '';
		const typeParam = getStringQuery(req.query.type);
		const type =
			typeParam && Object.hasOwn(MUSIC_ALBUM_TYPES, typeParam)
				? MUSIC_ALBUM_TYPES[typeParam as MusicAlbumType]
				: undefined;
		const filters: Prisma.Sql[] = [];
		if (search) filters.push(albumSearchSql(search));
		if (type) filters.push(Prisma.sql`md.primaryType = ${type}`);

		const { albums, ...pageTotals } = await queryAlbums({
			filters,
			order: MUSIC_SORTS[getSortOption(req.query.sortBy)],
			limit,
			offset,
		});
		const totals = albums.length || !offset ? pageTotals : await countAlbums(filters);
		const hasMore = offset + limit < totals.totalAlbums;

		res.status(200).json({
			albums: await attach(albums),
			...totals,
			page,
			limit,
			hasMore,
			nextPage: hasMore ? page + 1 : null,
		});
	} catch (error) {
		console.error('Error fetching music library:', error);
		res.status(500).json({ error: 'Failed to fetch music library' });
	}
}
