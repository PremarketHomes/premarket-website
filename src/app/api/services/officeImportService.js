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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS_PER_IMPORT = 2000;
const AUTH_LOOKUP_CHUNK_SIZE = 100; // Firebase Admin SDK's own getUsers() limit
const OFFICE_INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same createdAt-based pattern as docLinks

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

  const resolved = await Promise.all(
    shaped.map(async (row) => {
      if (row.previewStatus !== 'pending-lookup') return row;
      const existingUser = foundByEmail.get(row.email);
      if (!existingUser) return { ...row, previewStatus: 'new' };

      const existingDoc = await adminDb.collection('users').doc(existingUser.uid).get();
      const existingOfficeId = existingDoc.exists ? existingDoc.data()?.officeId : null;
      return {
        ...row,
        previewStatus: existingOfficeId === officeId ? 'already-active-member' : 'existing-account',
        existingUid: existingUser.uid,
      };
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
      const uid = await inviteNewAgent({ officeId, officeName, firstName, lastName, email, phone, actorUid });
      return { outcome: 'created', uid };
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
    // action — never creates anything new.
    try {
      await resendNewAgentActivation({ uid: existingUser.uid, email, firstName, officeName });
      return { outcome: 'created', uid: existingUser.uid };
    } catch (err) {
      return { outcome: 'failed', error: err.message };
    }
  }

  // Found, but not (yet) a member of this office — never silently
  // transferred/linked. File (or refresh) a join invite instead.
  try {
    await inviteExistingAgentToOffice({
      officeId,
      officeName,
      targetUid: existingUser.uid,
      targetEmail: email,
      targetFirstName: firstName || existingData.firstName || '',
      actorUid,
    });
    return { outcome: 'invited-existing', uid: existingUser.uid };
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

  await resendNewAgentActivation({ uid, email, firstName, officeName });
  return uid;
}

/** Generates a fresh Firebase activation link and emails it — used
 * both for the first invite and any later "resend." A successfully-
 * used oobCode is guaranteed single-use by Firebase itself, and
 * expiry of an unused one is Firebase's own, already-battle-tested
 * behaviour — neither needs anything built here. Whether generating a
 * NEW link also invalidates a still-outstanding older one isn't
 * something this codebase asserts either way; it doesn't need to,
 * since removeAgentFromOffice gives a guarantee that doesn't depend
 * on it at all — a never-activated agent's Firebase Auth account is
 * disabled on removal, which blocks sign-in regardless of whether any
 * particular link is technically still "valid." */
export async function resendNewAgentActivation({ uid, email, firstName, officeName }) {
  const link = await getAuth().generatePasswordResetLink(email, { url: `${BASE_URL}/login?activated=1` });
  await sendOfficeInviteEmail(email, firstName, officeName, link);
  return { uid, sent: true };
}

/** Deterministic doc id (officeId_targetUid) — re-inviting the same
 * person to the same office always upserts this one doc rather than
 * creating a new one, which is what makes "resend" and "retry" safe
 * no-ops instead of duplicate invites. */
function officeInviteDocId(officeId, targetUid) {
  return `${officeId}_${targetUid}`;
}

async function inviteExistingAgentToOffice({ officeId, officeName, targetUid, targetEmail, targetFirstName, actorUid }) {
  const inviteRef = adminDb.collection('officeInvites').doc(officeInviteDocId(officeId, targetUid));
  await inviteRef.set({
    officeId,
    officeName,
    targetUid,
    targetEmail,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
  });

  const token = officeInviteDocId(officeId, targetUid);
  const link = `${BASE_URL}/office-invite?token=${token}`;
  await sendOfficeJoinInviteEmail(targetEmail, targetFirstName, officeName, link);
  return { token };
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

  await adminDb.collection('users').doc(acceptingUid).update({ officeId: invite.officeId });
  await inviteRef.update({ status: 'accepted', acceptedAt: FieldValue.serverTimestamp() });

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
    await resendNewAgentActivation({
      uid: targetUid,
      email: u.email,
      firstName: u.firstName,
      officeName: officeAdminInfo.exists ? officeAdminInfo.data().name : 'Your office',
    });
    return { resent: true, type: 'activation' };
  }

  const inviteDoc = await adminDb.collection('officeInvites').doc(officeInviteDocId(officeId, targetUid)).get();
  if (inviteDoc.exists && inviteDoc.data().status === 'pending') {
    const invite = inviteDoc.data();
    await inviteExistingAgentToOffice({
      officeId,
      officeName: invite.officeName,
      targetUid,
      targetEmail: invite.targetEmail,
      targetFirstName: '',
      actorUid: invite.createdBy,
    });
    return { resent: true, type: 'join-invite' };
  }

  throw new OfficeError('No pending invitation found for this agent', 404);
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
        rows[idx] = { ...row, commitOutcome: result.outcome, commitError: result.error || null, uid: result.uid || null };
      })
    );
  }

  const anyFailed = rows.some((r) => r.commitOutcome === 'failed');
  await adminDb.collection('officeImports').doc(importId).update({
    rows,
    status: anyFailed ? 'completed-with-errors' : 'completed',
    committedAt: FieldValue.serverTimestamp(),
  });

  const summary = rows.reduce((acc, r) => {
    acc[r.commitOutcome] = (acc[r.commitOutcome] || 0) + 1;
    return acc;
  }, {});

  return { importId, summary, rows };
}
