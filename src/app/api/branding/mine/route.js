import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { getBrandForUser, autoEstablishBrandForUser } from '../../services/brandProfileService';

/**
 * Returns the caller's current branding: their inherited/established
 * shared brand (if any) and their own personal logo/colour override
 * (if any) — the client layers these with the exact same precedence
 * computeEffectiveColors/computeDisplayLogoUrl (brandStyle.js) use for
 * the real public property page, so the dashboard's branding page
 * always shows the truth.
 *
 * If the caller doesn't have a shared brand yet, this first tries to
 * automatically establish or join one — see autoEstablishBrandForUser
 * for exactly what that does (join on an exact company-name match, or
 * create one from their own already-uploaded logo when extraction is
 * confident). This is what makes branding apply with zero setup: simply
 * loading the dashboard (or signing up — see join/page.js's own
 * non-blocking call to this route) is enough.
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
      if (autoResult.status === 'created' || autoResult.status === 'joined') {
        brand = await getBrandForUser(auth.uid);
      }
    }

    const userDoc = await adminDb.collection('users').doc(auth.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    return NextResponse.json({
      brand,
      personalOverride: {
        logoUrl: userData.logoUrl || null,
        colors: userData.brandColors || null,
      },
    });
  } catch (err) {
    console.error('Branding lookup error:', err);
    return NextResponse.json({ error: 'Failed to load branding' }, { status: 500 });
  }
}
