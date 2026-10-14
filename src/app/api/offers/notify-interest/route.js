import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { sendNewBuyerInterestEmail } from '../../services/resendService';

/**
 * Fires once, right after a buyer successfully registers formal interest —
 * the one real-time signal an agent gets today beyond opening the property
 * dashboard themselves. The buyer's own registration has already been
 * saved by the time this is called (see PropertyPageClient.js's
 * handleContactSubmit, which calls this fire-and-forget and never lets a
 * failure here affect the buyer's own confirmation).
 *
 * Dedup is enforced here, server-side, inside a transaction — not by the
 * client only calling this once. A buyer can trigger this same request
 * more than once for the exact same registration: a double-click before
 * the submit button's own disabled state applies, a flaky connection
 * causing the client's fetch to retry, or simply reopening the form after
 * a page refresh and resubmitting unchanged details (savedOfferId is
 * restored from the session, so this hits the same offer doc again).
 * `interestNotifiedAt` is read-checked-and-set in one transaction so
 * whichever request gets there first is the only one that ever sends an
 * email, no matter how many times this route is called for the same
 * offer.
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
  try {
    const { offerId, propertyId } = await req.json();
    if (!offerId || !propertyId) {
      return NextResponse.json({ error: 'offerId and propertyId required' }, { status: 400 });
    }

    const offerRef = adminDb.collection('offers').doc(offerId);

    const claim = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(offerRef);
      if (!snap.exists) return { proceed: false, reason: 'offer not found' };

      const data = snap.data();
      if (data.propertyId !== propertyId) return { proceed: false, reason: 'propertyId mismatch' };
      if (data.serious !== true) return { proceed: false, reason: 'not a genuine registration' };
      if (data.interestNotifiedAt) return { proceed: false, reason: 'already notified' };

      tx.update(offerRef, { interestNotifiedAt: FieldValue.serverTimestamp() });
      return { proceed: true, offer: data };
    });

    if (!claim.proceed) {
      return NextResponse.json({ skipped: true, reason: claim.reason });
    }

    const offer = claim.offer;
    const propertySnap = await adminDb.collection('properties').doc(propertyId).get();
    if (!propertySnap.exists) {
      return NextResponse.json({ skipped: true, reason: 'property not found' });
    }
    const property = propertySnap.data();

    const agentUserId = property.userId;
    if (!agentUserId) {
      return NextResponse.json({ skipped: true, reason: 'no owning agent on this property' });
    }

    const userSnap = await adminDb.collection('users').doc(agentUserId).get();
    if (!userSnap.exists || !userSnap.data()?.email) {
      return NextResponse.json({ skipped: true, reason: 'agent has no email on file' });
    }
    const agent = userSnap.data();

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
      buyerName: offer.buyerName,
      buyerEmail: offer.buyerEmail,
      buyerPhone: offer.buyerPhone,
      nextAction: offer.nextAction,
      timeframe: offer.timeframe,
      buyerType: offer.buyerType,
      isFirstHomeBuyer: offer.isFirstHomeBuyer,
      isInvestor: offer.isInvestor,
    });

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error('notify-interest error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
