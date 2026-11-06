/**
 * Buyer REGISTRATIONS visible to office admins (whole office). The former team-creator ("Team Admin") scope has been
 * retired: no team role grants registration access, and there is no team-wide or BSO-wide registrations list (a BSO sees
 * registrations only inside the report of a campaign they manage, see propertyAccessService).
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
// Registrations are shown by DAY only. An exact time could be matched against the timestamps on anonymous price
// opinions (in reports) to link a registrant to an opinion, so it is deliberately not exposed in these lists.
const toDay = (t) => { const iso = toIso(t); const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null; };
const displayName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || null;

/** Office admin of an active office → every current office member; anyone else → null. Leadership grants nothing here. */
export async function resolveRegistrationScope(db, actorUid) {
  const actorSnap = await db.collection('users').doc(actorUid).get();
  if (!actorSnap.exists || !actorSnap.data().officeId) return null;
  const actor = actorSnap.data();
  const officeSnap = await db.collection('officeAdminInfo').doc(actor.officeId).get();
  if (!officeSnap.exists || officeSnap.data().status !== 'active') return null;
  if (Array.isArray(officeSnap.data().officeAdminUids) && officeSnap.data().officeAdminUids.includes(actorUid)) {
    return { scope: 'office', actorUid, officeId: actor.officeId, office: { id: actor.officeId, name: officeSnap.data().name || '' } };
  }
  return null;
}

export async function listRegistrations(db, scope) {
  if (scope?.scope !== 'office') throw new Error('registrations scope must be office');
  const candidates = (await db.collection('users').where('officeId', '==', scope.officeId).get()).docs;
  const owners = new Map(candidates.map((d) => [d.id, d.data()]));

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
