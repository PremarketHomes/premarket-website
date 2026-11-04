/**
 * Leadership Hub — a READ-ONLY, office-wide view for an agency's leaders.
 *
 * Authorisation is its own list, `officeAdminInfo/{officeId}.leadershipUids`
 * (server-only, like every other office document). It is deliberately NOT
 * `officeAdminUids`: leadership grants no roster, invitation, billing or
 * account management, and none of the existing office-admin report access
 * (which exposes buyer identities). Office scope is derived from the
 * authenticated uid — no office id is ever accepted from the client.
 *
 * Metric definitions (also shown in the UI):
 *   campaign          a listing owned by a current member of the office, not
 *                     removed (`hidden`) by its agent. Same rule the agent
 *                     dashboard uses.
 *   active campaign   a campaign that is not archived or sold.
 *   opinion           one `offers` document with type === 'opinion' (the same
 *                     definition as the agent dashboard's opinion count).
 *                     Counted once per document id.
 *   registered        the subset of opinions with serious === true. It is NOT
 *                     added to the opinion total — every registration is also
 *                     an opinion, so nothing is double counted.
 *   attribution       to the listing agent (`properties.userId`) — never to a
 *                     teammate, and never to the buyer's linked account.
 *   time filters      apply to the opinion's own submission date.
 */

import { getAuth } from 'firebase-admin/auth';
import { propertyStatus } from './officeTeamService';
import { redactOffersForTeam, redactLikesForTeam } from './teamRedaction';
import { serializeForClient } from './propertyAccessService';

export const LEADERSHIP_TIMEZONE = 'Australia/Sydney';
const IN_LIMIT = 30;
const AUTH_LIMIT = 100;
const MAX_TREND_MONTHS = 12;

export class LeadershipError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/* ───────────────────────── scope / authorisation ───────────────────────── */

/**
 * The office this uid leads, or throws. Re-read live on every request, so
 * removing a uid from `leadershipUids` (or disabling the office) ends access
 * immediately. An account that belongs to a DIFFERENT office is refused.
 */
export async function requireLeadership(db, uid) {
  if (!uid) throw new LeadershipError('Unauthorized', 401);

  const snap = await db.collection('officeAdminInfo').where('leadershipUids', 'array-contains', uid).get();
  const offices = snap.docs.filter((d) => d.data()?.status === 'active');
  if (offices.length === 0) throw new LeadershipError('Forbidden', 403);
  if (offices.length > 1) throw new LeadershipError('Leadership scope is ambiguous', 403);

  const officeDoc = offices[0];
  const userDoc = await db.collection('users').doc(uid).get();
  const user = userDoc.exists ? userDoc.data() : null;
  if (!user) throw new LeadershipError('Forbidden', 403);
  if (user.officeId && user.officeId !== officeDoc.id) throw new LeadershipError('Forbidden', 403);

  return {
    officeId: officeDoc.id,
    officeName: officeDoc.data().name || '',
    leader: {
      uid,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      avatar: user.avatar || null,
    },
  };
}

/* ───────────────────────────── time helpers ───────────────────────────── */

const toDate = (t) => {
  if (!t) return null;
  if (typeof t.toDate === 'function') return t.toDate();
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};
const toIso = (t) => toDate(t)?.toISOString() || null;

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

const monthKey = (date, tz = LEADERSHIP_TIMEZONE) => {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}`;
};

/* ─────────────────────────────── loaders ─────────────────────────────── */

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

async function loadMembers(db, officeId) {
  const [membersSnap, invitesSnap] = await Promise.all([
    db.collection('users').where('officeId', '==', officeId).get(),
    db.collection('officeInvites').where('officeId', '==', officeId).where('status', '==', 'pending').get(),
  ]);
  const members = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const pending = invitesSnap.docs.map((d) => d.data());
  return { members, pending };
}

async function loadProperties(db, uids) {
  const rows = [];
  await Promise.all(chunk(uids, IN_LIMIT).map(async (batch) => {
    const snap = await db.collection('properties').where('userId', 'in', batch).get();
    snap.docs.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  }));
  return rows;
}

async function loadOpinions(db, propertyIds) {
  const byId = new Map(); // dedupe by document id
  await Promise.all(chunk(propertyIds, IN_LIMIT).map(async (batch) => {
    const snap = await db.collection('offers').where('propertyId', 'in', batch).get();
    snap.docs.forEach((d) => {
      const o = d.data();
      if (o.type === 'opinion') byId.set(d.id, { id: d.id, ...o });
    });
  }));
  return [...byId.values()];
}

/** Firebase Auth last sign-in per uid. Best effort: a failure means "unknown", never "inactive". */
async function loadLastSignIns(uids) {
  const out = {};
  try {
    for (const batch of chunk(uids, AUTH_LIMIT)) {
      const res = await getAuth().getUsers(batch.map((uid) => ({ uid })));
      res.users.forEach((u) => { out[u.uid] = u.metadata?.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null; });
    }
  } catch (err) {
    console.error('Leadership: could not read last sign-in times:', err?.message);
  }
  return out;
}

/* ─────────────────────────────── aggregation ─────────────────────────────── */

const fullName = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || null;

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
export function buildLeadershipData({ members, pendingInvites = [], properties, opinions, lastSignIns = {}, now = new Date(), tz = LEADERSHIP_TIMEZONE }) {
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
  for (const o of opinions) {
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
      views: p.stats?.views || 0,
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

/** Everything the Hub needs, for the office `scope` points at. Read-only. */
export async function getLeadershipHub(db, scope, { now = new Date() } = {}) {
  const { members, pending } = await loadMembers(db, scope.officeId);
  const properties = members.length ? await loadProperties(db, members.map((m) => m.uid)) : [];
  const visible = properties.filter((p) => p.hidden !== true);
  const opinions = visible.length ? await loadOpinions(db, visible.map((p) => p.id)) : [];
  const lastSignIns = await loadLastSignIns(members.map((m) => m.uid));
  return {
    office: { name: scope.officeName },
    leader: scope.leader,
    ...buildLeadershipData({ members, pendingInvites: pending, properties, opinions, lastSignIns, now }),
  };
}

/* ─────────────────────── redacted, read-only property report ─────────────────────── */

const REPORT_PROPERTY_FIELDS = [
  'formattedAddress', 'address', 'price', 'soldPrice', 'bedrooms', 'bathrooms', 'carSpaces',
  'propertyType', 'listingStatus', 'description', 'createdAt', 'imageUrls',
];

/**
 * Report for ONE campaign, only if its listing agent currently belongs to the
 * leader's office. Allowlisted property fields; opinions rebuilt without any
 * buyer identity (see teamRedaction.js); no buyer profiles at all.
 */
export async function getLeadershipPropertyReport(db, scope, propertyId) {
  const propSnap = await db.collection('properties').doc(propertyId).get();
  if (!propSnap.exists) throw new LeadershipError('Property not found', 404);
  const property = propSnap.data();

  const ownerSnap = await db.collection('users').doc(property.userId || '_').get();
  const owner = ownerSnap.exists ? ownerSnap.data() : null;
  // Same status code for "missing" and "someone else's" so ids can't be probed.
  if (!owner || owner.officeId !== scope.officeId || property.hidden === true) throw new LeadershipError('Property not found', 404);

  const [offersSnap, likesSnap] = await Promise.all([
    db.collection('offers').where('propertyId', '==', propertyId).get(),
    db.collection('likes').where('propertyId', '==', propertyId).get(),
  ]);
  const opinionDocs = offersSnap.docs.map((d) => d.data()).filter((o) => o.type === 'opinion');

  const pick = {};
  for (const f of REPORT_PROPERTY_FIELDS) if (property[f] !== undefined) pick[f] = property[f];

  return {
    readOnly: true,
    redacted: true,
    property: serializeForClient({
      id: propertyId,
      ...pick,
      status: propertyStatus(property),
      views: property.stats?.views || 0,
      uniqueViews: property.stats?.uniqueViews || 0,
    }),
    listingAgent: { name: fullName(owner) || 'Agent', avatar: owner.avatar || null },
    totals: {
      opinions: opinionDocs.length,
      registrations: opinionDocs.filter((o) => o.serious === true).length,
      likes: likesSnap.size,
    },
    opinions: redactOffersForTeam(opinionDocs, serializeForClient),
    likes: redactLikesForTeam(likesSnap.docs.map((d) => d.data()), serializeForClient),
  };
}
