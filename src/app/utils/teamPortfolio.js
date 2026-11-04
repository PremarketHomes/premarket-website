/**
 * Shared team portfolio for the agent dashboard.
 *
 * The dashboard's own properties come from a live Firestore query on the
 * signed-in agent's uid. Teammates' properties come from GET /api/teams/properties
 * (server-authorised, read-only, redacted). This module only reshapes, merges and
 * counts those two lists — it never touches ownership, billing or permissions.
 *
 * Invariants:
 *   - a property id appears at most once (the agent's own copy always wins)
 *   - teammate rows are flagged `isTeamListing` so the UI can keep them read-only
 *   - statistics are computed from the merged, de-duplicated list for the chosen view
 */

export const TEAM_VIEWS = ['all', 'mine', 'team'];

/** A /api/teams/properties row -> the property shape the dashboard cards use. */
export function teamRowToProperty(row) {
  const status = row.status;
  return {
    id: row.id,
    formattedAddress: row.address || null,
    address: row.address || null,
    price: row.price ?? null,
    soldPrice: row.soldPrice ?? null,
    bedrooms: row.bedrooms ?? null,
    bathrooms: row.bathrooms ?? null,
    carSpaces: row.carSpaces ?? null,
    listingStatus: row.listingStatus,
    imageUrls: row.thumbnail ? [row.thumbnail] : [],
    stats: { views: row.views || 0 },
    visibility: status === 'live',
    archived: status === 'archived' || status === 'sold',
    ...(status === 'sold' ? { archivedReason: 'sold' } : {}),
    hidden: false,
    createdAt: row.createdAt || null,
    userId: row.owner?.uid || null,
    isTeamListing: true,
    listedBy: row.owner?.name || 'Teammate',
    opinions: Number.isFinite(row.opinions) ? row.opinions : 0,
  };
}

/**
 * Teammate rows -> dashboard properties, with anything already in `own`
 * (or repeated in `rows`) or owned by `selfUid` dropped, so a property can never
 * be listed or counted twice.
 */
export function teamPropertiesFrom(rows, own = [], selfUid = null) {
  const seen = new Set(own.map((p) => p.id));
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.id || seen.has(row.id)) continue;
    if (selfUid && row.owner?.uid === selfUid) continue;
    seen.add(row.id);
    out.push(teamRowToProperty(row));
  }
  return out;
}

const createdMs = (p) => {
  const c = p?.createdAt;
  if (!c) return 0;
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (typeof c.toDate === 'function') return c.toDate().getTime();
  const n = new Date(c).getTime();
  return Number.isNaN(n) ? 0 : n;
};

/** Newest first, stable for equal timestamps. */
export const sortNewestFirst = (list) =>
  list.map((p, i) => [p, i]).sort((a, b) => createdMs(b[0]) - createdMs(a[0]) || a[1] - b[1]).map(([p]) => p);

/** The list for the chosen view: 'mine' | 'team' | 'all' (default, newest first). */
export function listForView(view, own, team) {
  if (view === 'mine') return own;
  if (view === 'team') return team;
  return sortNewestFirst([...own, ...team]);
}

/**
 * The four overview figures for the chosen view. `ownActive`/`teamActive` are the
 * active (non-archived) properties; opinions are counted over ALL of each side's
 * properties — the same rule the dashboard already used for the agent's own.
 */
export function computeStats({ view, ownActive, teamActive, ownOpinions = 0, teamAll = [] }) {
  const includeOwn = view !== 'team';
  const includeTeam = view !== 'mine';
  const active = [...(includeOwn ? ownActive : []), ...(includeTeam ? teamActive : [])];
  return {
    properties: active.length,
    live: active.filter((p) => p.visibility === true).length,
    views: active.reduce((sum, p) => sum + (p.stats?.views || 0), 0),
    opinions: (includeOwn ? ownOpinions : 0) + (includeTeam ? teamAll.reduce((sum, p) => sum + (p.opinions || 0), 0) : 0),
  };
}
