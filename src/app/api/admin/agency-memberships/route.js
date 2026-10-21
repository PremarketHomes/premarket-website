import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../middleware/auth';
import { listPendingAgencyMemberships } from '../../services/brandProfileService';
import { countHeldChargesForAgent } from '../../services/billingService';

/**
 * GET /api/admin/agency-memberships
 *
 * Every account needing a membership decision — explicit requests
 * (requestAgencyMembership) AND "legacy" agencyBrandId links that
 * predate this system and have no membership record at all (see
 * listPendingAgencyMemberships). Nothing is written by this route;
 * it's purely the discovery surface for approve/reject below.
 *
 * Each entry also carries heldChargeCount — how many of that agent's
 * own charges are currently sitting isolated, excluded from every
 * invoice run, because their membership is unresolved (see
 * invoiceRunService.js's pendingAgencyName filter) — so an admin can
 * see at a glance whether resolving this is urgent.
 */
export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const pending = await listPendingAgencyMemberships();
    const withCounts = await Promise.all(
      pending.map(async (entry) => ({
        ...entry,
        heldChargeCount: await countHeldChargesForAgent(entry.uid),
      }))
    );
    return NextResponse.json({ success: true, pending: withCounts });
  } catch (err) {
    console.error('List pending agency memberships error:', err);
    return NextResponse.json({ error: 'Failed to list pending agency memberships' }, { status: 500 });
  }
}
