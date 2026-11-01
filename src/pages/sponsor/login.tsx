import { useSponsor } from '@/hooks/useSponsor';
import { GATEKEEPER_URL } from '@/utils/gatekeeper';
import { enableGuestMode } from '@/utils/guestMode';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { FormEvent, useState } from 'react';

/**
 * Login with the DMM API key alone, for a sponsor with no debrid account (an
 * NZB-only zurg user, say). The key links the sponsorship exactly as Settings
 * does; guest mode is what opens the site without a debrid login, and it
 * switches itself off the moment a debrid account is connected.
 */
export default function SponsorLoginPage() {
	const router = useRouter();
	const { link } = useSponsor();
	const [apiKey, setApiKey] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError('');
		setBusy(true);
		const result = await link(apiKey);
		setBusy(false);
		if (!result.ok) {
			setError(result.error ?? 'Could not verify that key');
			return;
		}
		enableGuestMode();
		await router.replace(getSafeRedirectPath(router.query.redirect, '/'));
	};

	return (
		<div className="flex min-h-screen flex-col items-center px-4 pt-[12vh] pb-8">
			<Head>
				<title>Debrid Media Manager - DMM key login</title>
			</Head>
			<div className="sibling-space-y-4 w-full max-w-md p-4">
				<h1 className="text-center text-2xl font-bold">Log in with your DMM key</h1>
				<p className="text-center text-sm text-gray-400">
					For sponsors without a debrid account. Everything a sponsorship opens works from
					this key alone; your library, casting and transfers need a debrid account, which
					you can connect at any time.
				</p>
				{error && <p className="text-center text-red-500">{error}</p>}
				<form onSubmit={handleSubmit} className="sibling-space-y-4">
					<div>
						<label htmlFor="apiKey" className="block text-sm font-medium">
							DMM API key
						</label>
						<input
							type="text"
							id="apiKey"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							autoComplete="off"
							spellCheck={false}
							className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
							placeholder="64-character DMM API key"
							required
						/>
					</div>
					<div className="sibling-space-y-2 flex flex-col">
						<button
							type="submit"
							disabled={busy || !apiKey.trim()}
							className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{busy ? 'Checking...' : 'Save API Key'}
						</button>
						<a
							href={GATEKEEPER_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="rounded bg-green-700 px-4 py-2 text-center text-white hover:bg-green-800"
						>
							Get a key by sponsoring on gatekeeper
						</a>
					</div>
				</form>
			</div>
		</div>
	);
}
