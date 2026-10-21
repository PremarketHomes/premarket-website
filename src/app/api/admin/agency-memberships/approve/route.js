import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../middleware/auth';
import { approveAgencyMembership } from '../../../services/brandProfileService';

/**
 * POST /api/admin/agency-memberships/approve
 * Body: { uid }
 *
 * The one and only way agencyMemberships.status ever becomes
 * 'verified' for a non-creator — see approveAgencyMembership's own
 * comment for the "legacy link" case (no membership doc exists yet).
 * Branding only: this never affects billing, charges, or Xero
 * recipient resolution, which always key purely off the agent's own
 * Firebase UID (see billingService.js) — never agencyBrandId.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { uid } = await request.json();
    if (!uid) {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }

    const result = await approveAgencyMembership({ uid, adminUid: auth.uid });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Approve agency membership error:', err);
    return NextResponse.json({ error: err.message || 'Failed to approve agency membership' }, { status: 400 });
  }
}
