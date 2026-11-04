/**
 * Leadership invitations — how an agency principal or coach is given access to the Leadership Hub.
 *
 * Deliberately separate from office/agent onboarding:
 *   - A leadership account has NO officeId, NO agent/buyer role, NO billing fields and is never on an
 *     office roster. Its only link to an office is its uid in `officeAdminInfo/{officeId}.leadershipUids`
 *     (the one permission the Hub checks — see leadershipService.js).
 *   - Only a superAdmin can invite or revoke. The office is chosen by the superAdmin and stored on the
 *     invitation; nothing the invitee sends can change it.
 *
 * Invitation tokens
 *   - 256-bit random, emailed once, and only their SHA-256 hash is stored (`leadershipInvites/{hash}`).
 *   - Valid for 7 days, single use (consumed inside the same transaction that grants access), replaced
 *     when a newer invitation is issued for the same person and office, and revocable.
 *
 * Existing accounts are never modified. If the email already has a Premarket login the superAdmin must
 * explicitly approve it, the invitee must then sign in as themselves to accept, and acceptance only adds
 * their uid to `leadershipUids` — their password, roles, profile and office membership are left alone.
 *
 * Preview deployments share production data, so every write here is refused on them
 * (VERCEL_ENV === 'preview'); the interface is reviewed with sample data instead.
 */

import crypto from 'node:crypto';

export const INVITES = 'leadershipInvites';
export const AUDIT = 'leadershipAudit';
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class LeadershipInviteError extends Error {
  constructor(message, status, extra) {
    super(message);
    this.status = status;
    if (extra) this.extra = extra;
  }
}

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Writes are refused on Vercel Preview deployments, which are wired to production data. */
export function assertMutationsAllowed(env = process.env) {
  if (env.VERCEL_ENV === 'preview') {
    throw new LeadershipInviteError('Leadership invitations are disabled on Preview deployments, which share production data.', 403);
  }
}

const isAgentRole = (u) => !!(u?.agent || u?.isAgent || u?.roles?.includes?.('agent'));
const isBuyerRole = (u) => !!(u?.isBuyer || u?.roles?.includes?.('buyer'));
export const isLeadershipOnlyUser = (u) => !!u?.roles?.includes?.('leadership') && !isAgentRole(u) && !isBuyerRole(u);

const toMs = (t) => {
  if (!t) return null;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  const n = new Date(t).getTime();
  return Number.isNaN(n) ? null : n;
};
const iso = (t) => { const ms = toMs(t); return ms == null ? null : new Date(ms).toISOString(); };
const isNotFound = (err) => err?.code === 'auth/user-not-found';
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || null;

async function loadOffice(db, officeId) {
  if (!officeId || typeof officeId !== 'string') throw new LeadershipInviteError('Choose an office', 400);
  const snap = await db.collection('officeAdminInfo').doc(officeId).get();
  if (!snap.exists) throw new LeadershipInviteError('Office not found', 404);
  const office = snap.data();
  if (office.status !== 'active') throw new LeadershipInviteError('That office is not active', 409);
  return office;
}

async function audit(db, entry) {
  try {
    await db.collection(AUDIT).doc(`${Date.now()}_${crypto.randomBytes(4).toString('hex')}`).set({ ...entry, at: new Date() });
  } catch (err) {
    console.error('Leadership audit write failed (non-blocking):', err?.message);
  }
}

/* ───────────────────────────── superAdmin: invite ───────────────────────────── */

/**
 * Creates an invitation. Returns { token, inviteId, mode } — `token` is for the email only and must never
 * be returned to a browser or logged. `mode` is 'new' (no login exists yet) or 'existing'.
 * Throws a 409 with `.extra.existing` when the email already has a login and `approveExisting` isn't set.
 */
export async function createLeadershipInvite(db, authApi, { officeId, email, firstName, lastName, approveExisting = false, actorUid }, now = new Date()) {
  assertMutationsAllowed();
  const office = await loadOffice(db, officeId);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 200) throw new LeadershipInviteError('Enter a valid email address', 400);
  const first = cleanName(firstName);
  const last = cleanName(lastName);
  if (!first) throw new LeadershipInviteError('First name is required', 400);

  let existingUid = null;
  try {
    const rec = await authApi.getUserByEmail(cleanEmail);
    if (rec.disabled) throw new LeadershipInviteError('That account is disabled', 409);
    const userSnap = await db.collection('users').doc(rec.uid).get();
    if (!userSnap.exists) {
      throw new LeadershipInviteError('That email has a login but no Premarket profile yet. Ask them to sign in to Premarket once, then try again.', 409);
    }
    const user = userSnap.data();
    if (user.officeId && user.officeId !== officeId) {
      throw new LeadershipInviteError('That account belongs to a different office, so it can’t lead this one.', 409);
    }
    if ((office.leadershipUids || []).includes(rec.uid)) throw new LeadershipInviteError('That person already has leadership access to this office', 409);
    if (!approveExisting) {
      throw new LeadershipInviteError('That email already has a Premarket account. Approve adding leadership access to it, or use a different email.', 409, {
        existing: {
          name: fullName(user),
          email: cleanEmail,
          roles: isAgentRole(user) ? (isBuyerRole(user) ? 'agent + buyer' : 'agent') : isBuyerRole(user) ? 'buyer only' : isLeadershipOnlyUser(user) ? 'leadership' : 'no role',
          office: user.officeId ? 'this office (member)' : 'none',
        },
      });
    }
    existingUid = rec.uid;
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  // One live invitation per person and office: a new one replaces any earlier pending one.
  const prior = await db.collection(INVITES).where('officeId', '==', officeId).where('email', '==', cleanEmail).where('status', '==', 'pending').get();
  await Promise.all(prior.docs.map((d) => db.collection(INVITES).doc(d.id).update({ status: 'revoked', revokedAt: now, revokedBy: actorUid, revokedReason: 'replaced' })));

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const inviteId = tokenHash.slice(0, 16);
  await db.collection(INVITES).doc(tokenHash).set({
    inviteId,
    officeId,
    officeName: office.name || '',
    email: cleanEmail,
    firstName: first,
    lastName: last,
    mode: existingUid ? 'existing' : 'new',
    existingUid,
    status: 'pending',
    createdBy: actorUid,
    createdAt: now,
    expiresAtMs: now.getTime() + INVITE_TTL_MS,
  });
  await audit(db, { type: 'invite-created', officeId, email: cleanEmail, mode: existingUid ? 'existing' : 'new', actorUid });
  return { token, inviteId, mode: existingUid ? 'existing' : 'new', officeName: office.name || '', firstName: first, email: cleanEmail };
}

/* ───────────────────────────── invitee: inspect / redeem ───────────────────────────── */

async function loadInvite(db, token, now = new Date()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw new LeadershipInviteError('This invitation is not valid', 404);
  const ref = db.collection(INVITES).doc(hashToken(token));
  const snap = await ref.get();
  if (!snap.exists) throw new LeadershipInviteError('This invitation is not valid', 404);
  const invite = snap.data();
  if (invite.status === 'used') throw new LeadershipInviteError('This invitation has already been used. Sign in, or use “Forgot password” on the sign-in page.', 410);
  if (invite.status === 'revoked') throw new LeadershipInviteError('This invitation is no longer valid', 410);
  if (invite.status !== 'pending') throw new LeadershipInviteError('This invitation is not valid', 404);
  if (now.getTime() > invite.expiresAtMs) throw new LeadershipInviteError('This invitation has expired. Ask for a new one.', 410);
  const office = await loadOffice(db, invite.officeId).catch(() => null);
  if (!office) throw new LeadershipInviteError('This invitation is not valid', 404);
  return { ref, invite, office };
}

/** Read-only: used when the page loads. Never changes anything (scanners and previews open links). */
export async function inspectLeadershipInvite(db, token, now = new Date()) {
  const { invite } = await loadInvite(db, token, now);
  return { firstName: invite.firstName, email: invite.email, officeName: invite.officeName, mode: invite.mode };
}

/**
 * Consumes the invitation and grants access in ONE transaction, so a token can never be used twice
 * and access is never granted without the token being spent. `apply(tx, { office, user })` adds the
 * account-specific writes.
 */
async function consumeAndGrant(db, ref, uid, { expectMode, createUserDoc, now }) {
  return db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(ref);
    const invite = inviteSnap.exists ? inviteSnap.data() : null;
    if (!invite || invite.status !== 'pending') throw new LeadershipInviteError('This invitation has already been used or is no longer valid', 410);
    if (now.getTime() > invite.expiresAtMs) throw new LeadershipInviteError('This invitation has expired. Ask for a new one.', 410);
    if (invite.mode !== expectMode) throw new LeadershipInviteError('This invitation is not valid', 404);

    const officeRef = db.collection('officeAdminInfo').doc(invite.officeId);
    const officeSnap = await tx.get(officeRef);
    const office = officeSnap.exists ? officeSnap.data() : null;
    if (!office || office.status !== 'active') throw new LeadershipInviteError('This invitation is not valid', 404);

    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (expectMode === 'existing') {
      const user = userSnap.exists ? userSnap.data() : null;
      if (!user) throw new LeadershipInviteError('We couldn’t find your Premarket profile', 409);
      if (user.officeId && user.officeId !== invite.officeId) throw new LeadershipInviteError('This account belongs to a different office', 409);
    } else if (userSnap.exists) {
      throw new LeadershipInviteError('An account already exists for this email. Sign in instead.', 409);
    }

    const current = Array.isArray(office.leadershipUids) ? office.leadershipUids : [];
    tx.update(officeRef, { leadershipUids: current.includes(uid) ? current : [...current, uid], updatedAt: now });
    if (expectMode === 'new') tx.set(userRef, createUserDoc(invite));
    tx.update(ref, { status: 'used', usedAt: now, usedByUid: uid });
    return invite;
  });
}

/**
 * New account: creates the login (no password), the leadership-only profile and the grant, then returns a
 * one-time password-setup code. The password itself goes from the browser straight to Firebase.
 */
export async function redeemNewAccountInvite(db, authApi, token, { baseUrl }, now = new Date()) {
  assertMutationsAllowed();
  const { ref, invite } = await loadInvite(db, token, now);
  if (invite.mode !== 'new') throw new LeadershipInviteError('This invitation is for an existing account. Sign in to accept it.', 409);

  let created;
  try {
    created = await authApi.createUser({ email: invite.email, displayName: `${invite.firstName} ${invite.lastName}`.trim() });
  } catch (err) {
    if (err?.code === 'auth/email-already-exists') {
      throw new LeadershipInviteError('An account already exists for this email. Sign in instead.', 409);
    }
    throw err;
  }

  try {
    await consumeAndGrant(db, ref, created.uid, {
      expectMode: 'new',
      now,
      createUserDoc: (inv) => ({
        firstName: inv.firstName,
        lastName: inv.lastName,
        email: inv.email,
        roles: ['leadership'], // deliberately no agent/buyer role, officeId or campaign fields
        created: now,
        createdVia: 'leadership-invite',
        active: true,
      }),
    });
  } catch (err) {
    // Nothing was granted: remove the login we just made so no stray account is left behind.
    await authApi.deleteUser(created.uid).catch(() => {});
    throw err;
  }
  await audit(db, { type: 'invite-accepted', officeId: invite.officeId, email: invite.email, uid: created.uid, mode: 'new' });

  try {
    const link = await authApi.generatePasswordResetLink(invite.email, { url: `${baseUrl}/login?activated=1` });
    const oobCode = new URL(link).searchParams.get('oobCode');
    if (oobCode) return { oobCode, email: invite.email };
  } catch (err) {
    console.error('Leadership invite: could not mint password code:', err?.message);
  }
  // Access is granted and the account exists; only the password step needs the normal reset flow.
  return { needsPasswordReset: true, email: invite.email };
}

/** Existing account: the signed-in person (matched by email) accepts; only their uid is added to leadershipUids. */
export async function acceptExistingAccountInvite(db, token, { uid, email }, now = new Date()) {
  assertMutationsAllowed();
  const { ref, invite } = await loadInvite(db, token, now);
  if (invite.mode !== 'existing') throw new LeadershipInviteError('This invitation is for a new account. Open it from the email link while signed out.', 409);
  if (!uid || String(email || '').toLowerCase() !== invite.email || (invite.existingUid && invite.existingUid !== uid)) {
    // Checked BEFORE the token is spent, so someone else signing in with the link doesn't burn it.
    throw new LeadershipInviteError(`This invitation is for ${invite.email}. Sign in with that account to accept it.`, 403);
  }
  await consumeAndGrant(db, ref, uid, { expectMode: 'existing', now });
  await audit(db, { type: 'invite-accepted', officeId: invite.officeId, email: invite.email, uid, mode: 'existing' });
  return { officeName: invite.officeName };
}

/* ───────────────────────────── superAdmin: revoke / list ───────────────────────────── */

export async function revokeInvite(db, { officeId, inviteId, actorUid }, now = new Date()) {
  assertMutationsAllowed();
  const snap = await db.collection(INVITES).where('officeId', '==', officeId).where('inviteId', '==', String(inviteId || '')).get();
  const doc = snap.docs[0];
  if (!doc) throw new LeadershipInviteError('Invitation not found', 404);
  if (doc.data().status !== 'pending') throw new LeadershipInviteError('That invitation is no longer pending', 409);
  await db.collection(INVITES).doc(doc.id).update({ status: 'revoked', revokedAt: now, revokedBy: actorUid, revokedReason: 'revoked' });
  await audit(db, { type: 'invite-revoked', officeId, email: doc.data().email, actorUid });
  return { revoked: true };
}

/**
 * Removes a person's leadership access to one office and cancels their pending invitations to it.
 * With `disableAccount`, also disables the login — allowed ONLY for leadership-only accounts (never an
 * agent, buyer, office member or superAdmin), so it can't lock a real user out of Premarket.
 */
export async function revokeLeadership(db, authApi, { officeId, uid, disableAccount = false, actorUid }, now = new Date()) {
  assertMutationsAllowed();
  const officeRef = db.collection('officeAdminInfo').doc(officeId);
  const before = await db.runTransaction(async (tx) => {
    const snap = await tx.get(officeRef);
    if (!snap.exists) throw new LeadershipInviteError('Office not found', 404);
    const current = Array.isArray(snap.data().leadershipUids) ? snap.data().leadershipUids : [];
    if (!current.includes(uid)) throw new LeadershipInviteError('That person does not have leadership access to this office', 404);
    tx.update(officeRef, { leadershipUids: current.filter((u) => u !== uid), updatedAt: now });
    return current;
  });

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.exists ? userSnap.data() : null;
  if (user?.email) {
    const pending = await db.collection(INVITES).where('officeId', '==', officeId).where('email', '==', String(user.email).toLowerCase()).where('status', '==', 'pending').get();
    await Promise.all(pending.docs.map((d) => db.collection(INVITES).doc(d.id).update({ status: 'revoked', revokedAt: now, revokedBy: actorUid, revokedReason: 'access-revoked' })));
  }

  let disabled = false;
  if (disableAccount) {
    if (!user || !isLeadershipOnlyUser(user) || user.officeId || user.superAdmin === true) {
      throw new LeadershipInviteError('Access was removed, but the sign-in was left active: only leadership-only accounts can be disabled.', 409, { accessRemoved: true });
    }
    await authApi.updateUser(uid, { disabled: true });
    disabled = true;
  }
  await audit(db, { type: 'leadership-revoked', officeId, uid, disabledAccount: disabled, actorUid, remaining: before.length - 1 });
  return { revoked: true, disabledAccount: disabled };
}

/** Everything the superAdmin screen shows. Never includes tokens or hashes. */
export async function listLeadership(db, now = new Date()) {
  const officesSnap = await db.collection('officeAdminInfo').get();
  const offices = [];
  for (const d of officesSnap.docs) {
    const o = d.data();
    const leaders = [];
    for (const uid of o.leadershipUids || []) {
      const u = await db.collection('users').doc(uid).get();
      const data = u.exists ? u.data() : null;
      leaders.push({
        uid,
        name: fullName(data) || '(profile missing)',
        email: data?.email || null,
        leadershipOnly: isLeadershipOnlyUser(data),
        roles: data ? (isAgentRole(data) ? 'agent' : isBuyerRole(data) ? 'buyer' : isLeadershipOnlyUser(data) ? 'leadership' : 'none') : null,
      });
    }
    const inviteSnap = await db.collection(INVITES).where('officeId', '==', d.id).get();
    const invites = inviteSnap.docs.map((i) => i.data())
      .sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0)).slice(0, 25)
      .map((i) => ({
        inviteId: i.inviteId, email: i.email, name: `${i.firstName} ${i.lastName}`.trim(), mode: i.mode,
        status: i.status === 'pending' && now.getTime() > i.expiresAtMs ? 'expired' : i.status,
        createdAt: iso(i.createdAt), expiresAt: iso(i.expiresAtMs),
      }));
    offices.push({ id: d.id, name: o.name || '(unnamed office)', status: o.status || 'unknown', leaders, invites });
  }
  offices.sort((a, b) => a.name.localeCompare(b.name));
  return { offices };
}
