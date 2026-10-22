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

/**
 * Decides where a successful (or already-active) login should go —
 * the one function login/page.js's single redirect effect delegates
 * to, since "already authenticated on page load" and "just signed in
 * via the form" both arrive at that effect via the exact same
 * user/userData update and must never be two separately-maintained
 * redirect paths.
 *
 * With a validated returnTo present (the office-invite case), this
 * resolves the instant `user` is set — it deliberately never waits on
 * `userData`, which that case has no use for at all (unlike
 * defaultDashboardFor, which needs it to tell a buyer from an agent).
 * Returns null when it isn't time to redirect yet (still loading, no
 * user, or — only in the no-returnTo case — still waiting on userData).
 */
export function resolveLoginRedirect({ authLoading, user, userData, safeReturnTo, defaultDashboardFor }) {
  if (authLoading || !user) return null;
  if (safeReturnTo) return safeReturnTo;
  if (userData) return defaultDashboardFor(userData);
  return null;
}
