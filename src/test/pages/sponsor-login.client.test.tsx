import SponsorLoginPage from '@/pages/sponsor/login';
import { GUEST_MODE_KEY } from '@/utils/guestMode';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useRouterMock, replaceMock } = vi.hoisted(() => ({
	useRouterMock: vi.fn(),
	replaceMock: vi.fn(),
}));

vi.mock('next/router', () => ({ useRouter: useRouterMock }));

function makeToken(claims: object) {
	return `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
}

const ACTIVE = {
	shortId: 'ZP1M',
	githubUsername: 'someone',
	sources: ['github'],
	keyVersion: 1,
	exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
};

const KEY = 'k'.repeat(64);

async function submit(key: string) {
	render(<SponsorLoginPage />);
	fireEvent.change(screen.getByLabelText('DMM API key'), { target: { value: key } });
	fireEvent.click(screen.getByRole('button', { name: 'Save API Key' }));
}

describe('SponsorLoginPage', () => {
	beforeEach(() => {
		window.localStorage.clear();
		vi.clearAllMocks();
		vi.stubGlobal('fetch', vi.fn());
		replaceMock.mockResolvedValue(true);
		useRouterMock.mockReturnValue({ query: {}, replace: replaceMock });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('links a good key, opens guest mode and lands on the home page', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			json: async () => ({ isSponsor: true, token: makeToken(ACTIVE), expiresIn: 604800 }),
		});
		await submit(KEY);

		await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
		expect(fetch).toHaveBeenCalledWith(
			'/api/sponsor/link',
			expect.objectContaining({ body: JSON.stringify({ apiKey: KEY }) })
		);
		expect(window.localStorage.getItem(GUEST_MODE_KEY)).toBe('true');
		expect(window.localStorage.getItem('dmm:apiKey')).toBe(JSON.stringify(KEY));
	});

	it('honours a safe redirect query', async () => {
		useRouterMock.mockReturnValue({ query: { redirect: '/wanted' }, replace: replaceMock });
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			json: async () => ({ isSponsor: true, token: makeToken(ACTIVE), expiresIn: 604800 }),
		});
		await submit(KEY);
		await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/wanted'));
	});

	it('shows the server error for a refused key and stays put', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			json: async () => ({ isSponsor: false, error: 'Unknown API key' }),
		});
		await submit(KEY);

		expect(await screen.findByText('Unknown API key')).toBeInTheDocument();
		expect(replaceMock).not.toHaveBeenCalled();
		expect(window.localStorage.getItem(GUEST_MODE_KEY)).toBeNull();
		expect(window.localStorage.getItem('dmm:apiKey')).toBeNull();
	});

	it('points a visitor without a key at gatekeeper', () => {
		render(<SponsorLoginPage />);
		expect(
			screen.getByRole('link', { name: 'Get a key by sponsoring on gatekeeper' })
		).toHaveAttribute('href', 'https://gatekeeper.debridmediamanager.com');
	});
});
