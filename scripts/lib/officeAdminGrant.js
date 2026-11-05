/**
 * Plan / apply logic for making ONE existing office member an office administrator (and for reverting it). No Firebase import: the
 * Firestore handle and FieldValue are passed in, so this is unit-tested against an in-memory fake.
 *
 * What a grant does (exactly two writes, in one transaction, plus an audit record):
 *   1. officeAdminInfo/{officeId}.officeAdminUids  += uid        (existing admins are kept)
 *   2. users/{uid}.isOfficeAdmin = true
 * What it never does: create or modify a Firebase Auth user, set or reset a password, send any email, set `superAdmin`, touch any other
 * user, change leadership, or change any other field.
 */
const PLATFORM_DOMAIN = '@premarket.homes';
const norm = (e) => String(e || '').trim().toLowerCase();
const mask = (e) => { const v = String(e || ''); const at = v.indexOf('@'); return at < 1 ? '***' : `${v[0]}***${v.slice(at)}`; };
const isAgent = (u) => !!(u?.agent || u?.isAgent || (u?.roles || []).includes?.('agent'));

/** Finds the single office member with this email and checks they may be made an HPH-only administrator. Returns { ok, reasons, ... }. */
async function planGrant({ db, officeId, email }) {
  const officeSnap = await db.collection('officeAdminInfo').doc(officeId).get();
  if (!officeSnap.exists) return { ok: false, reasons: ['office not found'] };
  const office = officeSnap.data();
  const members = (await db.collection('users').where('officeId', '==', officeId).get()).docs;
  const matches = members.filter((d) => norm(d.data().email) === norm(email));
  const reasons = [];
  if (office.status !== 'active') reasons.push('the office is not active');
  if (matches.length !== 1) reasons.push(`expected exactly one ${officeId} member with that email but found ${matches.length}`);
  const target = matches.length === 1 ? { uid: matches[0].id, ...matches[0].data() } : null;
  if (target) {
    if (norm(target.email).endsWith(PLATFORM_DOMAIN)) reasons.push('this is a Premarket platform address; the HPH administrator must be an HPH account');
    if (target.superAdmin === true) reasons.push('this account is a platform super-admin; the HPH administrator must not be');
    if (target.disabled === true || target.deactivated === true) reasons.push('the account is disabled');
    if (target.accountStatus && target.accountStatus !== 'active') reasons.push(`the account has not been activated (status: ${target.accountStatus})`);
    if (!isAgent(target)) reasons.push('the account has no agent role, which the dashboard requires');
  }
  const admins = Array.isArray(office.officeAdminUids) ? office.officeAdminUids : [];
  return {
    ok: reasons.length === 0, reasons, office: { id: officeId, name: office.name }, target: target && { uid: target.uid, email: mask(target.email), status: target.accountStatus || 'active', alreadyAdmin: admins.includes(target.uid) && target.isOfficeAdmin === true },
    adminCountBefore: admins.length,
  };
}

async function applyGrant({ db, FieldValue, officeId, email }) {
  const plan = await planGrant({ db, officeId, email });
  if (!plan.ok) throw new Error('Refusing: ' + plan.reasons.join('; '));
  const uid = plan.target.uid;
  await db.runTransaction(async (tx) => {
    const infoRef = db.collection('officeAdminInfo').doc(officeId); const userRef = db.collection('users').doc(uid);
    const info = (await tx.get(infoRef)).data(); const admins = info.officeAdminUids || [];
    if (!admins.includes(uid)) tx.update(infoRef, { officeAdminUids: FieldValue.arrayUnion(uid) });
    tx.update(userRef, { isOfficeAdmin: true });
    tx.set(db.collection('officeTeamAudit').doc(), { action: 'office.adminGranted', officeId, targetUid: uid, actor: 'scripts/grant-office-admin.js', at: FieldValue.serverTimestamp() });
  });
  const after = (await db.collection('officeAdminInfo').doc(officeId).get()).data().officeAdminUids || [];
  return { uid, adminCountBefore: plan.adminCountBefore, adminCountAfter: after.length };
}

async function applyRevoke({ db, FieldValue, officeId, email }) {
  const officeSnap = await db.collection('officeAdminInfo').doc(officeId).get();
  const members = (await db.collection('users').where('officeId', '==', officeId).get()).docs.filter((d) => norm(d.data().email) === norm(email));
  if (members.length !== 1) throw new Error(`Refusing: expected exactly one member with that email but found ${members.length}`);
  const uid = members[0].id; const admins = officeSnap.data().officeAdminUids || [];
  if (!admins.includes(uid)) throw new Error('Refusing: that account is not an administrator of this office');
  if (admins.length <= 1) throw new Error('Refusing: that would leave the office with no administrator');
  await db.runTransaction(async (tx) => {
    tx.update(db.collection('officeAdminInfo').doc(officeId), { officeAdminUids: FieldValue.arrayRemove(uid) });
    tx.update(db.collection('users').doc(uid), { isOfficeAdmin: FieldValue.delete() });
    tx.set(db.collection('officeTeamAudit').doc(), { action: 'office.adminRevoked', officeId, targetUid: uid, actor: 'scripts/grant-office-admin.js', at: FieldValue.serverTimestamp() });
  });
  return { uid, adminCountAfter: admins.length - 1 };
}

module.exports = { planGrant, applyGrant, applyRevoke, mask };
