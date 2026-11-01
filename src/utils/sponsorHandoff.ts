/**
 * gatekeeper hands a sponsor over as `/settings#apikey=<key>`, so a new browser
 * never has to find and paste the key. The fragment reaches no server and no
 * Referer, and it is scrubbed from the address bar, and so from history, in the
 * same step that reads it.
 */
const HANDOFF = /(?:^#|[#&])apikey=([^&]+)/;

export function hasSponsorHandoff(): boolean {
	return typeof window !== 'undefined' && HANDOFF.test(window.location.hash);
}

/** The handed-over key, removed from the URL as it is read; null when there is none. */
export function takeSponsorHandoffKey(): string | null {
	if (typeof window === 'undefined') return null;
	const match = HANDOFF.exec(window.location.hash);
	if (!match) return null;
	window.history.replaceState(null, '', window.location.pathname + window.location.search);
	return decodeURIComponent(match[1]).trim();
}
