import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';

/**
 * Lets an anonymous visitor read back their own, already-submitted price
 * opinion for a property so the widget can pre-fill it on a return visit
 * — the same behaviour the property page has always had. This used to be
 * a direct client-side Firestore query against `offers`, which required
 * that collection to be publicly readable; that made every buyer's name,
 * email, and phone number (stored on `offers` once they register
 * interest) readable by anyone. See
 * docs/security-finding-offers-public-read-pii.md.
 *
 * `offers` is no longer publicly readable (see firestore.rules), so this
 * lookup now happens server-side via the Admin SDK. It intentionally
 * returns only the offer id and amount — never buyerName/buyerEmail/
 * buyerPhone or any other field — regardless of what's on the document,
 * so this route can never become a new way to leak buyer PII.
 *
 * Scoped by (propertyId, sessionId): sessionId is a random per-tab
 * identifier the browser already generates (see getSessionId() in
 * PropertyPageClient.js) — anonymous, not tied to any real identity.
 */
export async function POST(req) {
  try {
    const { propertyId, sessionId } = await req.json();

    if (!propertyId || typeof propertyId !== 'string') {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 });
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const snap = await adminDb
      .collection('offers')
      .where('propertyId', '==', propertyId)
      .where('sessionId', '==', sessionId)
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ offerId: null, offerAmount: null });
    }

    const previous = snap.docs[0];
    return NextResponse.json({
      offerId: previous.id,
      offerAmount: previous.data().offerAmount ?? null,
    });
  } catch (error) {
    console.error('Offer session lookup error:', error);
    return NextResponse.json({ error: 'Failed to look up previous offer' }, { status: 500 });
  }
}
