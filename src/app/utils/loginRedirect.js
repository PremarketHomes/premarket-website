import { getSafeReturnTo } from './safeRedirect';

/**
 * Where to send a logged-out visitor so that, after signing in, the login page
 * (which already honours a validated `returnTo`) brings them back to exactly
 * the page they were trying to reach — path, query string and all.
 *
 * Used by every /dashboard/* auth guard so deep links from emails survive
 * login. Anything that isn't a same-origin relative path (see getSafeReturnTo),
 * or that points at an auth page itself, falls back to plain /login.
 */
export function buildLoginUrl(returnTo) {
  const safe = getSafeReturnTo(returnTo);
  if (!safe || /^\/(login|join|signup)(\/|\?|$)/.test(safe)) return '/login';
  return `/login?returnTo=${encodeURIComponent(safe)}`;
}

export function loginUrlForCurrentPage() {
  if (typeof window === 'undefined') return '/login';
  return buildLoginUrl(`${window.location.pathname}${window.location.search}`);
}
