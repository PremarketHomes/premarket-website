import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../middleware/auth';
import { listPendingAgencyMemberships } from '../../services/brandProfileService';

/**
 * GET /api/admin/agency-memberships
 *
 * Every account needing a membership decision — explicit requests
 * (requestAgencyMembership) AND "legacy" agencyBrandId links that
 * predate this system and have no membership record at all (see
 * listPendingAgencyMemberships). Nothing is written by this route;
 * it's purely the discovery surface for approve/reject below.
 *
 * Branding only: approving or rejecting here affects agencyBrandId
 * (visual branding/logo display) and nothing else — it has no effect
 * on billing, charges, or invoicing, which are always resolved purely
 * from the agent's own Firebase UID (see billingService.js).
 */
export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const pending = await listPendingAgencyMemberships();
    return NextResponse.json({ success: true, pending });
  } catch (err) {
    console.error('List pending agency memberships error:', err);
    return NextResponse.json({ error: 'Failed to list pending agency memberships' }, { status: 500 });
  }
}
