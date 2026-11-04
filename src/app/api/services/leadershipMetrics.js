/**
 * Leadership Hub — pure calculations. No I/O and no firebase imports, so the same code serves the
 * live API, the unit tests and the sample-data preview. Metric definitions live in leadershipService.js.
 */

export const LEADERSHIP_TIMEZONE = 'Australia/Sydney';
const MAX_TREND_MONTHS = 12;

/** Display status for a campaign, mirroring the agent dashboard: sold > archived > live > hidden. */
export function propertyStatus(p) {
  if (p.archivedReason === 'sold') return 'sold';
  if (p.archived === true) return 'archived';
  if (p.visibility === true) return 'live';
  return 'hidden';
}

/* ───────────────────────────── time helpers ───────────────────────────── */

export const toDate = (t) => {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate();
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const toIso = (t) => toDate(t)?.toISOString() || null;

function zonedParts(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return {
    y: +parts.year, m: +parts.month, d: +parts.day,
    h: +parts.hour, mi: +parts.minute, s: +parts.second,
    dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday),
  };
}

/** The UTC instant at which local midnight of (y, m, d) happens in `tz`. */
function zonedMidnight(y, m, d, tz) {
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    guess -= asUtc - Date.UTC(y, m - 1, d);
  }
  return new Date(guess);
}

/** Calendar week (Mon–Sun) and calendar month containing `now`, in `tz`. */
export function periodStarts(now = new Date(), tz = LEADERSHIP_TIMEZONE) {
  const p = zonedParts(now, tz);
  const monday = new Date(Date.UTC(p.y, p.m - 1, p.d - p.dow));
  return {
    week: zonedMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), tz),
    month: zonedMidnight(p.y, p.m, 1, tz),
  };
}

export const monthKey = (date, tz = LEADERSHIP_TIMEZONE) => {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}`;
};


/* ─────────────────────────────── aggregation ─────────────────────────────── */

/** A stored count as a whole number; anything else (text, NaN, negative) is 0, so totals can never become NaN or a string. */
export const safeCount = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

export const fullName = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || null;

/** Deterministic ordering: opinions, then registrations, then campaigns (all desc), then name, then uid. */
export function rankAgents(rows) {
  const cmp = (a, b) =>
    b.opinions - a.opinions
    || b.registrations - a.registrations
    || b.campaigns - a.campaigns
    || (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' })
    || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
  const sorted = [...rows].sort(cmp);
  // Competition ranking: agents level on every counted metric share a position.
  let rank = 0;
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    const tied = prev && prev.opinions === r.opinions && prev.registrations === r.registrations && prev.campaigns === r.campaigns;
    if (!tied) rank = i + 1;
    return { ...r, rank };
  });
}

/**
 * Pure: turns raw records into everything the Hub shows. No I/O, so it is
 * exercised directly by the unit tests.
 */
// Leadership accounts are not agents: they never appear in rankings, adoption figures or attention lists,
// even if one were ever (wrongly) linked to the office.
const isLeadershipOnlyMember = (u) => !!u?.roles?.includes?.('leadership') && !(u.agent || u.isAgent || u.roles.includes('agent')) && !(u.isBuyer || u.roles.includes('buyer'));

export function buildLeadershipData({ members: allMembers, pendingInvites = [], properties, opinions, lastSignIns = {}, now = new Date(), tz = LEADERSHIP_TIMEZONE }) {
  const members = allMembers.filter((m) => !isLeadershipOnlyMember(m));
  const memberByUid = new Map(members.map((m) => [m.uid, m]));
  const starts = periodStarts(now, tz);

  // Only campaigns of CURRENT members that the agent hasn't removed.
  const campaigns = properties.filter((p) => memberByUid.has(p.userId) && p.hidden !== true);
  const campaignById = new Map(campaigns.map((p) => [p.id, p]));

  const perProperty = new Map();
  const perAgent = new Map(members.map((m) => [m.uid, {
    uid: m.uid,
    opinions: { all: 0, month: 0, week: 0, last30: 0 },
    registrations: { all: 0, month: 0, week: 0, last30: 0 },
  }]));
  const monthly = new Map();
  const bump = (key, field) => {
    const row = monthly.get(key) || { month: key, opinions: 0, registrations: 0, campaigns: 0 };
    row[field] += 1;
    monthly.set(key, row);
  };

  const last30Start = new Date(now.getTime() - 30 * 86400000);
  const seenOpinions = new Set();
  for (const o of opinions) {
    if (o.id) { if (seenOpinions.has(o.id)) continue; seenOpinions.add(o.id); } // one opinion = one document
    const prop = campaignById.get(o.propertyId);
    if (!prop) continue; // not a campaign of a current member
    const when = toDate(o.createdAt) || toDate(o.createdAtIso);
    const reg = o.serious === true;

    const pp = perProperty.get(prop.id) || { opinions: 0, registrations: 0 };
    pp.opinions += 1;
    if (reg) pp.registrations += 1;
    perProperty.set(prop.id, pp);

    const a = perAgent.get(prop.userId); // original listing agent
    const add = (bucket) => { a.opinions[bucket] += 1; if (reg) a.registrations[bucket] += 1; };
    add('all');
    if (when) {
      if (when >= starts.month) add('month');
      if (when >= starts.week) add('week');
      if (when >= last30Start) add('last30');
      bump(monthKey(when, tz), 'opinions');
      if (reg) bump(monthKey(when, tz), 'registrations');
    }
  }

  const propertyRows = campaigns.map((p) => {
    const counts = perProperty.get(p.id) || { opinions: 0, registrations: 0 };
    const owner = memberByUid.get(p.userId);
    return {
      id: p.id,
      address: p.formattedAddress || p.address || null,
      thumbnail: Array.isArray(p.imageUrls) && p.imageUrls.length ? p.imageUrls[0] : null,
      agentUid: p.userId,
      agentName: fullName(owner) || owner.email || 'Agent',
      status: propertyStatus(p),
      listingStatus: p.listingStatus === 'on-market' ? 'on-market' : 'pre-market',
      price: p.price ?? null,
      soldPrice: p.soldPrice ?? null,
      opinions: counts.opinions,
      registrations: counts.registrations,
      views: safeCount(p.stats?.views),
      createdAt: toIso(p.createdAt),
    };
  });
  propertyRows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || (a.id < b.id ? -1 : 1));

  for (const p of campaigns) {
    const when = toDate(p.createdAt);
    if (when) bump(monthKey(when, tz), 'campaigns');
  }

  const agentRows = members.map((m) => {
    const mine = propertyRows.filter((p) => p.agentUid === m.uid);
    const agg = perAgent.get(m.uid);
    const latest = mine.reduce((acc, p) => (p.createdAt && (!acc || p.createdAt > acc) ? p.createdAt : acc), null);
    const activated = m.accountStatus !== 'invited';
    return {
      uid: m.uid,
      name: fullName(m) || m.email || 'Agent',
      avatar: m.avatar || null,
      activated,
      activatedAt: toIso(m.activatedAt),
      invitedAt: toIso(m.invitedAt),
      campaigns: mine.length,
      activeCampaigns: mine.filter((p) => p.status === 'live' || p.status === 'hidden').length,
      opinions: agg.opinions.all,
      registrations: agg.registrations.all,
      views: mine.reduce((n, p) => n + p.views, 0),
      latestCampaignAt: latest,
      lastSignInAt: lastSignIns[m.uid] ?? null, // null = unknown, not "never"
      last30Opinions: agg.opinions.last30,
    };
  });

  const leaderboard = {};
  for (const period of ['all', 'month', 'week']) {
    leaderboard[period] = rankAgents(agentRows
      .filter((a) => a.activated)
      .map((a) => ({
        uid: a.uid,
        name: a.name,
        avatar: a.avatar,
        campaigns: a.campaigns,
        opinions: perAgent.get(a.uid).opinions[period],
        registrations: perAgent.get(a.uid).registrations[period],
      })));
  }

  const trends = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-MAX_TREND_MONTHS);

  // Adoption over time: activations that really happened (activatedAt is only
  // recorded for invited accounts, so this is "known activations", labelled so).
  const adoptionByMonth = new Map();
  for (const a of agentRows) {
    const when = toDate(a.activatedAt);
    if (when) adoptionByMonth.set(monthKey(when, tz), (adoptionByMonth.get(monthKey(when, tz)) || 0) + 1);
  }
  let running = 0;
  const adoption = [...adoptionByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, n]) => ({ month, activations: n, cumulative: (running += n) }));

  const engaged = agentRows
    .filter((a) => a.activated && a.last30Opinions > 0)
    .sort((a, b) => b.last30Opinions - a.last30Opinions || (a.uid < b.uid ? -1 : 1))
    .slice(0, 3)
    .map((a) => a.uid);

  const attention = {
    notActivated: [
      ...agentRows.filter((a) => !a.activated).map((a) => a.uid),
      ...pendingInvites.map((i) => i.targetUid).filter(Boolean),
    ],
    activatedNoCampaign: agentRows.filter((a) => a.activated && a.campaigns === 0).map((a) => a.uid),
    strongEngagement: engaged,
  };

  const totalOpinions = agentRows.reduce((n, a) => n + a.opinions, 0);
  const totalRegistrations = agentRows.reduce((n, a) => n + a.registrations, 0);
  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    periods: { week: starts.week.toISOString(), month: starts.month.toISOString() },
    overview: {
      agentsTotal: agentRows.length + pendingInvites.length,
      agentsActivated: agentRows.filter((a) => a.activated).length,
      agentsNotActivated: attention.notActivated.length,
      agentsWithCampaigns: agentRows.filter((a) => a.campaigns > 0).length,
      campaigns: propertyRows.length,
      activeCampaigns: propertyRows.filter((p) => p.status === 'live' || p.status === 'hidden').length,
      opinions: totalOpinions,
      registrations: totalRegistrations,
      views: propertyRows.reduce((n, p) => n + p.views, 0),
    },
    leaderboard,
    agents: agentRows,
    pendingInvites: pendingInvites.map((i) => ({ uid: i.targetUid || null, name: i.targetName || null, invitedAt: toIso(i.createdAt) })),
    attention,
    properties: propertyRows,
    trends,
    adoption,
  };
}


/* ─────────────────────────── individual agent profile ─────────────────────────── */

const DAY = 86400000;

/** Thresholds behind the coaching observations. Shown in the UI so every observation can be checked by hand. */
export const COACHING_THRESHOLDS = {
  viewsMin: 20,        // "receiving views" = at least this many views
  limitedMax: 2,       // "limited opinions" = this many or fewer (but not zero)
  strongOpinions: 5,   // "strong feedback" = at least this many opinions...
  strongRegistrations: 2, // ...or at least this many registrations
  staleDays: 45,       // "no new campaign" = nothing uploaded for this many days
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const dateLabel = (iso, tz) => new Intl.DateTimeFormat('en-AU', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/**
 * Pure: one agent's profile, built on top of buildLeadershipData so every figure agrees with the Hub.
 * Returns null when `uid` is not a current member. Observations are factual statements about records
 * with a neutral discussion prompt — there are no scores, grades or "poor performer" labels.
 */
export function buildAgentProfile(inputs, uid) {
  const { opinions, now = new Date(), tz = LEADERSHIP_TIMEZONE } = inputs;
  const hub = buildLeadershipData(inputs);
  const agent = hub.agents.find((a) => a.uid === uid);
  if (!agent) return null;

  const T = COACHING_THRESHOLDS;
  const mine = hub.properties.filter((p) => p.agentUid === uid);
  const mineIds = new Set(mine.map((p) => p.id));
  const seen = new Set();
  const myOpinions = opinions.filter((o) => {
    if (!mineIds.has(o.propertyId)) return false;
    if (o.id) { if (seen.has(o.id)) return false; seen.add(o.id); }
    return true;
  }).map((o) => ({ propertyId: o.propertyId, when: toDate(o.createdAt) || toDate(o.createdAtIso), reg: o.serious === true }));

  const nowMs = now.getTime();
  const within = (when, fromMs, toMs) => !!when && when.getTime() >= fromMs && when.getTime() < toMs;
  const last30 = myOpinions.filter((o) => within(o.when, nowMs - 30 * DAY, nowMs + 1)).length;
  const prior30 = myOpinions.filter((o) => within(o.when, nowMs - 60 * DAY, nowMs - 30 * DAY)).length;

  // Per-property performance, including the recency of feedback.
  const byProperty = new Map();
  for (const o of myOpinions) {
    const row = byProperty.get(o.propertyId) || { last: null, recent: 0 };
    if (o.when && (!row.last || o.when > row.last)) row.last = o.when;
    if (within(o.when, nowMs - 30 * DAY, nowMs + 1)) row.recent += 1;
    byProperty.set(o.propertyId, row);
  }
  const properties = mine.map((p) => {
    const extra = byProperty.get(p.id) || { last: null, recent: 0 };
    return {
      ...p,
      lastOpinionAt: extra.last ? extra.last.toISOString() : null,
      opinionsLast30: extra.recent,
      daysLive: p.createdAt ? Math.max(0, Math.floor((nowMs - new Date(p.createdAt).getTime()) / DAY)) : null,
    };
  });
  const isActive = (p) => p.status === 'live' || p.status === 'hidden';
  const active = properties.filter(isActive);

  // Rankings and period totals (same ranking as the leaderboard).
  const ranks = {};
  const periodTotals = {};
  for (const period of ['week', 'month', 'all']) {
    const rows = hub.leaderboard[period];
    const row = rows.find((r) => r.uid === uid);
    ranks[period] = row ? { rank: row.rank, of: rows.length } : null;
    periodTotals[period] = row ? { opinions: row.opinions, registrations: row.registrations } : { opinions: 0, registrations: 0 };
  }

  // Monthly trend for this agent, and the last 12 calendar weeks of opinions.
  const monthly = new Map();
  const bump = (key, field) => { const r = monthly.get(key) || { month: key, opinions: 0, registrations: 0, campaigns: 0 }; r[field] += 1; monthly.set(key, r); };
  for (const o of myOpinions) if (o.when) { bump(monthKey(o.when, tz), 'opinions'); if (o.reg) bump(monthKey(o.when, tz), 'registrations'); }
  for (const p of mine) if (p.createdAt) bump(monthKey(new Date(p.createdAt), tz), 'campaigns');
  const trends = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-MAX_TREND_MONTHS);

  const weekly = [];
  let weekEnd = nowMs + 1;
  for (let k = 0; k < 12; k++) {
    const start = periodStarts(new Date(nowMs - k * 7 * DAY), tz).week;
    weekly.unshift({
      weekStart: start.toISOString(),
      opinions: myOpinions.filter((o) => within(o.when, start.getTime(), weekEnd)).length,
    });
    weekEnd = start.getTime();
  }

  // Coaching observations: attention items first, then positives.
  const coaching = [];
  const ids = (rows) => rows.map((p) => p.id);

  if (!agent.activated) {
    coaching.push({ id: 'not-activated', tone: 'attention', title: 'Account not yet activated',
      detail: agent.invitedAt ? `Invited on ${dateLabel(agent.invitedAt, tz)}; activation hasn't been completed.` : "Activation hasn't been completed.",
      discuss: 'Is anything stopping them from signing in — the invitation email, or not knowing where to start?', propertyIds: [] });
  } else if (agent.campaigns === 0) {
    coaching.push({ id: 'no-campaigns', tone: 'attention', title: "Activated, but hasn't uploaded a campaign",
      detail: agent.activatedAt ? `Activated on ${dateLabel(agent.activatedAt, tz)}; no campaigns have been added yet.` : 'No campaigns have been added yet.',
      discuss: 'Which upcoming listing would be the easiest first campaign to set up together?', propertyIds: [] });
  } else if (agent.latestCampaignAt && nowMs - new Date(agent.latestCampaignAt).getTime() > T.staleDays * DAY) {
    const days = Math.floor((nowMs - new Date(agent.latestCampaignAt).getTime()) / DAY);
    coaching.push({ id: 'no-recent-campaign', tone: 'attention', title: `No new campaign in ${days} days`,
      detail: `The most recent campaign was created on ${dateLabel(agent.latestCampaignAt, tz)}.`,
      discuss: 'What listings are coming up that could be launched on Premarket before they go to market?', propertyIds: [] });
  }

  const noOpinions = active.filter((p) => p.opinions === 0);
  if (noOpinions.length) {
    const views = noOpinions.reduce((n, p) => n + p.views, 0);
    coaching.push({ id: 'no-opinions', tone: 'attention', title: `${plural(noOpinions.length, 'active campaign has', 'active campaigns have')} no buyer opinions`,
      detail: `Together they have ${views.toLocaleString('en-AU')} view${views === 1 ? '' : 's'} and no opinions yet.`,
      discuss: 'Has the campaign link been sent to buyers and past enquiries? Is an opinion being asked for each time it is shared?', propertyIds: ids(noOpinions) });
  }

  const limited = active.filter((p) => p.views >= T.viewsMin && p.opinions >= 1 && p.opinions <= T.limitedMax);
  if (limited.length) {
    coaching.push({ id: 'views-limited-opinions', tone: 'attention', title: `${plural(limited.length, 'campaign has', 'campaigns have')} views but few opinions`,
      detail: `Each has ${T.viewsMin}+ views and ${T.limitedMax} or fewer opinions.`,
      discuss: 'What happens after a buyer opens the page? Is the request for a price opinion clear, and is the price guidance easy to react to?', propertyIds: ids(limited) });
  }

  if (last30 + prior30 > 0) {
    const lastAt = myOpinions.reduce((a, o) => (o.when && (!a || o.when > a) ? o.when : a), null);
    if (last30 === 0) {
      coaching.push({ id: 'trend-quiet', tone: 'attention', title: 'No buyer opinions in the last 30 days',
        detail: `${prior30} in the 30 days before that${lastAt ? `; the most recent opinion was on ${dateLabel(lastAt.toISOString(), tz)}` : ''}.`,
        discuss: 'What has changed since the last opinion came in — fewer campaigns being shared, or campaigns that have gone quiet?', propertyIds: [] });
    } else if (last30 < prior30) {
      coaching.push({ id: 'trend-down', tone: 'attention', title: 'Fewer buyer opinions than the previous 30 days',
        detail: `${last30} in the last 30 days, compared with ${prior30} in the 30 days before.`,
        discuss: 'Is this a change in how campaigns are being promoted, or in which listings are active?', propertyIds: [] });
    } else if (last30 > prior30) {
      coaching.push({ id: 'trend-up', tone: 'positive', title: 'More buyer opinions than the previous 30 days',
        detail: `${last30} in the last 30 days, compared with ${prior30} in the 30 days before.`,
        discuss: 'What changed in the last month that is worth repeating?', propertyIds: [] });
    } else {
      coaching.push({ id: 'trend-steady', tone: 'positive', title: 'Buyer opinions steady against the previous 30 days',
        detail: `${last30} in each of the last two 30-day periods.`,
        discuss: 'What would lift this — more campaigns, or more promotion of the existing ones?', propertyIds: [] });
    }
  }

  const strong = properties.filter((p) => p.opinions >= T.strongOpinions || p.registrations >= T.strongRegistrations)
    .sort((a, b) => b.opinions - a.opinions || b.registrations - a.registrations || (a.id < b.id ? -1 : 1)).slice(0, 5);
  if (strong.length) {
    coaching.push({ id: 'strong-feedback', tone: 'positive', title: `${plural(strong.length, 'campaign is', 'campaigns are')} generating strong buyer feedback`,
      detail: `${T.strongOpinions}+ opinions or ${T.strongRegistrations}+ registrations each.`,
      discuss: 'What was done differently on these — how they were shared, when, and at what price guidance — that can be repeated on other campaigns?', propertyIds: ids(strong) });
  }

  const best = [...properties].sort((a, b) => b.opinions - a.opinions || b.registrations - a.registrations || (a.id < b.id ? -1 : 1))[0];
  return {
    generatedAt: hub.generatedAt,
    timezone: tz,
    periods: hub.periods,
    agent,
    summary: {
      campaigns: agent.campaigns,
      activeCampaigns: agent.activeCampaigns,
      opinions: agent.opinions,
      registrations: agent.registrations,
      views: agent.views,
      campaignsWithFeedback: properties.filter((p) => p.opinions > 0).length,
      activeWithoutFeedback: noOpinions.length,
      best: best && best.opinions > 0 ? { id: best.id, address: best.address, opinions: best.opinions } : null,
      opinionsLast30: last30,
      opinionsPrior30: prior30,
    },
    ranks,
    periodTotals,
    trends,
    weekly,
    properties,
    coaching,
    thresholds: T,
  };
}
