import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../firebase/adminApp';
import { sendPropertyReadyEmail } from './resendService';

// Durable, server-side "send this notification exactly once" for events that
// are not already covered by their own dedupe (offers have notify-interest's
// claim; this generalises that pattern).
//
// One document per EVENT in the server-only `emailLog` collection (no client
// rule, so it falls under the default deny). The document id is the event key.
//   status: 'sending' -> 'sent'      the one terminal success
//                     -> 'skipped'   terminal: recipient not eligible / no longer the owner
//                     -> 'failed'    retryable: the send itself failed
// A caller that arrives while another holds a fresh 'sending' claim, or after
// 'sent' / 'skipped', does nothing. The Resend Idempotency-Key is the same key,
// a second layer for the one window the log cannot cover (Resend accepted the
// email but this process died before writing 'sent').

const CLAIM_STALE_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// Resend honours an Idempotency-Key for 24h from its first use (firstAttemptMs). Inside this window a repeat of an
// attempt whose outcome is unknown (timeout, crash after the request left) is
// safe: Resend returns the original send instead of sending again. Beyond it
// the outcome can no longer be settled automatically, so it is parked for a
// human rather than risking a second email.
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

/** One key per assignment event: a new owner or a new reassignment is a new seq. */
export function propertyReadyKey({ propertyId, recipientUid, seq }) {
  return `property_ready__${propertyId}__${recipientUid}__${seq}`;
}

/**
 * Who may receive an operational email. A whitelist, not a denylist: anything
 * that is not clearly an active, reachable account is skipped.
 *   - user document exists and has an email
 *   - accountStatus, when set, is 'active' (an invited agent has not activated yet)
 *   - not unsubscribed, not flagged disabled/deactivated
 *   - the Firebase Auth account exists and is not disabled
 */
export async function checkRecipientEligibility(uid, userData) {
  if (!userData) return { ok: false, reason: 'no-user-document' };
  if (!userData.email) return { ok: false, reason: 'no-email' };
  if (userData.accountStatus && userData.accountStatus !== 'active') {
    return { ok: false, reason: `account-${userData.accountStatus}` };
  }
  if (userData.unsubscribed === true) return { ok: false, reason: 'unsubscribed' };
  if (userData.disabled === true || userData.deactivated === true) return { ok: false, reason: 'account-disabled' };

  try {
    const authUser = await getAuth().getUser(uid);
    if (authUser.disabled) return { ok: false, reason: 'auth-disabled' };
  } catch (err) {
    if (err?.code === 'auth/user-not-found') return { ok: false, reason: 'no-auth-account' };
    // Cannot confirm the account is live: do not send. The caller treats this as retryable.
    throw err;
  }
  return { ok: true };
}

async function claim(logRef, base, { retryOnly = false } = {}) {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(logRef);
    const data = snap.exists ? snap.data() : null;
    if (!data && retryOnly) return { proceed: false, reason: 'no-prior-event' };
    if (data) {
      if (data.status === 'sent' || data.status === 'skipped' || data.status === 'needs-review') {
        return { proceed: false, reason: data.status };
      }
      if (data.status === 'sending' && Date.now() - (data.claimedAtMs || 0) < CLAIM_STALE_MS) {
        return { proceed: false, reason: 'in-progress' };
      }
      if ((data.attempts || 0) >= MAX_ATTEMPTS) {
        tx.update(logRef, { status: 'needs-review', reason: 'max-attempts' });
        return { proceed: false, reason: 'needs-review' };
      }
      // An earlier attempt may or may not have reached Resend (a stale 'sending'
      // claim, or a failure that was not a definite rejection). Retrying with the
      // same Idempotency-Key is safe only while Resend still remembers it.
      const outcomeUnknown = data.status === 'sending' || data.uncertain === true;
      if (outcomeUnknown && Date.now() - (data.firstAttemptMs || data.claimedAtMs || 0) > IDEMPOTENCY_WINDOW_MS) {
        tx.update(logRef, { status: 'needs-review', reason: 'outcome-unknown-after-idempotency-window' });
        return { proceed: false, reason: 'needs-review' };
      }
    }
    const attempts = (data?.attempts || 0) + 1;
    const now = Date.now();
    tx.set(logRef, { ...base, ...(data ? { createdAt: data.createdAt } : {}), status: 'sending', attempts, claimedAtMs: now, firstAttemptMs: data?.firstAttemptMs || now, uncertain: false, lastError: null });
    return { proceed: true, attempts };
  });
}

/**
 * Sends the "property is ready to review" email for one assignment event, once.
 * `seq` identifies the event (see the reassign route); the same (property,
 * recipient, seq) can never email twice, whatever retries, concurrent requests or
 * repeated saves happen. Never throws for an ordinary skip or send failure — it
 * returns { sent, reason } so a caller (an admin action) is never broken by email.
 */
export async function sendPropertyReadyOnce({ propertyId, recipientUid, seq, retryOnly = false }) {
  if (!propertyId || !recipientUid || seq === undefined || seq === null) {
    return { sent: false, reason: 'invalid-arguments' };
  }

  const key = propertyReadyKey({ propertyId, recipientUid, seq });
  const logRef = adminDb.collection('emailLog').doc(key);

  const claimed = await claim(logRef, {
    type: 'property_ready',
    propertyId,
    recipientUid,
    seq,
    createdAt: FieldValue.serverTimestamp(),
  }, { retryOnly });
  if (!claimed.proceed) return { sent: false, reason: claimed.reason };

  try {
    const [propertySnap, userSnap] = await Promise.all([
      adminDb.collection('properties').doc(propertyId).get(),
      adminDb.collection('users').doc(recipientUid).get(),
    ]);

    // The recipient must still own the property at send time: if it was
    // reassigned again, or deleted, this earlier event is stale.
    if (!propertySnap.exists) return await finish(logRef, 'skipped', 'property-missing');
    const property = propertySnap.data();
    if (property.userId !== recipientUid) return await finish(logRef, 'skipped', 'no-longer-owner');

    const user = userSnap.exists ? userSnap.data() : null;
    const eligibility = await checkRecipientEligibility(recipientUid, user);
    if (!eligibility.ok) return await finish(logRef, 'skipped', eligibility.reason);

    await sendPropertyReadyEmail(
      user.email,
      user.firstName,
      property.formattedAddress || property.address || 'your new property',
      propertyId,
      { idempotencyKey: key },
    );

    await logRef.update({ status: 'sent', sentAt: FieldValue.serverTimestamp() });
    return { sent: true };
  } catch (err) {
    console.error(`property-ready notification failed (${key}):`, err);
    // Retryable: released immediately (not left to the stale window). A definite
    // Resend rejection means nothing was sent; anything else (network error,
    // timeout) may have been delivered, so it is flagged uncertain and only ever
    // retried under the same Idempotency-Key, inside Resend's 24h window.
    const message = String(err?.message || err);
    const uncertain = !/^Resend rejected the email/.test(message);
    try {
      await logRef.update({ status: 'failed', uncertain, lastError: message.slice(0, 300) });
    } catch (logErr) {
      console.error(`could not record failure for ${key}:`, logErr);
    }
    return { sent: false, reason: 'send-failed' };
  }
}

async function finish(logRef, status, reason) {
  await logRef.update({ status, reason });
  return { sent: false, reason };
}
