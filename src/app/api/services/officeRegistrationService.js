/**
 * Buyer REGISTRATIONS visible to office admins (whole office) and team creators (own team only).
 *
 * Disclosure: only what the buyer submitted on the registration form, consistent with its consent copy:
 * contact details and what they told us. Price opinions stay anonymous: the registration and the opinion
 * can live on the same stored offer document, so this is an explicit ALLOWLIST. The opinion amount, seriousness
 * score, session id and linked account id are never copied out, and nothing is inferred from them.
 * (This does not change how offers are stored; the underlying data linkage is tracked separately.)
 * Leadership accounts and ordinary agents/team members never reach this.
 */
import { resolveManagementRole } from './managedCampaignService';

const REGISTRATION_FIELDS = ['buyerName', 'buyerEmail', 'buyerPhone', 'nextAction', 'timeframe', 'buyerType', 'isFirstHomeBuyer', 'isInvestor'];
const MAX_RESULTS = 300;
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const toIso = (t) => (t?.toDate ? t.toDate().toISOString() : t || null);
// Registrations are shown by DAY only. An exact time could be matched against the timestamps on anonymous price
// opinions (in reports) to link a registrant to an opinion, so it is deliberately not exposed in these lists.
const toDay = (t) => { const iso = toIso(t); const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null; };
const displayName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || null;

/**
 * office admin → every current office member; team creator → members of the team they created; else null.
 * Buyer contact details are visible ONLY for campaigns the actor is currently authorised to manage: the team scope
 * is re-checked per agent with the very same live function that authorises managing a campaign
 * (resolveManagementRole), so registration visibility and campaign management can never drift apart.
 * Leadership Hub membership grants nothing here.
 */
export async function resolveRegistrationScope(db, actorUid, { teamEnabled = false } = {}) {
  const actorSnap = await db.collection('users').doc(actorUid).get();
  if (!actorSnap.exists || !actorSnap.data().officeId) return null;
  const actor = actorSnap.data();
  const officeSnap = await db.collection('officeAdminInfo').doc(actor.officeId).get();
  if (!officeSnap.exists || officeSnap.data().status !== 'active') return null;
  if (Array.isArray(officeSnap.data().officeAdminUids) && officeSnap.data().officeAdminUids.includes(actorUid)) {
    return { scope: 'office', actorUid, officeId: actor.officeId, office: { id: actor.officeId, name: officeSnap.data().name || '' } };
  }
  // Team creators: identifiable buyer registrations stay OFF until the opinion/registration separation (Phase D)
  // is resolved and TEAM_REGISTRATIONS_ENABLED=1 is deliberately set. Office admins keep their existing access.
  if (teamEnabled && actor.teamId) {
    const team = await db.collection('teams').doc(actor.teamId).get();
    if (team.exists && team.data().officeId === actor.officeId && team.data().createdBy === actorUid) {
      return { scope: 'team', actorUid, officeId: actor.officeId, teamId: actor.teamId, office: { id: actor.officeId, name: officeSnap.data().name || '' } };
    }
  }
  return null;
}

export async function listRegistrations(db, scope) {
  const q = scope.scope === 'office'
    ? db.collection('users').where('officeId', '==', scope.officeId)
    : db.collection('users').where('teamId', '==', scope.teamId);
  const candidates = (await q.get()).docs.filter((d) => d.data().officeId === scope.officeId);
  let allowed = candidates;
  if (scope.scope === 'team') {
    // Re-verify each agent against live management authority (their own campaigns are always the actor's to see).
    const checks = await Promise.all(candidates.map(async (d) => d.id === scope.actorUid
      || (await resolveManagementRole(db, { actorUid: scope.actorUid, owner: { uid: d.id, ...d.data() } })) === 'teamAdmin'));
    allowed = candidates.filter((_, i) => checks[i]);
  }
  const owners = new Map(allowed.map((d) => [d.id, d.data()]));

  const props = new Map();
  for (const ids of chunk([...owners.keys()], 10)) {
    const snap = await db.collection('properties').where('userId', 'in', ids).get();
    for (const d of snap.docs) if (d.data().hidden !== true) props.set(d.id, d.data());
  }
  const out = [];
  for (const ids of chunk([...props.keys()], 10)) {
    const snap = await db.collection('offers').where('propertyId', 'in', ids).get();
    for (const d of snap.docs) {
      const o = d.data();
      if (o.serious !== true) continue; // formal registrations only
      const p = props.get(o.propertyId);
      const owner = owners.get(p.userId);
      const reg = { id: d.id, propertyId: o.propertyId, address: p.formattedAddress || p.address || null, agentUid: p.userId, agentName: displayName(owner), createdAt: toDay(o.createdAt) };
      for (const f of REGISTRATION_FIELDS) reg[f] = o[f] ?? null;
      out.push(reg);
    }
  }
  return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, MAX_RESULTS);
}
