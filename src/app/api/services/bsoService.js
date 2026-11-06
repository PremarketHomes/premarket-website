import { FieldValue } from 'firebase-admin/firestore';

/**
 * BSO role (the person who creates and manages Premarket campaigns for the agents they work with).
 *
 * Storage: `officeAdminInfo/{officeId}.bsoUids`, the same server-only office document that already holds
 * `officeAdminUids` and `leadershipUids` (firestore.rules deny every client read/write of it). Nothing is stored
 * on the user document, so there is no client-writable field to protect and nothing to keep in sync.
 *
 * Every check is LIVE: a BSO counts only while (a) they are listed on an ACTIVE office, (b) their account still
 * belongs to that office and (c) the account is usable. Removing the role, moving offices or suspending the account
 * ends all BSO access immediately. Formal team membership is never read here.
 *
 * Which campaigns a BSO may manage is a separate, per-campaign fact: `properties/{id}.managedByUid`
 * (see managedCampaignService.resolveCampaignRole).
 */

export class BsoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BsoError';
    this.status = status;
  }
}

export const bsoUidsOf = (office) => (Array.isArray(office?.bsoUids) ? office.bsoUids : []);
const adminUidsOf = (office) => (Array.isArray(office?.officeAdminUids) ? office.officeAdminUids : []);
/** Active or invited (never logged in) accounts; never suspended, disabled or deactivated ones. */
export const isUsableAccount = (u) => !!u && (!u.accountStatus || ['active', 'invited'].includes(u.accountStatus)) && u.disabled !== true && u.deactivated !== true;
const displayName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || null;

export async function loadActiveOffice(db, officeId) {
  if (!officeId) return null;
  const s = await db.collection('officeAdminInfo').doc(officeId).get();
  if (!s.exists || s.data().status !== 'active') return null;
  return { id: officeId, ...s.data() };
}

/** True only while `uid` is a BSO of `officeId` right now (see the module comment). */
export async function isActiveBso(db, { uid, officeId, office }) {
  if (!uid || !officeId) return false;
  const [o, userSnap] = await Promise.all([
    office && office.id === officeId ? office : loadActiveOffice(db, officeId),
    db.collection('users').doc(uid).get(),
  ]);
  if (!o || o.status !== 'active' || !bsoUidsOf(o).includes(uid)) return false;
  const user = userSnap.exists ? userSnap.data() : null;
  return !!user && user.officeId === officeId && isUsableAccount(user);
}

/** The caller's own BSO status, for navigation and the BSO workspace. */
export async function getBsoAccess(db, uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.exists ? userSnap.data() : null;
  if (!user?.officeId || !isUsableAccount(user)) return { bso: false };
  const office = await loadActiveOffice(db, user.officeId);
  if (!office || !bsoUidsOf(office).includes(uid)) return { bso: false };
  return { bso: true, officeId: office.id, officeName: office.name || '' };
}

async function requireAdmin(db, officeId, actorUid) {
  const office = await loadActiveOffice(db, officeId);
  if (!office) throw new BsoError('Office not found', 404);
  if (!adminUidsOf(office).includes(actorUid)) throw new BsoError('You are not an administrator of this office', 403);
  return office;
}

/** The office's BSOs, for the office admin. `active` is false when a listed BSO has left the office or is suspended. */
export async function listOfficeBsos(db, { officeId, actorUid }) {
  const office = await requireAdmin(db, officeId, actorUid);
  const bsos = await Promise.all(bsoUidsOf(office).map(async (uid) => {
    const s = await db.collection('users').doc(uid).get();
    const u = s.exists ? s.data() : null;
    return { uid, name: displayName(u), email: u?.email || null, active: !!u && u.officeId === officeId && isUsableAccount(u) };
  }));
  return { bsos: bsos.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '')) };
}

/**
 * Office admin grants or removes the BSO role. Idempotent. Audited in `officeTeamAudit` (same collection as the
 * office-admin grant). Removing the role never touches campaigns: their `managedByUid` stays as history, but the
 * person loses access at once, and the office Campaigns page shows those campaigns as needing a manager.
 */
export async function setBsoRole(db, { officeId, actorUid, targetUid, grant }) {
  if (typeof targetUid !== 'string' || !targetUid) throw new BsoError('Choose a person from your office');
  await requireAdmin(db, officeId, actorUid);
  const officeRef = db.collection('officeAdminInfo').doc(officeId);
  const userRef = db.collection('users').doc(targetUid);
  const result = await db.runTransaction(async (tx) => {
    const [o, u] = await Promise.all([tx.get(officeRef), tx.get(userRef)]);
    if (!o.exists || o.data().status !== 'active' || !adminUidsOf(o.data()).includes(actorUid)) throw new BsoError('You are not an administrator of this office', 403);
    const user = u.exists ? u.data() : null;
    const has = bsoUidsOf(o.data()).includes(targetUid);
    if (grant) {
      if (!user || user.officeId !== officeId) throw new BsoError('That person is not a member of your office', 404);
      if (!isUsableAccount(user)) throw new BsoError('That account is suspended, so it cannot be given the BSO role', 409);
    }
    if (grant === has) return { changed: false, bso: has };
    tx.update(officeRef, {
      bsoUids: grant ? FieldValue.arrayUnion(targetUid) : FieldValue.arrayRemove(targetUid),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('officeTeamAudit').doc(), {
      officeId, actorUid, action: grant ? 'office.bsoGranted' : 'office.bsoRevoked', targetUid, teamId: null, detail: {},
      at: FieldValue.serverTimestamp(),
    });
    return { changed: true, bso: grant };
  });
  if (grant) return result;
  // Campaigns this person was managing now need a new manager (reported, never changed automatically).
  const managed = await db.collection('properties').where('managedByUid', '==', targetUid).get();
  return { ...result, campaignsNeedingManager: managed.docs.filter((d) => d.data().archived !== true).length };
}
