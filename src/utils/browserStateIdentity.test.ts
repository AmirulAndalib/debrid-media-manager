import { repository } from '@/services/repository';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyIdentity } from './browserStateIdentity';

const mocks = vi.hoisted(() => ({
	castAccessToken: vi.fn(),
	forgetCastAccessToken: vi.fn(),
	generateUserId: vi.fn(),
	tb: vi.fn(),
	ad: vi.fn(),
	pm: vi.fn(),
	oc: vi.fn(),
	dl: vi.fn(),
}));

vi.mock('@/utils/castRdToken', () => ({
	castAccessToken: mocks.castAccessToken,
	forgetCastAccessToken: mocks.forgetCastAccessToken,
}));
vi.mock('@/utils/castApiHelpers', () => ({ generateUserId: mocks.generateUserId }));
vi.mock('@/utils/torboxCastApiHelpers', () => ({ generateTorBoxUserId: mocks.tb }));
vi.mock('@/utils/allDebridCastApiHelpers', () => ({ generateAllDebridUserId: mocks.ad }));
vi.mock('@/utils/premiumizeCastApiHelpers', () => ({ generatePremiumizeUserId: mocks.pm }));
vi.mock('@/utils/offcloudCastApiHelpers', () => ({ generateOffcloudUserId: mocks.oc }));
vi.mock('@/utils/debridLinkCastApiHelpers', () => ({ generateDebridLinkUserId: mocks.dl }));
vi.mock('@/services/repository');

const SECRET = 'secret-' + 's'.repeat(24);
const TRIPLE = { service: 'rd', clientId: 'CID123', clientSecret: SECRET, refreshToken: 'RT' };

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('verifyIdentity', () => {
	// An NZB-only sponsor has no debrid login; the sponsor key is the one thing they can prove.
	it('takes a DMM API key as its sponsorship, while that sponsorship is active', async () => {
		const key = 'k'.repeat(64);
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue({
			isSponsor: true,
			shortId: '4GKO',
		} as never);
		await expect(verifyIdentity({ service: 'dmm', apiKey: key })).resolves.toBe('4GKO');
		expect(repository.getSponsorByDmmApiKey).toHaveBeenCalledWith(key);

		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue({
			isSponsor: false,
			shortId: '4GKO',
		} as never);
		await expect(verifyIdentity({ service: 'dmm', apiKey: key })).resolves.toBeNull();
		vi.mocked(repository.getSponsorByDmmApiKey).mockResolvedValue(null);
		await expect(verifyIdentity({ service: 'dmm', apiKey: key })).resolves.toBeNull();
	});

	it('mints a Real-Debrid token from the triple and derives the cast user id', async () => {
		mocks.castAccessToken.mockResolvedValue('ACCESS');
		mocks.generateUserId.mockResolvedValue('rdUser000001');

		await expect(verifyIdentity(TRIPLE as never)).resolves.toBe('rdUser000001');
		expect(mocks.castAccessToken).toHaveBeenCalledWith({
			clientId: 'CID123',
			clientSecret: SECRET,
			refreshToken: 'RT',
		});
		expect(mocks.generateUserId).toHaveBeenCalledWith('ACCESS');
	});

	// getToken caches by clientId alone: a caller with someone else's clientId
	// and a made-up secret would otherwise get that user's cached token.
	it('drops the cached Real-Debrid token before minting, so the secret is checked', async () => {
		mocks.castAccessToken.mockResolvedValue('ACCESS');
		mocks.generateUserId.mockResolvedValue('rdUser000001');

		await verifyIdentity(TRIPLE as never);

		expect(mocks.forgetCastAccessToken).toHaveBeenCalledWith(
			expect.objectContaining({ clientId: 'CID123' })
		);
		expect(mocks.forgetCastAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.castAccessToken.mock.invocationCallOrder[0]
		);
	});

	it('takes a pasted Real-Debrid key as is', async () => {
		mocks.castAccessToken.mockResolvedValue('RDKEY');
		mocks.generateUserId.mockResolvedValue('rdUser000002');

		await expect(verifyIdentity({ service: 'rd', apiKey: 'RDKEY' })).resolves.toBe(
			'rdUser000002'
		);
		expect(mocks.castAccessToken).toHaveBeenCalledWith({ apiKey: 'RDKEY' });
	});

	it.each(['tb', 'ad', 'pm', 'oc', 'dl'] as const)('asks %s about its key', async (service) => {
		mocks[service].mockResolvedValue(`${service}User00001`);

		await expect(verifyIdentity({ service, apiKey: 'KEY' })).resolves.toBe(
			`${service}User00001`
		);
		expect(mocks[service]).toHaveBeenCalledWith('KEY');
	});

	it('answers null when the provider refuses, logging no credential', async () => {
		mocks.castAccessToken.mockRejectedValue(new Error('Request failed with status code 400'));

		await expect(verifyIdentity(TRIPLE as never)).resolves.toBeNull();
		expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(SECRET);
	});

	it('answers null when Real-Debrid mints no token', async () => {
		mocks.castAccessToken.mockResolvedValue(null);

		await expect(verifyIdentity(TRIPLE as never)).resolves.toBeNull();
		expect(mocks.generateUserId).not.toHaveBeenCalled();
	});

	it.each([
		['null', null],
		['a string', 'rd'],
		['an unknown service', { service: 'zz', apiKey: 'KEY' }],
		['an empty key', { service: 'tb', apiKey: '' }],
		['a non-string key', { service: 'tb', apiKey: 42 }],
		['a partial triple', { service: 'rd', clientId: 'CID', clientSecret: SECRET }],
		['a triple on another service', { ...TRIPLE, service: 'tb' }],
	])('refuses %s without asking any provider', async (_label, identity) => {
		await expect(verifyIdentity(identity as never)).resolves.toBeNull();
		for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled();
	});
});
