/**
 * A hardened fetch for server-side code that downloads a URL supplied
 * by an authenticated-but-untrusted caller (an agency/office admin
 * pasting a logo URL) — used by /api/branding/extract-colors, which
 * both the personal and office branding flows now share rather than
 * each growing their own URL-fetching logic.
 *
 * Without this, an authenticated user could point `logoUrl` at
 * `http://169.254.169.254/...` (cloud metadata), `http://localhost:PORT/...`,
 * or any other internal-only address and have THIS server fetch it on
 * their behalf — a classic SSRF. Mitigated here, not by trusting the
 * URL string alone (which DNS rebinding can defeat), by resolving the
 * hostname first and checking every resolved address against private/
 * reserved IP ranges before ever calling fetch.
 *
 * Also caps response size and enforces a timeout — a malicious or
 * merely huge "logo" shouldn't be able to tie up a server-side
 * request indefinitely or exhaust memory.
 */

import dns from 'node:dns';
import net from 'node:net';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB — generous for a logo, nowhere near "any arbitrary file"

export class UnsafeUrlError extends Error {}

/** True if this IP (v4 or v6) is loopback, link-local, private-range,
 * or otherwise not a legitimate public destination for this server to
 * fetch on a user's behalf. */
function isPrivateOrReservedIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local (cloud metadata lives here)
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (private)
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.replace('::ffff:', '')); // IPv4-mapped
    return false;
  }
  return true; // couldn't classify it — refuse rather than guess safe
}

async function assertPublicHostname(hostname) {
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new UnsafeUrlError('Could not resolve this URL\'s host');
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError('Could not resolve this URL\'s host');
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new UnsafeUrlError('This URL points to a non-public address, which is not allowed');
    }
  }
}

/**
 * Validates and fetches an external URL safely. Returns the response
 * body as a Buffer. Throws UnsafeUrlError for anything that fails the
 * safety checks (caller should treat this as a 4xx, not a 5xx), or a
 * plain Error for a genuine fetch/timeout/size failure.
 */
const MAX_REDIRECTS = 5;

export async function safeFetchExternalImage(rawUrl) {
  let currentUrl = rawUrl;
  let response;

  // Redirects are followed manually, one hop at a time, re-validating
  // the NEW hostname before following it — `redirect: 'follow'` would
  // let a URL that passes the DNS check redirect straight to a
  // private address, bypassing the check entirely.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new UnsafeUrlError('Not a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new UnsafeUrlError('Only http/https URLs are allowed');
    }

    await assertPublicHostname(parsed.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetch(parsed.toString(), { signal: controller.signal, redirect: 'manual' });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect with no location header');
      currentUrl = new URL(location, parsed).toString();
      continue;
    }
    break;
  }

  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_BYTES) {
    throw new Error('Image is too large');
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    // Environments without a streamable body (rare) — fall back to a
    // single read, still capped afterwards.
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error('Image is too large');
    return buffer;
  }

  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error('Image is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
