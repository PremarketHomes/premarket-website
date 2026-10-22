/**
 * Office accounts — the "one office, many agent subusers" layer on
 * top of the existing, untouched individual-agent platform.
 *
 * Deliberately additive, not a restructuring:
 *   - `offices/{officeId}` is a brand-new top-level collection. An
 *     office is a small, separate record — name, linked agency brand,
 *     and the short list of agent uids allowed to administer it
 *     (`officeAdminUids`). officeId is a plain Firestore auto-ID, not
 *     a slug of the name — offices are deliberately provisioned
 *     (someone explicitly registers one), never auto-discovered from
 *     free text the way agencyBrands are, so there's no rename/re-ID
 *     hazard to design around.
 *   - `users/{uid}.officeId` is the only new field on the existing
 *     `users` collection that matters for authorization — a single
 *     scalar (not an array), exactly like `agencyBrandId` before it.
 *     One agent, one office, for this first version — if multi-office
 *     membership is ever needed, the documented extension is an
 *     *additional* membership list alongside this field, never a
 *     replacement of it. Protected in firestore.rules exactly like
 *     `agencyBrandId`/`brandColors`: never in the client create/update
 *     allowlist, so it can only ever be set here, via the Admin SDK,
 *     after a real invite was accepted or an office was registered
 *     through the validated signup path.
 *   - Properties, offers, reports and billing (`agent:{uid}`) never
 *     read officeId or office membership at all — ownership of all of
 *     those stays exactly `userId == auth.uid`, completely unchanged.
 *     An office admin's authority is scoped to exactly one thing: the
 *     roster of their own office (invite/resend/remove) — never any
 *     agent's properties, offers, reports or billing, their own
 *     office's or anyone else's.
 */

import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeAgencyNameExact } from './brandProfileService';

const OFFICES_COLLECTION = 'offices';

/** Thrown by requireOfficeAdmin/other guards below — routes read
 * `.status` off this the same way the existing propose-billing-contact
 * route already does for its own thrown errors. */
class OfficeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Finds an existing office whose name EXACTLY matches (case/whitespace
 * normalized only, same normalizer agencyBrands uses — never fuzzy,
 * never franchise-level grouping). Used at registration time so a
 * second "Harcourts Property Hub" signup never creates a silent
 * duplicate office.
 */
export async function findOfficeByExactName(name) {
  const normalized = normalizeAgencyNameExact(name);
  if (!normalized) return null;
  const snap = await adminDb.collection(OFFICES_COLLECTION).where('status', '==', 'active').get();
  const match = snap.docs.find((d) => normalizeAgencyNameExact(d.data().name) === normalized);
  return match ? { id: match.id, ...match.data() } : null;
}

export async function getOfficeById(officeId) {
  if (!officeId) return null;
  const doc = await adminDb.collection(OFFICES_COLLECTION).doc(officeId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

export function isOfficeAdminUid(office, uid) {
  return Array.isArray(office?.officeAdminUids) && office.officeAdminUids.includes(uid);
}

/** Loads the office and throws (with a route-ready `.status`) unless
 * `uid` is one of its administrators. Every office-admin-only route
 * calls this first, and only this — there's no separate role/claim to
 * keep in sync, just "is my uid in this one small array." */
export async function requireOfficeAdmin({ officeId, uid }) {
  const office = await getOfficeById(officeId);
  if (!office) throw new OfficeError('Office not found', 404);
  if (!isOfficeAdminUid(office, uid)) {
    throw new OfficeError('You are not an administrator of this office', 403);
  }
  return office;
}

/**
 * Registers a brand-new office and makes `adminUid` its sole initial
 * administrator — called right after that person's own Firebase Auth
 * account + basic `users/{uid}` doc already exist (same client-side
 * createUserWithEmailAndPassword + setDoc pattern every other signup
 * flow uses; see join/page.js). This is the ONLY path that creates an
 * `offices` doc.
 *
 * SECURITY: an exact-name collision never silently creates a second
 * office, and never grants the requester membership of the existing
 * one — typing an office's name is not proof of belonging to it. It
 * instead files an `officeJoinRequests` record for manual follow-up
 * and returns `{status:'exists', ...}` so the signup UI can explain
 * this plainly. Either way, the Firebase Auth account the caller
 * already has by this point keeps working as a completely normal
 * individual agent account — this call can only ever ADD office
 * membership on top of that, never leave anyone with a broken account.
 */
export async function createOffice({ adminUid, name }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new OfficeError('Office name is required', 400);
  }

  const existing = await findOfficeByExactName(trimmedName);
  if (existing) {
    await adminDb.collection('officeJoinRequests').add({
      officeId: existing.id,
      officeName: existing.name,
      requestedByUid: adminUid,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { status: 'exists', officeId: existing.id, officeName: existing.name };
  }

  const officeRef = adminDb.collection(OFFICES_COLLECTION).doc();
  await officeRef.set({
    name: trimmedName,
    agencyBrandId: null,
    officeAdminUids: [adminUid],
    status: 'active',
    createdBy: adminUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // The admin's own phone number was already written by their own
  // client-side setDoc at account creation (join/page.js), exactly
  // like any other self-signup — self-submitted contact data about
  // their own account, so it's fine on the same public `users.phone`
  // field every other agent's own number already lives on. This call
  // only ever adds the office-membership fields on top of that.
  await adminDb.collection('users').doc(adminUid).update({
    officeId: officeRef.id,
    isOfficeAdmin: true,
    accountStatus: 'active',
  });

  return { status: 'created', officeId: officeRef.id, officeName: trimmedName };
}

/**
 * The caller's own office, if any, plus whether they administer it.
 * Used by /api/offices/mine and to gate the Office Management
 * dashboard — read-only, never writes anything.
 */
export async function getOfficeForUser(uid) {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  const officeId = userDoc.exists ? userDoc.data()?.officeId : null;
  if (!officeId) return null;
  const office = await getOfficeById(officeId);
  if (!office) return null;
  return { ...office, isOfficeAdmin: isOfficeAdminUid(office, uid) };
}

/**
 * The office's full roster for its admin dashboard — merges two
 * sources that a raw `users` query alone would miss:
 *   - actual members: `users` docs with officeId == this office
 *     (brand-new CSV/single-add invites, `accountStatus: 'invited'`,
 *     and already-`'active'` members alike).
 *   - pending EXISTING-account invites: `officeInvites` docs for this
 *     office that haven't been accepted yet — these people are
 *     deliberately NOT yet linked (officeId untouched) until they
 *     accept, so they'd be invisible to the admin otherwise even
 *     though an invite is genuinely outstanding.
 * Never reads properties, offers, reports or billing for anyone.
 */
export async function listOfficeAgents(officeId) {
  const [membersSnap, invitesSnap] = await Promise.all([
    adminDb.collection('users').where('officeId', '==', officeId).get(),
    adminDb.collection('officeInvites').where('officeId', '==', officeId).where('status', '==', 'pending').get(),
  ]);

  const members = membersSnap.docs.map((d) => {
    const u = d.data();
    return {
      uid: d.id,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || null,
      email: u.email || null,
      status: u.accountStatus === 'invited' ? 'invited' : 'active',
      isOfficeAdmin: !!u.isOfficeAdmin,
      invitedAt: u.invitedAt || null,
      activatedAt: u.activatedAt || null,
    };
  });

  const pendingInvites = invitesSnap.docs.map((d) => {
    const inv = d.data();
    return {
      uid: inv.targetUid,
      name: null,
      email: inv.targetEmail || null,
      status: 'pending-acceptance',
      isOfficeAdmin: false,
      invitedAt: inv.createdAt || null,
      activatedAt: null,
    };
  });

  return [...members, ...pendingInvites];
}

export function computeOfficeStats(agents) {
  return {
    total: agents.length,
    active: agents.filter((a) => a.status === 'active').length,
    invited: agents.filter((a) => a.status === 'invited').length,
    pendingAcceptance: agents.filter((a) => a.status === 'pending-acceptance').length,
  };
}

/**
 * Removes an agent from the office — clears their own `officeId`
 * (and `isOfficeAdmin`, if they had it) and, if they were an
 * administrator, drops them from the office's own `officeAdminUids`
 * too, so they can never retain admin rights over an office they're
 * no longer part of. Never touches their properties, offers, reports
 * or billing — those are untouched by office membership entirely —
 * and never the LAST remaining administrator (an office must always
 * keep at least one, or no one could ever manage it again).
 */
export async function removeAgentFromOffice({ officeId, targetUid, actorUid }) {
  const office = await requireOfficeAdmin({ officeId, uid: actorUid });

  const targetDoc = await adminDb.collection('users').doc(targetUid).get();
  if (!targetDoc.exists || targetDoc.data().officeId !== officeId) {
    throw new OfficeError('That agent is not a member of this office', 404);
  }

  if (isOfficeAdminUid(office, targetUid) && office.officeAdminUids.length <= 1) {
    throw new OfficeError('Cannot remove the only remaining office administrator', 400);
  }

  await Promise.all([
    adminDb.collection('users').doc(targetUid).update({
      officeId: FieldValue.delete(),
      isOfficeAdmin: FieldValue.delete(),
    }),
    isOfficeAdminUid(office, targetUid)
      ? adminDb.collection(OFFICES_COLLECTION).doc(officeId).update({
          officeAdminUids: FieldValue.arrayRemove(targetUid),
          updatedAt: FieldValue.serverTimestamp(),
        })
      : Promise.resolve(),
  ]);

  return { removed: true, uid: targetUid };
}

export { OfficeError };
