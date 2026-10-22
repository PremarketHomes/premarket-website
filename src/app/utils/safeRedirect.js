/**
 * Validates a `returnTo`-style redirect target before it's ever passed
 * to router.push/replace. The existing returnTo usage elsewhere in
 * this app (signup/page.js -> buyer-dashboard/welcome/page.js,
 * LikeButton.js) passes the raw query-param value straight into
 * router.replace() with no validation at all — effectively an open
 * redirect if someone crafts `?returnTo=https://evil.example`. This
 * helper is deliberately NOT applied there (out of scope for this fix,
 * flagged separately) but IS applied everywhere login now consumes a
 * returnTo (see login/page.js, office-invite/page.js), since this is
 * the one new path explicitly required to validate it.
 *
 * Only ever allows a same-origin, relative, non-protocol path:
 *   - must start with exactly one leading slash
 *   - must not start with `//` (protocol-relative, e.g. //evil.com)
 *   - must not contain `://` anywhere (rules out javascript:, an
 *     embedded absolute URL, etc.)
 *   - must not contain a backslash (browsers normalize \ to / in some
 *     contexts, a known bypass for naive single-character checks)
 */
export function getSafeReturnTo(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.includes('://')) return null;
  if (raw.includes('\\')) return null;
  return raw;
}
