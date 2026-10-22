import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../middleware/auth';
import { requireOfficeAdmin } from '../../../services/officeService';
import { saveOfficeBrand } from '../../../services/brandProfileService';

/**
 * POST /api/offices/{officeId}/branding
 * Body: { logoUrl, primary, secondary }
 * Office-admin only. Creates (the first time) or updates (every time
 * after) the ONE dedicated, office-owned brand every member of this
 * office inherits automatically — see saveOfficeBrand, which is keyed
 * by officeId specifically so it can never collide with (or silently
 * discard its own submission into) an unrelated agent's or another
 * office's brand just because they happen to share an agency name.
 * Deliberately separate from /api/branding/confirm (the personal
 * page): that route only ever lets a caller affect their OWN account,
 * never the whole office's shared default — this one explicitly
 * targets the office's own brand instead, and only an office admin
 * (verified by requireOfficeAdmin, never the client) can reach it.
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

    const result = await saveOfficeBrand({ officeId, officeName: office.name, logoUrl, primary, secondary });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Office branding error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save office branding' }, { status: err.status || 500 });
  }
}
