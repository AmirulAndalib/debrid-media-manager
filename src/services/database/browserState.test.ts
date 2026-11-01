import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BrowserStateService } from './browserState';

const prismaMock = vi.hoisted(() => ({
	browserState: {
		findUnique: vi.fn(),
		upsert: vi.fn(),
		deleteMany: vi.fn(),
	},
}));

vi.mock('./client', () => ({
	DatabaseClient: class {
		prisma = prismaMock;
	},
}));

const STATE = JSON.stringify({ 'tb:apiKey': 'tb-' + 'k'.repeat(30) });

describe('BrowserStateService', () => {
	let service: BrowserStateService;

	beforeEach(() => {
		service = new BrowserStateService();
		for (const fn of Object.values(prismaMock.browserState)) (fn as Mock).mockReset();
	});

	describe('getBrowserState', () => {
		it('reads the state behind one provider login', async () => {
			const row = { state: STATE, updatedAt: new Date('2026-11-01') };
			(prismaMock.browserState.findUnique as Mock).mockResolvedValue(row);

			await expect(service.getBrowserState('rd', 'abc123def456')).resolves.toEqual(row);
			expect(prismaMock.browserState.findUnique).toHaveBeenCalledWith({
				where: { service_userId: { service: 'rd', userId: 'abc123def456' } },
				select: { state: true, updatedAt: true },
			});
		});

		it('answers null when nothing is stored', async () => {
			(prismaMock.browserState.findUnique as Mock).mockResolvedValue(null);

			await expect(service.getBrowserState('tb', 'abc123def456')).resolves.toBeNull();
		});
	});

	describe('saveBrowserState', () => {
		it('replaces an existing state rather than failing on the key', async () => {
			await service.saveBrowserState('ad', 'abc123def456', STATE);

			expect(prismaMock.browserState.upsert).toHaveBeenCalledWith({
				where: { service_userId: { service: 'ad', userId: 'abc123def456' } },
				update: { state: STATE },
				create: { service: 'ad', userId: 'abc123def456', state: STATE },
			});
		});
	});

	describe('deleteBrowserState', () => {
		it('reports whether anything was stored', async () => {
			(prismaMock.browserState.deleteMany as Mock).mockResolvedValue({ count: 1 });
			await expect(service.deleteBrowserState('pm', 'abc123def456')).resolves.toBe(true);
			expect(prismaMock.browserState.deleteMany).toHaveBeenCalledWith({
				where: { service: 'pm', userId: 'abc123def456' },
			});

			(prismaMock.browserState.deleteMany as Mock).mockResolvedValue({ count: 0 });
			await expect(service.deleteBrowserState('pm', 'abc123def456')).resolves.toBe(false);
		});
	});
});
