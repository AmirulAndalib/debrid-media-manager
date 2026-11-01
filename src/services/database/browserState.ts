import { DatabaseClient } from './client';

/**
 * The synced localStorage behind one provider login. The state holds other
 * providers' credentials, so it is only ever read for a caller who has just
 * proved that login to the provider itself.
 */
export class BrowserStateService extends DatabaseClient {
	public async getBrowserState(
		service: string,
		userId: string
	): Promise<{ state: string; updatedAt: Date } | null> {
		return this.prisma.browserState.findUnique({
			where: { service_userId: { service, userId } },
			select: { state: true, updatedAt: true },
		});
	}

	public async saveBrowserState(service: string, userId: string, state: string): Promise<void> {
		await this.prisma.browserState.upsert({
			where: { service_userId: { service, userId } },
			update: { state },
			create: { service, userId, state },
		});
	}

	/** False when there was nothing stored, which is not an error. */
	public async deleteBrowserState(service: string, userId: string): Promise<boolean> {
		const result = await this.prisma.browserState.deleteMany({ where: { service, userId } });
		return result.count > 0;
	}
}
