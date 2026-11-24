import { createHash, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

/**
 * Private share links for the Open Home concept (server only).
 *
 * A share link is https://premarket.homes/concepts/open-home/share/<token>. Opening it sets an HttpOnly cookie that
 * lets that browser view the concept's presenter pages (pitch, demo, agent dashboard, sign) without a Premarket
 * account. The concept is demo data only, so the link reveals no campaign, buyer, opinion or admin function.
 *
 * Only the SHA-256 of each token is in the code (this repository is public). The token itself (192 random bits) is
 * known only to whoever was given the link, so it can't be guessed or read from the repo.
 *
 * Revoke a link by removing its entry here (or from OPEN_HOME_SHARE_SHA256) and deploying. Browsers that already
 * opened it lose access on their next page load, because the cookie holds the token and is re-checked every time.
 */
export const SHARE_COOKIE = 'pm_oh_share';
export const SHARE_COOKIE_PATH = '/concepts/open-home';
export const SHARE_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

const SHARE_LINKS = [
  // Partner preview link (created 2026-11-25), sent by Premarket to the people it is presenting the concept to.
  { id: 'partner-preview-2026-11', sha256: '13f002caf312a35197575dddd876219df175bedcd900ddcd093dd116671732d3' },
];

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,64}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** Accepted token hashes: the list above plus any in OPEN_HOME_SHARE_SHA256 (comma-separated hex), read per call. */
function acceptedHashes() {
  const fromEnv = (process.env.OPEN_HOME_SHARE_SHA256 || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => HEX_SHA256.test(s));
  return [...SHARE_LINKS.map((l) => l.sha256), ...fromEnv];
}

export function isValidShareToken(token) {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return false;
  const digest = createHash('sha256').update(token).digest();
  // Compare every entry in constant time, so timing reveals nothing about how close a guess was.
  let ok = false;
  for (const hex of acceptedHashes()) {
    if (timingSafeEqual(Buffer.from(hex, 'hex'), digest)) ok = true;
  }
  return ok;
}

/** True when this request carries a valid share cookie. */
export async function hasShareAccess() {
  const store = await cookies();
  return isValidShareToken(store.get(SHARE_COOKIE)?.value);
}

/**
 * Whether a presenter page must ask for a Premarket platform-admin sign-in: on production only, and not for a browser
 * that opened a valid share link. Previews (behind Vercel's login) and local development never ask.
 */
export async function requireAdminSignIn() {
  if (process.env.VERCEL_ENV !== 'production') return false;
  return !(await hasShareAccess());
}
