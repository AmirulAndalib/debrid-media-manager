import useLocalStorage from '@/hooks/localStorage';
import { SYNC_ENABLED_KEY } from '@/utils/browserStateKeys';
import {
	collectState,
	forgetBrowserState,
	saveBrowserState,
	syncIdentities,
} from '@/utils/browserStateSync';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

// The opt-in for useBrowserStateSync; that hook keeps the saved state current once this is on.
export const SyncAcrossDevicesPanel = () => {
	const [stored, setStored] = useLocalStorage<boolean>(SYNC_ENABLED_KEY);
	// In state rather than read from storage, as useSponsor does for apiKey: the
	// server has no storage, so the first client render must match its markup.
	const [enabled, setEnabled] = useState(false);
	const [needsLogin, setNeedsLogin] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		setEnabled(stored === true);
	}, [stored]);

	const toggle = async (on: boolean) => {
		const identities = syncIdentities();
		setBusy(true);
		if (on) {
			// Set first, so the saved state carries the setting and a restored browser keeps syncing.
			setStored(true);
			setNeedsLogin(!identities.length);
			if (identities.length && !(await saveBrowserState(identities, collectState()))) {
				setStored(null);
				toast.error('Could not save your logins and settings. Try again later.');
			}
		} else {
			// Cleared before the request, so a save already queued cannot put the state back.
			setStored(null);
			setNeedsLogin(false);
			// Without a login there is nothing to prove, so nothing to forget.
			if (identities.length) {
				if (await forgetBrowserState(identities)) {
					toast.success('Forgotten. Nothing is stored for your accounts any more.');
				} else {
					setStored(true);
					toast.error('Could not forget your logins and settings. Try again later.');
				}
			}
		}
		setBusy(false);
	};

	return (
		<div className="rounded border-2 border-gray-500/30 p-4">
			<div className="mb-2 text-sm font-semibold text-gray-100">Remember across devices</div>
			<label className="flex items-center gap-2 font-semibold">
				<input
					type="checkbox"
					className="h-5 w-5 shrink-0 rounded border-gray-600 bg-gray-800"
					checked={enabled}
					disabled={busy}
					onChange={(e) => void toggle(e.target.checked)}
				/>
				Remember my logins and settings across devices
			</label>
			{needsLogin && (
				<p className="mt-2 text-xs text-yellow-300">Connect a debrid service first</p>
			)}
			<p className="mt-2 text-xs text-gray-400">
				Log in to any one of your debrid services on a new browser and DMM brings back the
				rest: your other logins, your sponsorship, your settings. Anyone who can log in to
				one of those accounts gets all of them, so leave this off on a shared debrid
				account.
			</p>
		</div>
	);
};
