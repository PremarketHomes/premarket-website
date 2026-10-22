import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { createBrand, setPersonalBrandOverride } from '../../services/brandProfileService';

/**
 * Saves branding for the AUTHENTICATED caller. This is the ONLY path
 * that may set users/{uid}.agencyBrandId or .brandColors — enforced
 * both here (Admin SDK) and in firestore.rules (neither field is in
 * the client update allowlist).
 *
 * One request shape, two outcomes, decided server-side by whether the
 * caller already has a shared brand linked — never by anything the
 * client asserts:
 *   - No agencyBrandId yet → this agent is the FIRST at this agency
 *     name: createBrand establishes the new shared default (or, if
 *     another agent's identical submission just won a creation race,
 *     silently joins that one instead — see createBrand's own
 *     comment). Every subsequent agent at the same exact name inherits
 *     this automatically, with no action from anyone.
 *   - agencyBrandId already set (inherited OR self-established) → this
 *     submission is always treated as a PERSONAL override only. It
 *     never touches the shared agencyBrands doc and never affects any
 *     other agent — see setPersonalBrandOverride.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { name, logoUrl, primary, secondary } = await request.json();

    const userDoc = await adminDb.collection('users').doc(auth.uid).get();
    const alreadyLinked = userDoc.exists ? userDoc.data()?.agencyBrandId : null;

    if (alreadyLinked) {
      // Personal override — logo and colour are independently optional
      // here (an agent may change just one), unlike establishing a
      // brand-new shared brand below, which always needs a colour.
      const result = await setPersonalBrandOverride({ uid: auth.uid, logoUrl, primary, secondary });
      return NextResponse.json({ success: true, personalOverride: true, ...result });
    }

    if (!primary) {
      return NextResponse.json({ error: 'A primary colour is required to establish new branding' }, { status: 400 });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Agency/office name is required' }, { status: 400 });
    }

    const result = await createBrand({ uid: auth.uid, name, logoUrl, primary, secondary });
    return NextResponse.json({ success: true, personalOverride: false, ...result });
  } catch (err) {
    console.error('Branding confirm error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save branding' }, { status: 500 });
  }
}
