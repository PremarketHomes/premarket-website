import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { getBuyerProfilesForProperty } from '../../../services/publicProfileService';

/**
 * GET /api/properties/[id]/buyer-profiles
 *
 * Used by the agent's property report to resolve the contact details and
 * preferences of buyers who registered serious interest. Replaces direct
 * client reads of other users' `users/{uid}` documents. Only the listing's
 * agent (or a superAdmin) may call it.
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: propertyId } = await params;
    const result = await getBuyerProfilesForProperty(adminDb, { uid: auth.uid, propertyId });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ buyers: result.buyers });
  } catch (error) {
    console.error('buyer-profiles error:', error);
    return NextResponse.json({ error: 'Failed to load buyer profiles' }, { status: 500 });
  }
}
