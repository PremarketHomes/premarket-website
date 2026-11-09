import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { sendNewBuyerInterestEmail } from '../../services/resendService';

// How long a claimed-but-unfinished notification attempt blocks a retry.
// Covers the real double-click/rapid-retry race this exists for, without
// permanently losing the notification if the one request that claimed it
// fails outright (Resend downtime, a bad key, a timeout) — see the
// success/failure handling below, which clears the claim immediately on
// a known failure rather than waiting out this window regardless.
const NOTIFY_CLAIM_STALE_MS = 2 * 60 * 1000;

// Abuse protection for this unauthenticated route (it is called by the public buyer page, not a signed-in user):
//  - ids must look like Firestore ids before anything is read;
//  - every "skipped" answer is identical, so the route cannot be used to tell which offer or property ids exist
//    (the real reason is logged server-side);
//  - one property can trigger at most NOTIFY_MAX_PER_HOUR emails an hour (a durable counter in the server-only
//    emailLog collection). Real registrations are unaffected: a busy open home is far below the limit, and a
//    throttled registration keeps its stored data and can still be notified by a later call.
const ID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const NOTIFY_MAX_PER_HOUR = 60;
const NOTIFY_WINDOW_MS = 60 * 60 * 1000;
const SKIPPED = { skipped: true };

async function allowPropertyNotification(propertyId) {
  const ref = adminDb.collection('emailLog').doc(`interest_notify__${propertyId}`);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : null;
    const now = Date.now();
    if (!d || now - (d.windowStartMs || 0) >= NOTIFY_WINDOW_MS) {
      tx.set(ref, { type: 'interest_notify_window', propertyId, windowStartMs: now, count: 1 });
      return true;
    }
    if ((d.count || 0) >= NOTIFY_MAX_PER_HOUR) return false;
    tx.update(ref, { count: (d.count || 0) + 1 });
    return true;
  });
}

/**
 * Fires once, right after a buyer successfully registers formal interest —
 * the one real-time signal an agent gets today beyond opening the property
 * dashboard themselves. The buyer's own registration has already been
 * saved by the time this is called (see PropertyPageClient.js's
 * handleContactSubmit, which calls this fire-and-forget and never lets a
 * failure here affect the buyer's own confirmation).
 *
 * Dedup is a two-phase claim, not a single flag, because a one-shot
 * "already notified" flag written before the send turned out to have a
 * real failure mode in production: if the send itself fails for any
 * reason (an invalid RESEND_API_KEY was the actual incident — see
 * sendEmail's own comment in resendService.js for why that failure was
 * previously silent), the offer would be permanently marked as notified
 * with no email ever having gone out, and no retry would ever be
 * possible. Instead:
 *   - interestNotifyingSince is claimed transactionally the moment a
 *     request starts sending. A second request arriving while this claim
 *     is fresh (within NOTIFY_CLAIM_STALE_MS) is the real double-click/
 *     retry/refresh case this guards against, and is skipped.
 *   - interestNotifiedAt is only ever written after sendNewBuyerInterestEmail
 *     has actually resolved without throwing — the final, permanent
 *     "this genuinely sent" marker.
 *   - On a failure, the claim is cleared immediately (not left to expire)
 *     so the very next attempt — another buyer action, a manual retry,
 *     whatever triggers this route again — can actually succeed once
 *     the underlying problem (e.g. the API key) is fixed, rather than
 *     this offer being silently unrecoverable forever.
 *
 * Also only ever sends for a "genuine" registration — `serious === true`
 * on the offer — as defense in depth beyond the one caller that exists
 * today, since a route that sends email shouldn't trust its caller alone
 * to have gated that correctly.
 *
 * Reads via the Admin SDK (bypasses the now-private `offers`/`users`
 * rules by design — this is a server-only route, never called with a
 * client session) so it can resolve the owning agent's email itself
 * rather than trusting whatever the client happened to send, and so no
 * buyer PII ever needs to travel in the request beyond an offer id.
 */
export async function POST(req) {
  let offerRef = null;

  try {
    const { offerId, propertyId } = await req.json().catch(() => ({}));
    if (!offerId || !propertyId) {
      return NextResponse.json({ error: 'offerId and propertyId required' }, { status: 400 });
    }
    if (!ID_RE.test(String(offerId)) || !ID_RE.test(String(propertyId))) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    offerRef = adminDb.collection('offers').doc(offerId);

    const claim = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(offerRef);
      if (!snap.exists) return { proceed: false, reason: 'offer not found' };

      const data = snap.data();
      if (data.propertyId !== propertyId) return { proceed: false, reason: 'propertyId mismatch' };
      if (data.serious !== true) return { proceed: false, reason: 'not a genuine registration' };
      if (data.interestNotifiedAt) return { proceed: false, reason: 'already notified' };

      const claimedAt = data.interestNotifyingSince?.toMillis?.();
      if (claimedAt && Date.now() - claimedAt < NOTIFY_CLAIM_STALE_MS) {
        return { proceed: false, reason: 'notification already in progress' };
      }

      tx.update(offerRef, { interestNotifyingSince: FieldValue.serverTimestamp() });
      return { proceed: true, offer: data };
    });

    if (!claim.proceed) {
      console.log(`notify-interest: skipped for offer ${offerId} (${claim.reason})`);
      return NextResponse.json(SKIPPED);
    }

    const offer = claim.offer;
    const propertySnap = await adminDb.collection('properties').doc(propertyId).get();
    if (!propertySnap.exists) {
      console.log(`notify-interest: skipped for offer ${offerId} (property ${propertyId} not found)`);
      await offerRef.update({ interestNotifyingSince: FieldValue.delete() });
      return NextResponse.json(SKIPPED);
    }
    const property = propertySnap.data();

    const agentUserId = property.userId;
    if (!agentUserId) {
      console.log(`notify-interest: skipped for offer ${offerId} (no owning agent on property ${propertyId})`);
      await offerRef.update({ interestNotifyingSince: FieldValue.delete() });
      return NextResponse.json(SKIPPED);
    }

    const userSnap = await adminDb.collection('users').doc(agentUserId).get();
    if (!userSnap.exists || !userSnap.data()?.email) {
      console.log(`notify-interest: skipped for offer ${offerId} (agent ${agentUserId} has no email on file)`);
      await offerRef.update({ interestNotifyingSince: FieldValue.delete() });
      return NextResponse.json(SKIPPED);
    }
    const agent = userSnap.data();

    if (!(await allowPropertyNotification(propertyId))) {
      console.log(`notify-interest: throttled for offer ${offerId} (property ${propertyId} reached ${NOTIFY_MAX_PER_HOUR}/hour)`);
      await offerRef.update({ interestNotifyingSince: FieldValue.delete() });
      return NextResponse.json(SKIPPED);
    }

    // showSuburbOnly controls what an anonymous BUYER sees on the public
    // property page — it has no bearing on what the agent who owns this
    // exact listing is shown in their own inbox. The agent already knows
    // the full address; hiding it here only made the notification less
    // useful, so this always resolves the fullest address available,
    // regardless of that flag.
    const propertyAddress =
      property.formattedAddress || property.address || property.location?.suburb || 'their property';

    await sendNewBuyerInterestEmail({
      agentEmail: agent.email,
      agentFirstName: agent.firstName,
      propertyAddress,
      propertyId,
      offerId,
      buyerName: offer.buyerName,
      buyerEmail: offer.buyerEmail,
      buyerPhone: offer.buyerPhone,
      nextAction: offer.nextAction,
      timeframe: offer.timeframe,
      buyerType: offer.buyerType,
      isFirstHomeBuyer: offer.isFirstHomeBuyer,
      isInvestor: offer.isInvestor,
    });

    // Only written once the send has genuinely resolved without
    // throwing — see sendEmail's own error-checking for why that's now
    // a meaningful guarantee rather than a given.
    await offerRef.update({
      interestNotifiedAt: FieldValue.serverTimestamp(),
      interestNotifyingSince: FieldValue.delete(),
    });

    console.log(`notify-interest: sent for offer ${offerId} to agent ${agentUserId} (property ${propertyId})`);
    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error('notify-interest error:', error);
    // Clear the claim so this isn't permanently stuck — the next
    // attempt (once whatever actually failed is fixed) can try again.
    if (offerRef) {
      await offerRef.update({ interestNotifyingSince: FieldValue.delete() }).catch((cleanupError) => {
        console.error('notify-interest: failed to clear stale claim:', cleanupError);
      });
    }
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
