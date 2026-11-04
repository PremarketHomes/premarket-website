// Sample data for the preview-only route. Entirely invented: fictional people, addresses and numbers.
// It never reads Firestore and is never served in production (see preview/page.js).
const iso = (d) => new Date(Date.UTC(2026, 10, 4) - d * 86400000).toISOString();

const AGENTS = [
  ['a1', 'Sample Agent One', 14, 9, 52, 11, 410, 2, 1],
  ['a2', 'Sample Agent Two', 11, 8, 47, 9, 365, 1, 2],
  ['a3', 'Sample Agent Three', 9, 6, 47, 6, 300, 4, 0],
  ['a4', 'Sample Agent Four', 7, 5, 31, 5, 220, 6, 3],
  ['a5', 'Sample Agent Five', 6, 4, 18, 2, 150, 9, 1],
  ['a6', 'Sample Agent Six', 3, 2, 8, 1, 90, 20, 5],
  ['a7', 'Sample Agent Seven', 0, 0, 0, 0, 0, null, 4],
  ['a8', 'Sample Agent Eight', 0, 0, 0, 0, 0, null, null],
];

const agents = AGENTS.map(([uid, name, campaigns, activeCampaigns, opinions, registrations, views, campaignDaysAgo, signInDaysAgo]) => ({
  uid, name, avatar: null, activated: uid !== 'a8', activatedAt: iso(60), invitedAt: iso(70),
  campaigns, activeCampaigns, opinions, registrations, views, last30Opinions: Math.round(opinions * 0.4),
  latestCampaignAt: campaignDaysAgo == null ? null : iso(campaignDaysAgo),
  lastSignInAt: signInDaysAgo == null ? null : iso(signInDaysAgo),
}));

const board = (scale) => {
  const rows = agents.filter((a) => a.activated).map((a) => ({
    uid: a.uid, name: a.name, avatar: null, campaigns: a.campaigns,
    opinions: Math.round(a.opinions * scale), registrations: Math.round(a.registrations * scale),
  }));
  rows.sort((x, y) => y.opinions - x.opinions || y.registrations - x.registrations || y.campaigns - x.campaigns || x.name.localeCompare(y.name));
  let rank = 0;
  return rows.map((r, i) => {
    const p = rows[i - 1];
    if (!p || p.opinions !== r.opinions || p.registrations !== r.registrations || p.campaigns !== r.campaigns) rank = i + 1;
    return { ...r, rank };
  });
};

const STATUSES = ['live', 'live', 'live', 'hidden', 'sold', 'archived'];
const properties = Array.from({ length: 24 }, (_, i) => {
  const a = agents[i % 6];
  return {
    id: `demo-${i + 1}`, address: `${10 + i} Example Street, Sampletown NSW`, thumbnail: null,
    agentUid: a.uid, agentName: a.name, status: STATUSES[i % STATUSES.length],
    listingStatus: i % 3 ? 'pre-market' : 'on-market', price: 650000 + i * 35000, soldPrice: null,
    opinions: (i * 7) % 13, registrations: (i * 3) % 4, views: 20 + ((i * 29) % 140), createdAt: iso(i * 9 + 1),
  };
});

const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const trends = months.map((month, i) => ({ month, opinions: 12 + i * 9 + (i % 2) * 6, registrations: 2 + i * 2, campaigns: 3 + i * 2 }));

export const SAMPLE_HUB = (firstName) => ({
  sample: true,
  generatedAt: iso(0),
  timezone: 'Australia/Sydney',
  periods: { week: iso(2), month: iso(3) },
  office: { name: 'Sample Agency' },
  leader: { firstName, lastName: '', avatar: null },
  overview: {
    agentsTotal: 9, agentsActivated: 7, agentsNotActivated: 2, agentsWithCampaigns: 6,
    campaigns: 50, activeCampaigns: 32, opinions: 203, registrations: 34, views: 1535,
  },
  leaderboard: { all: board(1), month: board(0.35), week: board(0.12) },
  agents,
  pendingInvites: [{ uid: 'inv', name: 'Sample Invitee', invitedAt: iso(5) }],
  attention: { notActivated: ['a8', 'inv'], activatedNoCampaign: ['a7'], strongEngagement: ['a1', 'a2', 'a3'] },
  properties,
  trends,
  adoption: [
    { month: '2026-07', activations: 2, cumulative: 2 },
    { month: '2026-08', activations: 3, cumulative: 5 },
    { month: '2026-09', activations: 1, cumulative: 6 },
    { month: '2026-10', activations: 1, cumulative: 7 },
  ],
});
