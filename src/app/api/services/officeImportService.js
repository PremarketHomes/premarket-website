/**
 * Office agent onboarding — CSV bulk import AND the single "add one
 * agent" action share the exact same per-row logic (processOneRow),
 * so there is only ever one place that decides what happens for a
 * given name/email/phone submitted into an office.
 *
 * Two fundamentally different outcomes, chosen by whether the email
 * already has a Firebase Auth account:
 *   - Genuinely new → a brand-new Firebase Auth user is created with
 *     NO PASSWORD AT ALL, plus a full `users/{uid}` Firestore profile
 *     (mirroring join/page.js's own shape), then a Firebase Admin SDK
 *     `generatePasswordResetLink` is emailed as their activation link
 *     — the same primitive already in production at
 *     /api/admin/users/[id]/reset-password, just relabelled "set up
 *     your account." Nothing is ever emailed in plaintext.
 *   - Already has an account → NEVER silently linked or overwritten.
 *     An `officeInvites` record is created and they're emailed a
 *     one-click accept link; officeId is only ever set once THEY
 *     accept (see acceptOfficeInvite, officeService... actually here).
 *
 * The imported phone number is deliberately never written onto the
 * publicly-readable `users/{uid}.phone` field — it's seeded into its
 * own locked-down `officeAgentContacts/{uid}` document instead (see
 * firestore.rules). This never creates a property, never activates a
 * campaign, and never touches billing in any way.
 *
 * Idempotent retries: committing the SAME import batch twice (or
 * resending a single invite) never creates a second Firebase Auth
 * user or duplicates an office invite, because every per-row decision
 * is made by re-checking live state (does this email already have an
 * Auth account? is this uid already a member of THIS office? is
 * there already a pending invite doc for this exact office+uid pair?)
 * rather than trusting whatever a prior attempt recorded.
 */

import { getAuth } from 'firebase-admin/auth';
import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { BASE_URL } from './emailTemplates';
import { sendOfficeInviteEmail, sendOfficeJoinInviteEmail } from './resendService';
import { OfficeError } from './officeService';
import { createActivationLink } from './officeActivationService';
import { settleChargesForAgent } from './billingService';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS_PER_IMPORT = 2000;
const AUTH_LOOKUP_CHUNK_SIZE = 100; // Firebase Admin SDK's own getUsers() limit
const OFFICE_INVITE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — long enough for a bulk rollout

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function isInviteExpired(invite) {
  const createdMs = toMillis(invite.createdAt);
  if (createdMs == null) return false; // can't tell -> never treat as expired
  return Date.now() - createdMs > OFFICE_INVITE_EXPIRY_MS;
}

function splitName(fullName) {
  const trimmed = String(fullName || '').trim().replace(/\s+/g, ' ');
  const [firstName, ...rest] = trimmed.split(' ');
  return { firstName: firstName || '', lastName: rest.join(' ') };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Minimal, dependency-free CSV parser for this fixed 3-column shape
 * (name, email, phone). Handles quoted fields (so a name containing a
 * comma survives), CRLF or LF line endings, and skips a header row if
 * one is present (detected by the word "email" appearing anywhere in
 * the first row — real data never contains that word in these three
 * columns). Blank lines are skipped. This intentionally does not try
 * to be a general-purpose CSV library — the column order is fixed by
 * the product spec (name, email, phone), not auto-detected.
 */
export function parseCsv(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/).filter((line) => line.trim() !== '');

  function parseLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells.map((c) => c.trim());
  }

  const rows = lines.map(parseLine);
  if (rows.length === 0) return [];

  const firstRowLooksLikeHeader = rows[0].some((cell) => /email/i.test(cell));
  const dataRows = firstRowLooksLikeHeader ? rows.slice(1) : rows;

  return dataRows.map(([name, email, phone]) => ({
    name: name || '',
    email: normalizeEmail(email),
    phone: phone || '',
  }));
}

/**
 * Validates and classifies every row — writes nothing. `new` vs
 * `existing-account` is resolved with a single batched Firebase Auth
 * lookup (getAuth().getUsers(), up to 100 identifiers per call, per
 * Firebase's own limit) rather than one round-trip per row,
 * so this comfortably covers low thousands of rows without excessive
 * latency.
 */
export async function classifyImportRows({ officeId, rawRows }) {
  if (rawRows.length > MAX_ROWS_PER_IMPORT) {
    throw new OfficeError(`A single import is limited to ${MAX_ROWS_PER_IMPORT} rows`, 400);
  }

  const seenEmails = new Set();
  const shaped = rawRows.map((row, index) => {
    const name = String(row.name || '').trim();
    const email = normalizeEmail(row.email);
    const phone = String(row.phone || '').trim();
    const phoneDigits = phone.replace(/\D/g, '');

    if (!name) return { rowIndex: index, name, email, phone, previewStatus: 'invalid', invalidReason: 'Missing name' };
    if (!email || !EMAIL_RE.test(email)) {
      return { rowIndex: index, name, email, phone, previewStatus: 'invalid', invalidReason: 'Missing or invalid email' };
    }
    if (phoneDigits.length < 8) {
      return { rowIndex: index, name, email, phone, previewStatus: 'invalid', invalidReason: 'Missing or invalid phone number' };
    }
    if (seenEmails.has(email)) {
      return { rowIndex: index, name, email, phone, previewStatus: 'duplicate-in-csv' };
    }
    seenEmails.add(email);
    return { rowIndex: index, name, email, phone, previewStatus: 'pending-lookup' };
  });

  const toLookUp = shaped.filter((r) => r.previewStatus === 'pending-lookup');
  const foundByEmail = await lookupExistingAuthUsersByEmail(toLookUp.map((r) => r.email));
  const stagedEmails = await getStagedEmails(officeId);

  const resolved = await Promise.all(
    shaped.map(async (row) => {
      if (row.previewStatus !== 'pending-lookup') return row;
      // Same email already waiting in another staged (unsent) batch — never stage twice.
      if (stagedEmails.has(row.email)) return { ...row, previewStatus: 'already-staged' };

      const existingUser = foundByEmail.get(row.email);
      if (!existingUser) return { ...row, previewStatus: 'new' };

      const existingDoc = await adminDb.collection('users').doc(existingUser.uid).get();
      const existing = existingDoc.exists ? existingDoc.data() : {};
      const base = { ...row, existingUid: existingUser.uid };

      if (existing.officeId === officeId) {
        // Already linked to THIS office: active, or invited-but-not-yet-activated.
        return { ...base, previewStatus: existing.accountStatus === 'invited' ? 'already-invited' : 'already-active-member' };
      }
      // Belongs to a different office — never moved or re-invited from here.
      if (existing.officeId) return { ...base, previewStatus: 'in-other-office' };

      // Existing account with no office: skip if a join invitation is already pending.
      const inviteDoc = await adminDb.collection('officeInvites').doc(officeInviteDocId(officeId, existingUser.uid)).get();
      if (inviteDoc.exists && inviteDoc.data().status === 'pending') return { ...base, previewStatus: 'already-invited' };
      return { ...base, previewStatus: 'existing-account' };
    })
  );

  const summary = resolved.reduce((acc, r) => {
    acc[r.previewStatus] = (acc[r.previewStatus] || 0) + 1;
    return acc;
  }, {});

  return { rows: resolved, summary };
}

/** Chunks identifiers into groups of 100 (Firebase Admin SDK's own
 * getUsers() limit) and returns a Map of normalized email -> UserRecord
 * for every one that actually exists. */
async function lookupExistingAuthUsersByEmail(emails) {
  const unique = [...new Set(emails.filter(Boolean))];
  const found = new Map();
  const auth = getAuth();

  for (let i = 0; i < unique.length; i += AUTH_LOOKUP_CHUNK_SIZE) {
    const chunk = unique.slice(i, i + AUTH_LOOKUP_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const result = await auth.getUsers(chunk.map((email) => ({ email })));
    for (const user of result.users) {
      found.set(normalizeEmail(user.email), user);
    }
  }

  return found;
}

export async function createImportBatch({ officeId, uploadedBy, rows }) {
  const ref = adminDb.collection('officeImports').doc();
  await ref.set({
    officeId,
    uploadedBy,
    rows,
    status: 'previewed',
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function getImportBatch(importId) {
  const doc = await adminDb.collection('officeImports').doc(importId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

/**
 * The one function both the CSV commit loop and the single "add an
 * agent" route call for a single row — this is what guarantees the
 * two paths can never drift into different behaviour for what is
 * conceptually the exact same action.
 *
 * Re-checks live state rather than trusting the row's earlier preview
 * classification, specifically so retries are safe: a prior attempt
 * that created the Auth user but failed before the email sent is
 * detected (found, officeId already == this office, but not yet
 * active) and simply re-sent rather than re-created or wrongly treated
 * as "already a real member, nothing to do."
 */
export async function processOneRow({ officeId, officeName, row, actorUid }) {
  const { name, email, phone } = row;
  const { firstName, lastName } = splitName(name);
  const auth = getAuth();

  let existingUser = null;
  try {
    existingUser = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }

  if (!existingUser) {
    try {
      const result = await inviteNewAgent({ officeId, officeName, firstName, lastName, email, phone, actorUid });
      return { outcome: 'created', uid: result.uid, emailSent: result.emailSent, emailError: result.emailError };
    } catch (err) {
      return { outcome: 'failed', error: err.message };
    }
  }

  const existingDoc = await adminDb.collection('users').doc(existingUser.uid).get();
  const existingData = existingDoc.exists ? existingDoc.data() : {};

  if (existingData.officeId === officeId) {
    if (existingData.accountStatus === 'active') {
      return { outcome: 'skipped', uid: existingUser.uid };
    }
    // Already a member of THIS office but never activated — this is
    // either a half-finished prior attempt (Auth user + Firestore doc
    // created, email send failed) or a genuine resend. Either way,
    // re-sending the activation link is exactly the right, idempotent
    // action — never creates anything new. resendNewAgentActivation
    // never throws for an email failure, so this only fails here on a
    // genuinely unexpected error.
    const result = await resendNewAgentActivation({ uid: existingUser.uid, email, firstName, officeName, officeId });
    return { outcome: 'created', uid: existingUser.uid, emailSent: result.sent, emailError: result.error };
  }

  // Belongs to a DIFFERENT office — never invite (acceptance would be refused anyway),
  // so don't send an unnecessary email.
  if (existingData.officeId && existingData.officeId !== officeId) {
    return { outcome: 'skipped', reason: 'other-office', uid: existingUser.uid };
  }

  // Found, but not (yet) a member of this office — never silently
  // transferred/linked. File (or refresh) a join invite instead.
  // inviteExistingAgentToOffice never throws for an email failure
  // either — only a genuine Firestore-write failure reaches the catch
  // below, which really is a total failure (no record was created).
  try {
    const result = await inviteExistingAgentToOffice({
      officeId,
      officeName,
      targetUid: existingUser.uid,
      targetEmail: email,
      targetName: name,
      targetPhone: phone,
      targetFirstName: firstName || existingData.firstName || '',
      actorUid,
    });
    return { outcome: 'invited-existing', uid: existingUser.uid, emailSent: result.emailSent, emailError: result.emailError };
  } catch (err) {
    return { outcome: 'failed', error: err.message };
  }
}

async function inviteNewAgent({ officeId, officeName, firstName, lastName, email, phone, actorUid }) {
  const auth = getAuth();
  const userRecord = await auth.createUser({
    email,
    displayName: `${firstName} ${lastName}`.trim() || email,
    disabled: false,
  });
  const uid = userRecord.uid;

  await adminDb.collection('users').doc(uid).set({
    activeCampaigns: 0,
    availableCampaigns: 9999,
    avatar: 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png?20150327203541',
    buyerMetrics: { budget: 0, cashBuyer: false, investor: false },
    created: FieldValue.serverTimestamp(),
    email,
    firstName,
    lastName,
    companyName: officeName,
    pro: true,
    agent: true,
    active: true,
    roles: ['agent'],
    showLeaderboard: true,
    tags: ['new', 'office-invited'],
    updatedAt: FieldValue.serverTimestamp(),
    officeId,
    accountStatus: 'invited',
    invitedAt: FieldValue.serverTimestamp(),
    invitedBy: actorUid,
  });

  if (phone) {
    await adminDb.collection('officeAgentContacts').doc(uid).set({
      phone,
      officeId,
      importedBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  const emailResult = await resendNewAgentActivation({ uid, email, firstName, officeName, officeId });
  return { uid, emailSent: emailResult.sent, emailError: emailResult.error };
}

/**
 * Generates a fresh Firebase activation link and emails it — used
 * both for the first invite and any later "resend." A successfully-
 * used oobCode is guaranteed single-use by Firebase itself, and
 * expiry of an unused one is Firebase's own, already-battle-tested
 * behaviour — neither needs anything built here. Whether generating a
 * NEW link also invalidates a still-outstanding older one isn't
 * something this codebase asserts either way; it doesn't need to,
 * since removeAgentFromOffice gives a guarantee that doesn't depend
 * on it at all — a never-activated agent's Firebase Auth account is
 * disabled on removal, which blocks sign-in regardless of whether any
 * particular link is technically still "valid."
 *
 * Deliberately never throws — the account/roster record this backs
 * (see inviteNewAgent) is a real, separate fact from whether the
 * email itself made it out. Callers get `{sent, error}` back and
 * decide what to tell the admin, rather than this function collapsing
 * "the agent now exists" and "the agent was emailed" into one
 * all-or-nothing outcome. Logs only the uid and the error message on
 * failure — never the email address or the generated link.
 */
export async function resendNewAgentActivation({ uid, email, firstName, officeName, officeId }) {
  try {
    // A long-lived (14-day) Premarket link; a fresh Firebase password-setup link is
    // minted only when the agent clicks it (see officeActivationService.js).
    const link = await createActivationLink({ uid, email, officeId });
    await sendOfficeInviteEmail(email, firstName, officeName, link);
    return { uid, sent: true };
  } catch (err) {
    console.error('Office activation email failed to send for uid', uid, '-', err.message);
    return { uid, sent: false, error: err.message };
  }
}

/** Deterministic doc id (officeId_targetUid) — re-inviting the same
 * person to the same office always upserts this one doc rather than
 * creating a new one, which is what makes "resend" and "retry" safe
 * no-ops instead of duplicate invites. */
function officeInviteDocId(officeId, targetUid) {
  return `${officeId}_${targetUid}`;
}

/**
 * Creates/refreshes the invite record for an existing-account agent,
 * THEN attempts the email — but a failure in the email step never
 * throws and never undoes the record. The roster (listOfficeAgents)
 * shows this row the moment the record exists, regardless of whether
 * the email made it out, so collapsing both into one throw/success
 * would make the UI lie about what state things are actually in — see
 * processOneRow's and the office-admin UI's use of the `emailSent`
 * flag this returns. `targetName` is stored here specifically so the
 * roster can display it (see listOfficeAgents) — it's never used for
 * anything else, and is never sent in any email beyond the greeting
 * (targetFirstName, derived by the caller).
 *
 * `targetPhone`, if given, is seeded into officeAgentContacts for
 * this uid — the SAME protected, locked-down store inviteNewAgent
 * already uses for a brand-new account's phone (never the public
 * users.phone field). acceptOfficeInvite later copies it onto this
 * agent's own profile, but ONLY once they themselves accept, and
 * ONLY if they don't already have a phone number on file — this
 * write here is just making that number available to be claimed,
 * never exposing it anywhere on its own.
 */
async function inviteExistingAgentToOffice({ officeId, officeName, targetUid, targetEmail, targetName, targetPhone, targetFirstName, actorUid }) {
  const inviteRef = adminDb.collection('officeInvites').doc(officeInviteDocId(officeId, targetUid));
  await inviteRef.set({
    officeId,
    officeName,
    targetUid,
    targetEmail,
    targetName: targetName || null,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
  });

  if (targetPhone) {
    await adminDb.collection('officeAgentContacts').doc(targetUid).set({
      phone: targetPhone,
      officeId,
      importedBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  const token = officeInviteDocId(officeId, targetUid);
  const link = `${BASE_URL}/office-invite?token=${token}`;
  try {
    await sendOfficeJoinInviteEmail(targetEmail, targetFirstName, officeName, link);
    return { token, emailSent: true };
  } catch (err) {
    console.error('Office join-invite email failed to send for uid', targetUid, '-', err.message);
    return { token, emailSent: false, emailError: err.message };
  }
}

/** Looks up a pending/accepted/revoked invite by its token for the
 * public accept page — returns only what that page needs to render
 * (office name + who it's for + status + whether it's expired), never
 * the full document. `expired` is computed fresh on every read rather
 * than written back, so there's nothing to keep in sync. */
export async function getOfficeInviteByToken(token) {
  const doc = await adminDb.collection('officeInvites').doc(token).get();
  if (!doc.exists) return null;
  const data = doc.data();
  return {
    officeName: data.officeName,
    targetEmail: data.targetEmail,
    status: data.status,
    expired: data.status === 'pending' && isInviteExpired(data),
  };
}

/**
 * The only path that ever sets `officeId` for an agent who already
 * had a Premarket account before this office invited them — and only
 * after THEY, authenticated as themselves, explicitly accept. Verifies
 * `acceptingUid` matches the invite's own targetUid so one person can
 * never accept an invite addressed to someone else, and refuses an
 * invite the office has since revoked (see removeAgentFromOffice) or
 * one that's simply too old — "resend" always re-upserts `createdAt`
 * (see inviteExistingAgentToOffice), so an admin re-sending is exactly
 * what un-expires it, with nothing else to reset.
 */
export async function acceptOfficeInvite({ token, acceptingUid }) {
  const inviteRef = adminDb.collection('officeInvites').doc(token);
  const inviteDoc = await inviteRef.get();
  if (!inviteDoc.exists) {
    throw new OfficeError('This invitation could not be found', 404);
  }
  const invite = inviteDoc.data();

  if (invite.targetUid !== acceptingUid) {
    throw new OfficeError("This invitation isn't for your account", 403);
  }

  if (invite.status === 'accepted') {
    return { officeId: invite.officeId, officeName: invite.officeName, alreadyAccepted: true };
  }

  if (invite.status === 'revoked') {
    throw new OfficeError('This invitation has been revoked', 410);
  }

  if (isInviteExpired(invite)) {
    throw new OfficeError('This invitation has expired — ask your office administrator to resend it', 410);
  }

  // Accepting must never silently re-home someone: a user who already
  // belongs to a DIFFERENT office (member or administrator) would have
  // their officeId overwritten, stranding them away from their real
  // office and roster. The check and the write happen in ONE Firestore
  // transaction, so two concurrent acceptances (or an acceptance racing
  // an office creation) cannot both pass the check and clobber each
  // other. A refusal leaves the invite pending and the user untouched.
  const userRef = adminDb.collection('users').doc(acceptingUid);
  const contactRef = adminDb.collection('officeAgentContacts').doc(acceptingUid);
  // Campaigns created before joining stay billed to the agent as an
  // independent: record any not-yet-recorded charge under their CURRENT
  // (pre-join) billing entity before the office link is written.
  await settleChargesForAgent(acceptingUid);
  await adminDb.runTransaction(async (tx) => {
    const [userSnap, contactSnap, freshInvite] = await Promise.all([tx.get(userRef), tx.get(contactRef), tx.get(inviteRef)]);

    if (freshInvite.exists && freshInvite.data().status === 'revoked') {
      throw new OfficeError('This invitation has been revoked', 410);
    }
    const currentOfficeId = userSnap.exists ? userSnap.data()?.officeId : null;
    if (currentOfficeId && currentOfficeId !== invite.officeId) {
      throw new OfficeError('Your account already belongs to another office, so this invitation cannot be accepted', 409);
    }

    const patch = { officeId: invite.officeId };
    // Same rule as claimOfficeContactPhone: never overwrite a number
    // the agent already has on file.
    const hasOwnPhone = userSnap.exists && userSnap.data().phone;
    if (!hasOwnPhone && contactSnap.exists && contactSnap.data().phone) {
      patch.phone = contactSnap.data().phone;
      patch.mobileConfirmedAt = FieldValue.serverTimestamp();
    }

    tx.update(userRef, patch);
    tx.update(inviteRef, { status: 'accepted', acceptedAt: FieldValue.serverTimestamp() });
  });

  return { officeId: invite.officeId, officeName: invite.officeName, alreadyAccepted: false };
}

/**
 * Resends whichever invitation type currently applies to this uid in
 * this office — a brand-new, not-yet-activated account gets a fresh
 * Firebase activation link; an existing account with a pending
 * office-join invite gets that email re-sent (inviteExistingAgentToOffice
 * is itself an idempotent upsert, so calling it again is exactly a
 * resend, never a duplicate). Used by the single "resend" button on
 * the office roster, covering every row the roster can show.
 */
export async function resendInvitation({ officeId, targetUid }) {
  const userDoc = await adminDb.collection('users').doc(targetUid).get();
  if (userDoc.exists && userDoc.data().officeId === officeId) {
    const u = userDoc.data();
    if (u.accountStatus === 'active') {
      throw new OfficeError('This agent has already activated their account', 400);
    }
    // Office `name` lives on the server-only officeAdminInfo doc, not
    // the minimal public `offices` doc (see officeService.js) — never
    // the public one, which holds only agencyBrandId.
    const officeAdminInfo = await adminDb.collection('officeAdminInfo').doc(officeId).get();
    const result = await resendNewAgentActivation({
      uid: targetUid,
      email: u.email,
      firstName: u.firstName,
      officeName: officeAdminInfo.exists ? officeAdminInfo.data().name : 'Your office',
      officeId,
    });
    return { resent: true, type: 'activation', emailSent: result.sent, emailError: result.error };
  }

  const inviteDoc = await adminDb.collection('officeInvites').doc(officeInviteDocId(officeId, targetUid)).get();
  if (inviteDoc.exists && inviteDoc.data().status === 'pending') {
    const invite = inviteDoc.data();
    const result = await inviteExistingAgentToOffice({
      officeId,
      officeName: invite.officeName,
      targetUid,
      targetEmail: invite.targetEmail,
      targetName: invite.targetName || '',
      targetFirstName: (invite.targetName || '').split(' ')[0] || '',
      actorUid: invite.createdBy,
    });
    return { resent: true, type: 'join-invite', emailSent: result.emailSent, emailError: result.emailError };
  }

  throw new OfficeError('No pending invitation found for this agent', 404);
}

// ─────────────────────────────────────────────────────────────────────────
// STAGING: validate -> stage (no emails, no accounts) -> send on confirmation.
// A staged row is a `rows[]` entry on an officeImports batch with status
// 'staged'. Nothing is created in Auth/Firestore-users and no email is sent
// until sendStagedChunk runs, which reuses processOneRow (the same code the
// single "add an agent" path uses) and is safe to repeat.
// ─────────────────────────────────────────────────────────────────────────

/** Row states that may be sent. Everything else was already classified as skip. */
const ELIGIBLE_PREVIEW = ['new', 'existing-account'];
const RESOLVED_OK = ['created', 'invited-existing', 'skipped'];
const SEND_CHUNK_DEFAULT = 10;
const STALE_SENDING_MS = 3 * 60 * 1000;
const LIVE_BATCH_STATUSES = ['staged', 'sending', 'completed-with-errors'];

/** 'staged' (not yet attempted) | 'sending' | 'send-failed' | 'sent' | null (not applicable). */
export function stagedRowState(row, nowMs = Date.now()) {
  if (!ELIGIBLE_PREVIEW.includes(row.previewStatus)) return null;
  const o = row.commitOutcome;
  if (!o) return 'staged';
  if (o === 'sending') return nowMs - (row.sendingAtMs || 0) > STALE_SENDING_MS ? 'send-failed' : 'sending';
  if (o === 'failed' || row.emailSent === false) return 'send-failed';
  if (RESOLVED_OK.includes(o)) return 'sent';
  return null;
}

async function getStagedEmails(officeId) {
  const snap = await adminDb.collection('officeImports').where('officeId', '==', officeId).get();
  const emails = new Set();
  for (const d of snap.docs) {
    const b = d.data();
    if (!LIVE_BATCH_STATUSES.includes(b.status)) continue;
    for (const r of b.rows || []) {
      const st = stagedRowState(r);
      if (st && st !== 'sent') emails.add(r.email);
    }
  }
  return emails;
}

/** Marks a previewed batch as staged. Nothing is sent. */
export async function stageImportBatch({ importId, officeId }) {
  const batch = await getImportBatch(importId);
  if (!batch) throw new OfficeError('Import batch not found', 404);
  if (batch.officeId !== officeId) throw new OfficeError('Import batch does not belong to this office', 403);
  if (batch.status !== 'previewed' && batch.status !== 'staged') {
    throw new OfficeError('This import has already been sent or discarded', 409);
  }
  const eligible = batch.rows.filter((r) => ELIGIBLE_PREVIEW.includes(r.previewStatus)).length;
  if (eligible === 0) throw new OfficeError('There are no eligible agents to stage in this file', 400);
  await adminDb.collection('officeImports').doc(importId).update({ status: 'staged', stagedAt: FieldValue.serverTimestamp() });
  return { importId, staged: eligible };
}

/** Throws away a batch that has not been sent. Already-sent rows are unaffected (they live as real accounts/invites). */
export async function discardImportBatch({ importId, officeId }) {
  const batch = await getImportBatch(importId);
  if (!batch) throw new OfficeError('Import batch not found', 404);
  if (batch.officeId !== officeId) throw new OfficeError('Import batch does not belong to this office', 403);
  const attempted = (batch.rows || []).some((r) => r.commitOutcome && r.commitOutcome !== 'sending');
  if (attempted) throw new OfficeError('Some invitations in this import were already sent and cannot be discarded', 409);
  await adminDb.collection('officeImports').doc(importId).update({ status: 'discarded', discardedAt: FieldValue.serverTimestamp() });
  return { importId, discarded: true };
}

/** Staged/in-flight/failed rows for the roster (read-only). Phone numbers are never returned. */
export async function listStagedAgents(officeId) {
  const snap = await adminDb.collection('officeImports').where('officeId', '==', officeId).get();
  const out = [];
  for (const d of snap.docs) {
    const b = d.data();
    if (!LIVE_BATCH_STATUSES.includes(b.status)) continue;
    for (const r of b.rows || []) {
      const state = stagedRowState(r);
      if (!state || state === 'sent') continue;
      out.push({
        uid: null,
        key: `staged:${d.id}:${r.rowIndex}`,
        importId: d.id,
        name: r.name || null,
        email: r.email || null,
        status: state, // 'staged' | 'sending' | 'send-failed'
        isOfficeAdmin: false,
        error: state === 'send-failed' ? (r.commitError || r.emailError || 'Email could not be sent') : null,
      });
    }
  }
  return out;
}

/**
 * Sends one chunk of staged invitations.
 *  - mode 'new':   rows never attempted (the "Send All Invitations" button)
 *  - mode 'retry': rows that failed (the "Retry failed" button) — successful rows are never touched
 * Rows are claimed inside a transaction ('sending') so two overlapping calls can never send the same
 * agent twice. Call repeatedly until `remaining` is 0 (the client loops; each call stays short).
 */
export async function sendStagedChunk({ officeId, actorUid, mode = 'new', maxRows = SEND_CHUNK_DEFAULT }) {
  const wanted = mode === 'retry' ? ['send-failed'] : ['staged'];
  const officeAdminInfo = await adminDb.collection('officeAdminInfo').doc(officeId).get();
  const officeName = officeAdminInfo.exists ? officeAdminInfo.data().name : 'Your office';

  const snap = await adminDb.collection('officeImports').where('officeId', '==', officeId).get();
  const batchIds = snap.docs.filter((d) => LIVE_BATCH_STATUSES.includes(d.data().status)).map((d) => d.id);

  // 1. Claim up to maxRows rows (atomically, per batch).
  const claimed = [];
  for (const importId of batchIds) {
    if (claimed.length >= maxRows) break;
    const ref = adminDb.collection('officeImports').doc(importId);
    await adminDb.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const batch = doc.data();
      const rows = [...batch.rows];
      let changed = false;
      for (let i = 0; i < rows.length && claimed.length < maxRows; i++) {
        if (!wanted.includes(stagedRowState(rows[i]))) continue;
        rows[i] = { ...rows[i], commitOutcome: 'sending', sendingAtMs: Date.now() };
        claimed.push({ importId, index: i, row: rows[i] });
        changed = true;
      }
      if (changed) tx.update(ref, { rows, status: 'sending' });
    });
  }

  // 2. Send them (bounded concurrency), then record every outcome.
  const results = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    const group = claimed.slice(i, i + CONCURRENCY);
    const done = await Promise.all(group.map(async (c) => {
      try {
        const r = await processOneRow({ officeId, officeName, row: c.row, actorUid });
        return { ...c, result: r };
      } catch (err) {
        return { ...c, result: { outcome: 'failed', error: err.message } };
      }
    }));
    results.push(...done);
  }

  const byBatch = new Map();
  for (const r of results) byBatch.set(r.importId, [...(byBatch.get(r.importId) || []), r]);
  for (const [importId, items] of byBatch) {
    const ref = adminDb.collection('officeImports').doc(importId);
    await adminDb.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const rows = [...doc.data().rows];
      for (const it of items) {
        const res = it.result;
        rows[it.index] = {
          ...rows[it.index],
          commitOutcome: res.outcome,
          commitError: res.error || null,
          uid: res.uid || null,
          emailSent: res.emailSent ?? null,
          emailError: res.emailError || null,
          sendingAtMs: null,
        };
      }
      const anyOpen = rows.some((r) => ['staged', 'sending', 'send-failed'].includes(stagedRowState(r)));
      tx.update(ref, { rows, status: anyOpen ? (rows.some((r) => stagedRowState(r) === 'send-failed') ? 'completed-with-errors' : 'sending') : 'completed' });
    });
  }

  // 3. What is left?
  const after = await listStagedAgents(officeId);
  const remaining = after.filter((r) => wanted.includes(r.status) || r.status === 'sending').length;
  const sent = results.filter((r) => RESOLVED_OK.includes(r.result.outcome) && r.result.emailSent !== false).length;
  const skipped = results.filter((r) => r.result.outcome === 'skipped').length;
  const failed = results.length - sent;
  return { processed: results.length, sent, failed, skipped, remaining };
}

/**
 * Processes every not-yet-resolved row in a batch (idempotent — a row
 * already marked `created`/`invited-existing`/`skipped` from a prior
 * attempt is left untouched; only `failed` or never-attempted rows are
 * (re)processed), writes the updated outcomes back onto the batch doc,
 * and returns a summary. Safe to call repeatedly for the same
 * importId.
 */
export async function commitImportBatch({ importId, officeId, actorUid }) {
  const batch = await getImportBatch(importId);
  if (!batch) throw new OfficeError('Import batch not found', 404);
  if (batch.officeId !== officeId) throw new OfficeError('Import batch does not belong to this office', 403);

  // Office `name` lives on the server-only officeAdminInfo doc, not
  // the minimal public `offices` doc (see officeService.js) — never
  // the public one, which holds only agencyBrandId.
  const officeAdminInfo = await adminDb.collection('officeAdminInfo').doc(officeId).get();
  const officeName = officeAdminInfo.exists ? officeAdminInfo.data().name : 'Your office';

  const CONCURRENCY = 10;
  const rows = [...batch.rows];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (row, offsetInChunk) => {
        const idx = i + offsetInChunk;
        if (['created', 'invited-existing', 'skipped'].includes(rows[idx].commitOutcome)) return;
        if (['invalid', 'duplicate-in-csv', 'already-active-member'].includes(row.previewStatus)) {
          rows[idx] = { ...row, commitOutcome: 'skipped' };
          return;
        }
        const result = await processOneRow({ officeId, officeName, row, actorUid });
        rows[idx] = {
          ...row,
          commitOutcome: result.outcome,
          commitError: result.error || null,
          uid: result.uid || null,
          emailSent: result.emailSent ?? null,
          emailError: result.emailError || null,
        };
      })
    );
  }

  // A row whose account/invite record was created but whose email
  // failed to send is NOT a silent "completed" — the admin needs to
  // know to resend it, same as a hard failure.
  const anyFailed = rows.some((r) => r.commitOutcome === 'failed' || r.emailSent === false);
  await adminDb.collection('officeImports').doc(importId).update({
    rows,
    status: anyFailed ? 'completed-with-errors' : 'completed',
    committedAt: FieldValue.serverTimestamp(),
  });

  const summary = rows.reduce((acc, r) => {
    acc[r.commitOutcome] = (acc[r.commitOutcome] || 0) + 1;
    return acc;
  }, {});
  summary.emailFailed = rows.filter((r) => r.emailSent === false).length;

  return { importId, summary, rows };
}
