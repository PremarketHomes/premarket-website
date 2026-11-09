// Pure helpers for the BSO Dashboard (rows come from GET /api/bso/campaigns). No React, so they are unit-testable.

/** Dashboard figures from the BSO's campaigns, with the same meaning as an agent's own figures. */
export function bsoCampaignStats(campaigns) {
  const active = campaigns.filter((c) => !c.archived);
  return {
    campaigns: active.length,
    live: active.filter((c) => c.visibility).length,
    views: active.reduce((sum, c) => sum + (Number(c.views) || 0), 0),
    opinions: campaigns.reduce((sum, c) => sum + (Number(c.opinions) || 0), 0),
  };
}

/** Which campaigns belong on which dashboard tab (the same split as an agent's Dashboard / Sold / Archive). */
export const BSO_TAB_FILTERS = {
  overview: (c) => !c.archived,
  sold: (c) => c.archived && c.status === 'sold',
  archived: (c) => c.archived && c.status !== 'sold',
};
