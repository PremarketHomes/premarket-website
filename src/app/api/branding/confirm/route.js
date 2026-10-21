import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { createBrand, requestAgencyMembership } from '../../services/brandProfileService';

/**
 * Saves a brand profile, or requests to join an existing one. This is
 * the ONLY path that may set users/{uid}.agencyBrandId — enforced both
 * here (Admin SDK) and in firestore.rules (client can't set it
 * directly). Two modes:
 *   - { brandId } — request to join an already-existing brand (e.g. a
 *     second agent at the same Harcourts office confirming the
 *     suggested match). Applies branding immediately; billing/charges/
 *     billing-contact proposals stay unaffected until a superAdmin
 *     approves the request — see requestAgencyMembership.
 *   - { name, logoUrl, primary, secondary } — create a new brand from a
 *     freshly extracted/adjusted palette. The creator is trusted for
 *     billing immediately — there's nothing to verify against yet.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();

    if (body.brandId) {
      const result = await requestAgencyMembership({ uid: auth.uid, brandId: body.brandId });
      return NextResponse.json({ success: true, ...result });
    }

    const { name, logoUrl, primary, secondary } = body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Agency/office name is required' }, { status: 400 });
    }

    const result = await createBrand({ uid: auth.uid, name, logoUrl, primary, secondary });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Branding confirm error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save branding' }, { status: 500 });
  }
}
