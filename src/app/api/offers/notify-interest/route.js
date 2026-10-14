import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { sendNewBuyerInterestEmail } from '../../services/resendService';

/**
 * Fires once, right after a buyer successfully registers formal interest —
 * the one real-time signal an agent gets today beyond opening the property
 * dashboard themselves. Everything here is best-effort: the buyer's own
 * registration has already been saved by the time this is called, so a
 * failure here (missing agent email, Resend hiccup, etc.) is logged and
 * swallowed rather than surfaced back to the buyer, who has nothing to
 * retry — see PropertyPageClient.js's handleContactSubmit, which calls this
 * fire-and-forget and never lets it affect the buyer's own confirmation.
 *
 * Reads via the Admin SDK (bypasses the now-private `offers`/`users` rules
 * by design — this is a server-only route, never called with a client
 * session) so it can resolve the owning agent's email itself rather than
 * trusting whatever the client happened to send.
 */
export async function POST(req) {
  try {
    const { offerId, propertyId } = await req.json();
    if (!offerId || !propertyId) {
      return NextResponse.json({ error: 'offerId and propertyId required' }, { status: 400 });
    }

    const [offerSnap, propertySnap] = await Promise.all([
      adminDb.collection('offers').doc(offerId).get(),
      adminDb.collection('properties').doc(propertyId).get(),
    ]);

    if (!offerSnap.exists || !propertySnap.exists) {
      return NextResponse.json({ skipped: true, reason: 'offer or property not found' });
    }

    const offer = offerSnap.data();
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

    const propertyAddress = property.showSuburbOnly
      ? (property.address || property.location?.suburb || 'their property')
      : (property.formattedAddress || property.address || 'their property');

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
    });

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error('notify-interest error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
