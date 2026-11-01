import { SYNC_ENABLED_KEY } from '@/utils/browserStateKeys';
import { forgetBrowserState, saveBrowserState } from '@/utils/browserStateSync';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import toast from 'react-hot-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncAcrossDevicesPanel } from './SyncAcrossDevicesPanel';

vi.mock('@/utils/browserStateSync', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/browserStateSync')>()),
	saveBrowserState: vi.fn(),
	forgetBrowserState: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const saveMock = vi.mocked(saveBrowserState);
const forgetMock = vi.mocked(forgetBrowserState);
const TB = { service: 'tb', apiKey: 'tb-key' } as const;
const checkbox = () =>
	screen.getByRole('checkbox', {
		name: 'Remember my logins and settings across devices',
	}) as HTMLInputElement;

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
	saveMock.mockResolvedValue(true);
	forgetMock.mockResolvedValue(true);
});

describe('SyncAcrossDevicesPanel', () => {
	it('saves this browser straight away when turned on', async () => {
		localStorage.setItem('tb:apiKey', '"tb-key"');
		render(<SyncAcrossDevicesPanel />);
		await userEvent.click(checkbox());

		await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
		// The flag is in the saved state, so a restored browser keeps syncing.
		expect(saveMock).toHaveBeenCalledWith([TB], {
			'tb:apiKey': '"tb-key"',
			[SYNC_ENABLED_KEY]: 'true',
		});
		expect(checkbox().checked).toBe(true);
	});

	it('asks for a debrid login first when there is none', async () => {
		render(<SyncAcrossDevicesPanel />);
		await userEvent.click(checkbox());

		expect(await screen.findByText('Connect a debrid service first')).toBeInTheDocument();
		expect(saveMock).not.toHaveBeenCalled();
		expect(localStorage.getItem(SYNC_ENABLED_KEY)).toBe('true');
	});

	it('turns back off when the save fails', async () => {
		localStorage.setItem('tb:apiKey', '"tb-key"');
		saveMock.mockResolvedValue(false);
		render(<SyncAcrossDevicesPanel />);
		await userEvent.click(checkbox());

		await waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(localStorage.getItem(SYNC_ENABLED_KEY)).toBeNull();
		expect(checkbox().checked).toBe(false);
	});

	it('forgets the saved state and clears the flag when turned off', async () => {
		localStorage.setItem('tb:apiKey', '"tb-key"');
		localStorage.setItem(SYNC_ENABLED_KEY, 'true');
		render(<SyncAcrossDevicesPanel />);
		await waitFor(() => expect(checkbox().checked).toBe(true));
		await userEvent.click(checkbox());

		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				'Forgotten. Nothing is stored for your accounts any more.'
			)
		);
		expect(forgetMock).toHaveBeenCalledWith([TB]);
		expect(localStorage.getItem(SYNC_ENABLED_KEY)).toBeNull();
		expect(checkbox().checked).toBe(false);
	});

	it('stays on when the forget fails', async () => {
		localStorage.setItem('tb:apiKey', '"tb-key"');
		localStorage.setItem(SYNC_ENABLED_KEY, 'true');
		forgetMock.mockResolvedValue(false);
		render(<SyncAcrossDevicesPanel />);
		await waitFor(() => expect(checkbox().checked).toBe(true));
		await userEvent.click(checkbox());

		await waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(localStorage.getItem(SYNC_ENABLED_KEY)).toBe('true');
		expect(checkbox().checked).toBe(true);
	});

	it('renders unchecked before mount, whatever is stored, so hydration matches the server', () => {
		localStorage.setItem(SYNC_ENABLED_KEY, 'true');
		expect(renderToString(<SyncAcrossDevicesPanel />)).not.toContain('checked');
	});
});
