import { isIPv4 } from 'node:net';

/**
 * Point `<hash>.rex-direct.debridmediamanager.com` at a rex server's own IP
 * (`src/pages/api/rex-direct/register`), and its LAN name `lan.<hash>.rex-direct…`
 * at the server's address on its home network.
 *
 * The public name's IP is always the request's source address, never a value the
 * caller sends, so the service cannot be used to aim a name under our domain at
 * someone else's server. The LAN name's IP is caller-supplied, which is safe only
 * because it must be an RFC 1918 private address (`isRfc1918Ipv4`): those are not
 * routable on the internet, so nobody can aim our domain at a public host through it.
 * The Cloudflare token is zone-scoped to DNS edit on this one zone and lives only in
 * the server env.
 *
 * The record is looked up through the Cloudflare API, never a DNS resolver: a
 * resolver query for a name that does not exist yet is negatively cached by the
 * authoritative servers for 30 minutes (the zone's SOA minimum), which would then
 * hide the record we just created.
 */
const CF = 'https://api.cloudflare.com/client/v4';

function config() {
	const token = process.env.REXDIRECT_CF_TOKEN;
	const zone = process.env.REXDIRECT_CF_ZONE;
	const base = process.env.REXDIRECT_BASE || 'rex-direct.debridmediamanager.com';
	if (!token || !zone) {
		throw new Error('rex-direct: REXDIRECT_CF_TOKEN and REXDIRECT_CF_ZONE must be set');
	}
	return { token, zone, base };
}

export function rexDirectHostname(hash: string): string {
	return `${hash}.${config().base}`;
}

/** One label under the server's own name, so its `*.<hash>…` certificate covers it. */
export function rexDirectLanHostname(hash: string): string {
	return `lan.${rexDirectHostname(hash)}`;
}

/** A dotted IPv4 literal in 10/8, 172.16/12 or 192.168/16, the only LAN IPs we point a name at. */
export function isRfc1918Ipv4(ip: string): boolean {
	if (!isIPv4(ip)) return false;
	const [a, b] = ip.split('.').map(Number);
	return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function cf(path: string, init: RequestInit, token: string): Promise<any> {
	const res = await fetch(`${CF}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			...(init.headers || {}),
		},
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body?.success === false) {
		const detail = Array.isArray(body?.errors) ? JSON.stringify(body.errors) : res.status;
		throw new Error(`rex-direct: Cloudflare ${path} failed: ${detail}`);
	}
	return body;
}

/**
 * Ensure `name` (a server's `<hash>.rex-direct…`) is a DNS-only A record for `ip`.
 * Grey-cloud (not proxied) on purpose: proxying Plex streaming through Cloudflare
 * violates their free TOS, and TLS terminates at the server.
 */
export async function upsertRexDirectRecord(name: string, ip: string): Promise<void> {
	const { token, zone } = config();
	const list = await cf(
		`/zones/${zone}/dns_records?type=A&name=${encodeURIComponent(name)}`,
		{ method: 'GET' },
		token
	);
	const record = Array.isArray(list.result) ? list.result[0] : undefined;
	const payload = JSON.stringify({ type: 'A', name, content: ip, ttl: 120, proxied: false });
	if (record) {
		if (record.content !== ip) {
			await cf(
				`/zones/${zone}/dns_records/${record.id}`,
				{ method: 'PUT', body: payload },
				token
			);
		}
	} else {
		await cf(`/zones/${zone}/dns_records`, { method: 'POST', body: payload }, token);
	}
}

/**
 * The ACME DNS-01 challenge record for a server's own certificate
 * (`src/utils/rexDirectAcme.ts`): a TXT at `_acme-challenge.<name>`. Returns the
 * record id so the challenge can be cleaned up once validated.
 */
export async function createRexDirectTxt(name: string, content: string): Promise<string> {
	const { token, zone } = config();
	const body = await cf(
		`/zones/${zone}/dns_records`,
		{
			method: 'POST',
			body: JSON.stringify({
				type: 'TXT',
				name: `_acme-challenge.${name}`,
				content,
				ttl: 60,
			}),
		},
		token
	);
	return body.result.id;
}

export async function deleteRexDirectRecord(id: string): Promise<void> {
	const { token, zone } = config();
	await cf(`/zones/${zone}/dns_records/${id}`, { method: 'DELETE' }, token);
}
