import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../middleware/auth';
import { requireOfficeAdmin } from '../../../services/officeService';
import { createBrand } from '../../../services/brandProfileService';

/**
 * POST /api/offices/{officeId}/branding
 * Body: { logoUrl, primary, secondary }
 * Office-admin only. Sets up (or re-establishes, if it collided with
 * an identically-named existing brand — see createBrand) the ONE
 * shared brand every member of this office inherits automatically.
 * Deliberately separate from /api/branding/confirm (the personal
 * page): that route only ever lets a caller affect their OWN account,
 * never the whole office's shared default — this one explicitly
 * targets the office doc instead.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { officeId } = await params;
    const office = await requireOfficeAdmin({ officeId, uid: auth.uid });

    const { logoUrl, primary, secondary } = await request.json();
    if (!primary) {
      return NextResponse.json({ error: 'A primary colour is required' }, { status: 400 });
    }

    const result = await createBrand({ uid: auth.uid, name: office.name, logoUrl, primary, secondary, officeId });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Office branding error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save office branding' }, { status: err.status || 500 });
  }
}
