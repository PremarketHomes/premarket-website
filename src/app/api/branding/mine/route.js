import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { getBrandForUser, findBrandByExactName, autoEstablishBrandForUser } from '../../services/brandProfileService';

/**
 * Returns the caller's current brand (if any).
 *
 * If they don't have one yet but already have a logo + company name on
 * file, this first tries to automatically establish (or join) their
 * agency brand — see autoEstablishBrandForUser for exactly what that
 * does and doesn't do. This is what makes branding apply for existing
 * accounts without a separate login/approval step: simply loading the
 * dashboard (which calls this route) is enough.
 *
 * Only when auto-establishing wasn't possible (no logo, or extraction
 * wasn't confident) does this fall back to the older manual-suggestion
 * behaviour: a suggested existing brand based on an EXACT (not fuzzy)
 * match against their companyName, which the dashboard still offers
 * with an explicit "Apply Branding" / "Not Now" choice.
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let brand = await getBrandForUser(auth.uid);

    if (!brand) {
      const autoResult = await autoEstablishBrandForUser(auth.uid);
      if (autoResult.status === 'created' || autoResult.status === 'linked') {
        brand = await getBrandForUser(auth.uid);
      }
    }

    if (brand) {
      return NextResponse.json({ brand, suggestion: null });
    }

    const userDoc = await adminDb.collection('users').doc(auth.uid).get();
    const companyName = userDoc.exists ? userDoc.data()?.companyName : null;
    const suggestion = companyName ? await findBrandByExactName(companyName) : null;

    return NextResponse.json({ brand: null, suggestion });
  } catch (err) {
    console.error('Branding lookup error:', err);
    return NextResponse.json({ error: 'Failed to load branding' }, { status: 500 });
  }
}
