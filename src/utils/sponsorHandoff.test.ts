import { afterEach, describe, expect, it } from 'vitest';
import { hasSponsorHandoff, takeSponsorHandoffKey } from './sponsorHandoff';

const KEY = 'k'.repeat(64);

afterEach(() => {
	window.history.replaceState(null, '', '/');
});

describe('sponsorHandoff', () => {
	it('sees nothing without a fragment', () => {
		window.history.replaceState(null, '', '/settings');
		expect(hasSponsorHandoff()).toBe(false);
		expect(takeSponsorHandoffKey()).toBeNull();
	});

	it('reads the key and scrubs it from the address in one step', () => {
		window.history.replaceState(null, '', `/settings?x=1#apikey=${KEY}`);
		expect(hasSponsorHandoff()).toBe(true);
		expect(takeSponsorHandoffKey()).toBe(KEY);
		expect(window.location.href.endsWith('/settings?x=1')).toBe(true);
		expect(hasSponsorHandoff()).toBe(false);
	});

	it('decodes an encoded key and ignores other fragment fields', () => {
		window.history.replaceState(
			null,
			'',
			`/settings#tab=sponsor&apikey=${encodeURIComponent(' ' + KEY)}`
		);
		expect(takeSponsorHandoffKey()).toBe(KEY);
	});
});
