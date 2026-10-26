import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../../../middleware/auth';
import { resolveBillingReview } from '../../../../../services/billingService';

/**
 * POST /api/admin/invoicing/charges/[chargeId]/resolve-review
 * Body: { assignTo: 'office' | 'independent', officeId?, reason }
 *
 * Resolves a charge held for billing review (an agent whose office
 * attribution became ambiguous — removed from an office, or their office
 * went inactive). Admin-only; nothing is invoiced by this call — the
 * charge simply becomes an ordinary pending charge on the chosen billing
 * entity, to be bundled and approved like any other.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { chargeId } = await params;
    const { assignTo, officeId, reason } = await request.json();
    if (!reason || !String(reason).trim()) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
    }
    const result = await resolveBillingReview({ chargeId, assignTo, officeId, adminUid: auth.uid, reason: String(reason).trim() });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Resolve billing review error:', err);
    return NextResponse.json({ error: err.message || 'Failed to resolve billing review' }, { status: err.status || 400 });
  }
}
