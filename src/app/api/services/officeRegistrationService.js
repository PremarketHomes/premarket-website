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
const REGISTRATION_FIELDS = ['buyerName', 'buyerEmail', 'buyerPhone', 'nextAction', 'timeframe', 'buyerType', 'isFirstHomeBuyer', 'isInvestor'];
const MAX_RESULTS = 300;
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const toIso = (t) => (t?.toDate ? t.toDate().toISOString() : t || null);
const displayName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || null;

/** office admin → every current office member; team creator → members of the team they created; else null. */
export async function resolveRegistrationScope(db, actorUid) {
  const actorSnap = await db.collection('users').doc(actorUid).get();
  if (!actorSnap.exists || !actorSnap.data().officeId) return null;
  const actor = actorSnap.data();
  const officeSnap = await db.collection('officeAdminInfo').doc(actor.officeId).get();
  if (!officeSnap.exists || officeSnap.data().status !== 'active') return null;
  if (Array.isArray(officeSnap.data().officeAdminUids) && officeSnap.data().officeAdminUids.includes(actorUid)) {
    return { scope: 'office', officeId: actor.officeId, office: { id: actor.officeId, name: officeSnap.data().name || '' } };
  }
  if (actor.teamId) {
    const team = await db.collection('teams').doc(actor.teamId).get();
    if (team.exists && team.data().officeId === actor.officeId && team.data().createdBy === actorUid) {
      return { scope: 'team', officeId: actor.officeId, teamId: actor.teamId, office: { id: actor.officeId, name: officeSnap.data().name || '' } };
    }
  }
  return null;
}

export async function listRegistrations(db, scope) {
  const q = scope.scope === 'office'
    ? db.collection('users').where('officeId', '==', scope.officeId)
    : db.collection('users').where('teamId', '==', scope.teamId);
  const owners = new Map((await q.get()).docs.filter((d) => d.data().officeId === scope.officeId).map((d) => [d.id, d.data()]));

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
      const reg = { id: d.id, propertyId: o.propertyId, address: p.formattedAddress || p.address || null, agentUid: p.userId, agentName: displayName(owner), createdAt: toIso(o.createdAt) };
      for (const f of REGISTRATION_FIELDS) reg[f] = o[f] ?? null;
      out.push(reg);
    }
  }
  return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, MAX_RESULTS);
}
