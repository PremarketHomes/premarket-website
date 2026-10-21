import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../middleware/auth';
import { rejectAgencyMembership } from '../../../services/brandProfileService';

/**
 * POST /api/admin/agency-memberships/reject
 * Body: { uid, reason }
 *
 * Declines a pending request or an unreviewed legacy link. Also
 * clears the account's own agencyBrandId (see rejectAgencyMembership)
 * — if they're confirmed not a member, they shouldn't keep displaying
 * that agency's branding either. Never touches any already-recorded
 * charge or billing record.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { uid, reason } = await request.json();
    if (!uid) {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }

    const result = await rejectAgencyMembership({ uid, adminUid: auth.uid, reason });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Reject agency membership error:', err);
    return NextResponse.json({ error: err.message || 'Failed to reject agency membership' }, { status: 400 });
  }
}
