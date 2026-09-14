import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { getBrandForUser, findBrandByExactName } from '../../services/brandProfileService';

/**
 * Returns the caller's current brand (if any), plus — only when they
 * don't yet have one — a suggested existing brand based on an EXACT
 * (not fuzzy) match against their own companyName. The suggestion is
 * never applied automatically; the dashboard shows it with an explicit
 * "Apply Branding" / "Not Now" choice.
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const brand = await getBrandForUser(auth.uid);
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
