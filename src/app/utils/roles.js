/**
 * Role helpers shared across buyer + agent dashboards.
 * Keeping the logic in one place so every redirect uses the same rules.
 */

export function isBuyer(u) {
  return !!(u?.isBuyer || u?.roles?.includes('buyer'));
}

export function isAgent(u) {
  return !!(u?.agent || u?.isAgent || u?.roles?.includes('agent'));
}

export function isBuyerOnly(u) {
  return isBuyer(u) && !isAgent(u);
}

/**
 * A leadership-only account (an agency principal or coach invited to the Leadership Hub): it has the
 * 'leadership' role and neither agent nor buyer. It lands on, and is kept to, the Leadership Hub.
 * This is only about where the interface sends someone — access to the Hub's data is always decided
 * server-side from `officeAdminInfo.leadershipUids`, never from this flag.
 */
export function isLeadershipOnly(u) {
  return !!u?.roles?.includes('leadership') && !isAgent(u) && !isBuyer(u);
}

export function defaultDashboardFor(u) {
  if (isLeadershipOnly(u)) return '/dashboard/leadership';
  return isBuyerOnly(u) ? '/buyer-dashboard' : '/dashboard';
}
