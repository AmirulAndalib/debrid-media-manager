import { repository as db } from '@/services/repository';
import { generateAllDebridUserId } from '@/utils/allDebridCastApiHelpers';
import { SYNC_SERVICES, type SyncIdentity, type SyncService } from '@/utils/browserStateKeys';
import { generateUserId } from '@/utils/castApiHelpers';
import {
	castAccessToken,
	forgetCastAccessToken,
	type RdCastCredentials,
} from '@/utils/castRdToken';
import { generateDebridLinkUserId } from '@/utils/debridLinkCastApiHelpers';
import { generateOffcloudUserId } from '@/utils/offcloudCastApiHelpers';
import { generatePremiumizeUserId } from '@/utils/premiumizeCastApiHelpers';
import { generateTorBoxUserId } from '@/utils/torboxCastApiHelpers';

const filled = (value: unknown): value is string => typeof value === 'string' && value !== '';

async function rdUserId(credentials: RdCastCredentials): Promise<string> {
	// getToken caches a minted token by clientId alone, so without this a caller
	// holding only someone's clientId would be handed their token and their state.
	forgetCastAccessToken(credentials);
	const token = await castAccessToken(credentials);
	if (!token) throw new Error('no token found');
	return generateUserId(token);
}

/** A sponsor key stands for its sponsorship; the gatekeeper `shortId` outlives a key reset. */
async function sponsorShortId(apiKey: string): Promise<string> {
	const lookup = await db.getSponsorByDmmApiKey(apiKey);
	if (!lookup?.isSponsor) throw new Error('not an active sponsorship');
	return lookup.shortId;
}

const USER_ID: Record<Exclude<SyncService, 'rd'>, (apiKey: string) => Promise<string>> = {
	tb: generateTorBoxUserId,
	ad: generateAllDebridUserId,
	pm: generatePremiumizeUserId,
	oc: generateOffcloudUserId,
	dl: generateDebridLinkUserId,
	dmm: sponsorShortId,
};

/**
 * The provider's cast user id for this login, or null when the shape is wrong or
 * the provider refuses it.
 *
 * ponytail: the generate* helpers throw one error for "refused" and "provider
 * down" alike, so an outage reads as a refused login here too.
 */
export async function verifyIdentity(identity: SyncIdentity): Promise<string | null> {
	const raw = identity as Record<string, unknown> | null;
	if (!raw || typeof raw !== 'object') return null;
	const service = raw.service as SyncService;
	if (!SYNC_SERVICES.includes(service)) return null;

	let credentials: RdCastCredentials;
	if (filled(raw.apiKey)) credentials = { apiKey: raw.apiKey };
	else if (
		service === 'rd' &&
		filled(raw.clientId) &&
		filled(raw.clientSecret) &&
		filled(raw.refreshToken)
	)
		credentials = {
			clientId: raw.clientId,
			clientSecret: raw.clientSecret,
			refreshToken: raw.refreshToken,
		};
	else return null;

	try {
		return service === 'rd'
			? await rdUserId(credentials)
			: await USER_ID[service](credentials.apiKey!);
	} catch (error) {
		// Only the message: a raw AxiosError carries the OAuth POST body.
		console.error(
			`Browser state: ${service} refused a login:`,
			error instanceof Error ? error.message : String(error)
		);
		return null;
	}
}
