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
import { redactOffersForTeam, redactLikesForTeam } from './teamRedaction';
import { serializeForClient } from './propertyAccessService';
import { loadTestCampaignIds } from './testCampaigns';
import {
  LEADERSHIP_TIMEZONE, propertyStatus, buildLeadershipData, buildAgentProfile, rankAgents, fullName, safeCount,
} from './leadershipMetrics';

export { LEADERSHIP_TIMEZONE, buildLeadershipData, buildAgentProfile, rankAgents };

const IN_LIMIT = 30;
const AUTH_LIMIT = 100;

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


async function loadInputs(db, scope) {
  const { members, pending } = await loadMembers(db, scope.officeId);
  // Test campaigns (server-only billing record, see testCampaigns.js) are left out of every leadership figure.
  const testIds = await loadTestCampaignIds(db);
  const properties = (members.length ? await loadProperties(db, members.map((m) => m.uid)) : []).filter((p) => !testIds.has(p.id));
  const visible = properties.filter((p) => p.hidden !== true);
  const opinions = visible.length ? await loadOpinions(db, visible.map((p) => p.id)) : [];
  const lastSignIns = await loadLastSignIns(members.map((m) => m.uid));
  return { members, pendingInvites: pending, properties, opinions, lastSignIns };
}

/** Everything the Hub needs, for the office `scope` points at. Read-only. */
export async function getLeadershipHub(db, scope, { now = new Date() } = {}) {
  const inputs = await loadInputs(db, scope);
  return {
    office: { name: scope.officeName },
    leader: scope.leader,
    ...buildLeadershipData({ ...inputs, now }),
  };
}

/**
 * One agent's coaching profile. The agent must currently be a member of the leader's own office;
 * anyone else (another office, a pending invitee, an unknown id) is the same 404 so ids can't be probed.
 * Built from the same inputs and code as the Hub, so every number matches it.
 */
export async function getLeadershipAgentProfile(db, scope, agentUid, { now = new Date() } = {}) {
  const inputs = await loadInputs(db, scope);
  const profile = buildAgentProfile({ ...inputs, now }, agentUid);
  if (!profile) throw new LeadershipError('Agent not found', 404);
  return { office: { name: scope.officeName }, leader: scope.leader, ...profile };
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
      views: safeCount(property.stats?.views),
      uniqueViews: safeCount(property.stats?.uniqueViews),
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
