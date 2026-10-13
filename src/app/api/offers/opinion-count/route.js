import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';

/**
 * Returns how many price opinions exist for a property — nothing else.
 * Used only to give a buyer a genuine, non-fabricated participation
 * signal right after they submit their own opinion ("You're the Nth
 * person to share a valuation on this property").
 *
 * Deliberately returns a count only, never the opinions themselves or
 * anything derived from their values:
 *   - No average, median or range. An aggregate price shown back to a
 *     buyer at the moment they're forming their own opinion would anchor
 *     every subsequent submission on it — the same independence problem
 *     this feature exists to protect.
 *   - No "within/outside the vendor's expected range" signal. That would
 *     leak the vendor's confidential range through nothing more than
 *     repeated probing — a buyer could resubmit at different values and
 *     binary-search their way to the vendor's exact private boundaries.
 *   - No buyer identity, amounts, or any other field from `offers` — see
 *     docs/security-finding-offers-public-read-pii.md. This route reads
 *     via the Admin SDK (bypasses the now-private `offers` rule) and
 *     returns only an integer.
 *
 * `offers` has no composite index on (propertyId, type) today — a
 * single-field `where('propertyId', ...)` filter with a client-side
 * type check avoids requiring a new index for this one additive route.
 */
export async function GET(req) {
  try {
    const propertyId = new URL(req.url).searchParams.get('propertyId');
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 });
    }

    const snap = await adminDb.collection('offers').where('propertyId', '==', propertyId).get();
    const count = snap.docs.filter((d) => d.data().type === 'opinion').length;

    return NextResponse.json({ count });
  } catch (error) {
    console.error('Opinion count error:', error);
    return NextResponse.json({ error: 'Failed to load opinion count' }, { status: 500 });
  }
}
