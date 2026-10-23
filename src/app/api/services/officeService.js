/**
 * Office accounts — the "one office, many agent subusers" layer on
 * top of the existing, untouched individual-agent platform.
 *
 * Deliberately additive, not a restructuring:
 *   - An office is split across TWO documents, deliberately:
 *       `offices/{officeId}` — PUBLIC-READ, holds ONLY `agencyBrandId`.
 *         This is the one and only field the public property page
 *         (anonymous buyers, no auth) ever needs — see
 *         PropertyPageClient.js and brandProfileService.js's
 *         resolveBrandIdForUser, neither of which reads anything else
 *         off an office.
 *       `officeAdminInfo/{officeId}` — SERVER-ONLY, holds `name`,
 *         `officeAdminUids`, `status`, `createdBy`, timestamps — i.e.
 *         everything administrative/operational. None of this has any
 *         legitimate public-read use case, and `officeAdminUids`
 *         specifically would otherwise let anyone cross-reference it
 *         against the also-public `users` doc to learn exactly who
 *         administers a given office — a narrower, unforced target
 *         list this split removes entirely.
 *     getOfficeById merges both into one object for every caller in
 *     this file, so nothing outside this module needs to know the
 *     split exists.
 *   - officeId is a plain Firestore auto-ID, not a slug of the name —
 *     offices are deliberately provisioned (someone explicitly
 *     registers one), never auto-discovered from free text the way
 *     agencyBrands are, so there's no rename/re-ID hazard to design
 *     around.
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

import { getAuth } from 'firebase-admin/auth';
import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeAgencyNameExact } from './brandProfileService';

const OFFICES_COLLECTION = 'offices'; // public: { agencyBrandId }
const OFFICE_ADMIN_INFO_COLLECTION = 'officeAdminInfo'; // server-only: { name, officeAdminUids, status, createdBy, createdAt, updatedAt }

/** Thrown by requireOfficeAdmin/other guards below — routes read
 * `.status` off this the same way the existing propose-billing-contact
 * route already does for its own thrown errors. */
class OfficeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Merges the public + server-only halves of an office into one
 * object. The `officeAdminInfo` doc is treated as the office's "real"
 * existence marker (it's written atomically with the public doc in
 * createOffice, so the two never exist independently in practice) —
 * the public doc can still be read with no admin doc present without
 * this ever claiming the office exists. */
async function mergeOfficeDocs(officeId) {
  const [publicDoc, adminDoc] = await Promise.all([
    adminDb.collection(OFFICES_COLLECTION).doc(officeId).get(),
    adminDb.collection(OFFICE_ADMIN_INFO_COLLECTION).doc(officeId).get(),
  ]);
  if (!adminDoc.exists) return null;
  return {
    id: officeId,
    ...adminDoc.data(),
    agencyBrandId: publicDoc.exists ? (publicDoc.data()?.agencyBrandId || null) : null,
  };
}

/**
 * Finds an existing office whose name EXACTLY matches (case/whitespace
 * normalized only, same normalizer agencyBrands uses — never fuzzy,
 * never franchise-level grouping). Used at registration time so a
 * second "Harcourts Property Hub" signup never creates a silent
 * duplicate office. Queries the server-only admin doc, never the
 * public one (name doesn't live there at all).
 */
export async function findOfficeByExactName(name) {
  const normalized = normalizeAgencyNameExact(name);
  if (!normalized) return null;
  const snap = await adminDb.collection(OFFICE_ADMIN_INFO_COLLECTION).where('status', '==', 'active').get();
  const match = snap.docs.find((d) => normalizeAgencyNameExact(d.data().name) === normalized);
  return match ? mergeOfficeDocs(match.id) : null;
}

export async function getOfficeById(officeId) {
  if (!officeId) return null;
  return mergeOfficeDocs(officeId);
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
 * `offices`/`officeAdminInfo` doc pair.
 *
 * SECURITY: an exact-name collision never silently creates a second
 * office, and never grants the requester membership of the existing
 * one — typing an office's name is not proof of belonging to it. It
 * instead files an `officeJoinRequests` record for manual follow-up
 * and returns `{status:'exists', ...}` so the signup UI can explain
 * this plainly. Either way, the Firebase Auth account the caller
 * already has by this point keeps working as a completely normal
 * individual agent account — this call can only ever ADD office
 * membership on top of that, never leave anyone with a broken account
 * (see join/page.js's own retry affordance on /dashboard/office for
 * what happens if THIS call itself fails after the Auth account and
 * users/{uid} doc already exist — it's always safe to call again).
 */
export async function createOffice({ adminUid, name }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new OfficeError('Office name is required', 400);
  }

  // An account that already belongs to an office must NEVER be pointed
  // at a second one: the update below overwrites users.officeId, which
  // would silently strand the admin outside their real office (and its
  // whole roster) — e.g. if the "Set Up Your Office" form is ever shown
  // to an established admin by mistake.
  const callerDoc = await adminDb.collection('users').doc(adminUid).get();
  if (callerDoc.exists && callerDoc.data()?.officeId) {
    throw new OfficeError('Your account already belongs to an office', 409);
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
  await Promise.all([
    officeRef.set({ agencyBrandId: null }),
    adminDb.collection(OFFICE_ADMIN_INFO_COLLECTION).doc(officeRef.id).set({
      name: trimmedName,
      officeAdminUids: [adminUid],
      status: 'active',
      createdBy: adminUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);

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
  // A linked-but-unreadable office is an error, NOT "no office" — the
  // caller must never be offered office setup because of it.
  if (!office) throw new OfficeError('Your office record could not be loaded', 500);
  return { ...office, isOfficeAdmin: isOfficeAdminUid(office, uid) };
}

/**
 * The office-submitted phone number waiting to be claimed by this
 * uid, or null if there's nothing to claim — either because they
 * already have a phone number of their own on file (NEVER overwrites
 * a self-entered number) or because no office ever submitted one for
 * them. Reads officeAgentContacts for this EXACT uid only, and is
 * never returned to a client directly; every caller folds the result
 * straight into a users/{uid} update on this SAME uid, never anyone
 * else's — this is what makes "only the verified invited account can
 * receive its matching phone number" true: there is no path that
 * lets one uid claim a DIFFERENT uid's stored contact. Used by both
 * markOfficeAccountActivated below (brand-new accounts) and
 * acceptOfficeInvite (existing accounts) — the two moments a phone
 * number submitted at import time is finally allowed to surface onto
 * the actual agent's own profile.
 */
export async function claimOfficeContactPhone(uid) {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  if (userDoc.exists && userDoc.data().phone) return null;
  const contactDoc = await adminDb.collection('officeAgentContacts').doc(uid).get();
  if (!contactDoc.exists || !contactDoc.data().phone) return null;
  return contactDoc.data().phone;
}

/**
 * Marks an office-invited agent's account as activated — the ONLY
 * thing that ever moves accountStatus from 'invited' to 'active'.
 * Called from the login success path (see login/page.js), after the
 * agent has genuinely authenticated as themselves — never from any
 * import/resend/retry path, none of which can grant access on their
 * own. A safe no-op for every account that isn't an `'invited'`
 * office account (i.e. every ordinary individual-agent login).
 *
 * This is also the moment the office-submitted phone number (see
 * claimOfficeContactPhone) is finally allowed onto the agent's own
 * profile — gated on the SAME genuine-authentication check as
 * activation itself, and never overwriting a number already there
 * (never applicable for a genuinely brand-new account, but kept
 * consistent with acceptOfficeInvite's identical guard regardless).
 * `mobileConfirmedAt` is set alongside it — the same treatment any
 * self-signup's own self-typed number already gets — so this is
 * genuinely the last step: the agent lands in their dashboard with
 * nothing left to confirm except their own profile photo.
 */
export async function markOfficeAccountActivated(uid) {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  if (!userDoc.exists || userDoc.data().accountStatus !== 'invited') {
    return { activated: false };
  }

  const patch = {
    accountStatus: 'active',
    activatedAt: FieldValue.serverTimestamp(),
  };
  const claimedPhone = await claimOfficeContactPhone(uid);
  if (claimedPhone) {
    patch.phone = claimedPhone;
    patch.mobileConfirmedAt = FieldValue.serverTimestamp();
  }

  await adminDb.collection('users').doc(uid).update(patch);
  return { activated: true };
}

/**
 * The office's full roster for its admin dashboard — merges two
 * sources that a raw `users` query alone would miss:
 *   - actual members: `users` docs with officeId == this office
 *     (brand-new CSV/single-add invites, `accountStatus: 'invited'`,
 *     and already-`'active'` members alike).
 *   - pending EXISTING-account invites: `officeInvites` docs for this
 *     office that haven't been accepted (or revoked) yet — these
 *     people are deliberately NOT yet linked (officeId untouched)
 *     until they accept, so they'd be invisible to the admin
 *     otherwise even though an invite is genuinely outstanding.
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
      name: inv.targetName || null,
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
    staged: agents.filter((a) => a.status === 'staged').length,
    sendFailed: agents.filter((a) => a.status === 'send-failed').length,
  };
}

/**
 * Removes an agent from the office, OR revokes a still-pending
 * existing-account invite — the same action from the admin's point of
 * view ("get this person off my roster"), dispatched here based on
 * which kind of row it actually is:
 *
 *   - A real member (officeId already == this office): clears their
 *     own `officeId` (and `isOfficeAdmin`, if they had it), and drops
 *     them from the office's own `officeAdminUids` too if they were an
 *     administrator, so they can never retain admin rights over an
 *     office they're no longer part of. If they were a brand-new,
 *     NEVER-ACTIVATED account (accountStatus still 'invited'), their
 *     Firebase Auth account is also disabled — the only way to
 *     guarantee an outstanding activation link can never be used
 *     after removal, independent of whatever Firebase's own link
 *     lifecycle happens to be. An already-active member keeps their
 *     account and keeps using Premarket independently — only the
 *     office link is removed.
 *   - A pending existing-account invite (never linked — see
 *     officeImportService.js): marks the `officeInvites` doc revoked,
 *     so acceptOfficeInvite refuses it from then on. Nothing about
 *     their actual account is ever touched — they were never linked
 *     in the first place.
 *
 * Never touches properties, offers, reports or billing — those are
 * untouched by office membership entirely — and never removes the
 * LAST remaining administrator (an office must always keep at least
 * one, or no one could ever manage it again).
 */
export async function removeAgentFromOffice({ officeId, targetUid, actorUid }) {
  const office = await requireOfficeAdmin({ officeId, uid: actorUid });

  const targetDoc = await adminDb.collection('users').doc(targetUid).get();
  const targetData = targetDoc.exists ? targetDoc.data() : null;

  if (targetData && targetData.officeId === officeId) {
    if (isOfficeAdminUid(office, targetUid) && office.officeAdminUids.length <= 1) {
      throw new OfficeError('Cannot remove the only remaining office administrator', 400);
    }

    const neverActivated = targetData.accountStatus === 'invited';

    await Promise.all([
      adminDb.collection('users').doc(targetUid).update({
        officeId: FieldValue.delete(),
        isOfficeAdmin: FieldValue.delete(),
      }),
      isOfficeAdminUid(office, targetUid)
        ? adminDb.collection(OFFICE_ADMIN_INFO_COLLECTION).doc(officeId).update({
            officeAdminUids: FieldValue.arrayRemove(targetUid),
            updatedAt: FieldValue.serverTimestamp(),
          })
        : Promise.resolve(),
      neverActivated ? getAuth().updateUser(targetUid, { disabled: true }) : Promise.resolve(),
    ]);

    return { removed: true, uid: targetUid, disabledAccount: neverActivated };
  }

  const inviteRef = adminDb.collection('officeInvites').doc(`${officeId}_${targetUid}`);
  const inviteDoc = await inviteRef.get();
  if (inviteDoc.exists && inviteDoc.data().status === 'pending') {
    await inviteRef.update({ status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: actorUid });
    return { removed: true, uid: targetUid, revokedInvite: true };
  }

  throw new OfficeError('That agent is not a member of this office', 404);
}

export { OfficeError };
