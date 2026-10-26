import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { getPropertyReportData } from '../../../services/propertyAccessService';

/**
 * GET /api/properties/[id]/report
 *
 * Everything the property report page needs for a listing the caller does not
 * own: property, offers, likes and buyer contact details. Used for an
 * office administrator viewing a member agent's listing (READ-ONLY — the
 * response says so via `readOnly`), and equally valid for a superAdmin or
 * the owner. Authorisation lives in propertyAccessService.getPropertyReportAccess.
 *
 * Read via the Admin SDK on purpose: the client Firestore rules for `offers`
 * stay exactly as strict as before.
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: propertyId } = await params;
    const result = await getPropertyReportData(adminDb, { uid: auth.uid, propertyId });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

    const { status, ...body } = result;
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('property report error:', error);
    return NextResponse.json({ error: 'Failed to load report' }, { status: 500 });
  }
}
