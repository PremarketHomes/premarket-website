import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../../middleware/auth';
import { excludeCharge, reverseCharge } from '../../../../services/billingService';

/**
 * POST /api/admin/invoicing/charges/[chargeId]
 * Body: { action: 'exclude' | 'reverse', reason }
 *
 * The admin-adjustment mechanism — never deletes a charge, only ever
 * flags it (excludeCharge/reverseCharge in billingService.js both
 * record who/when/why on the charge itself and preserve it forever).
 * 'exclude' is for a charge that hasn't been invoiced yet (an accident
 * caught before it ever reached Xero); 'reverse' is for one that has
 * already been invoiced, which also flags requiresCreditNote so the
 * accounting record is corrected in Xero rather than just locally.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { chargeId } = await params;
    const { action, reason } = await request.json();

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
    }

    if (action === 'exclude') {
      const result = await excludeCharge({ chargeId, adminUid: auth.uid, reason: reason.trim() });
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'reverse') {
      const result = await reverseCharge({ chargeId, adminUid: auth.uid, reason: reason.trim() });
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ error: 'Invalid action — must be "exclude" or "reverse"' }, { status: 400 });
  } catch (err) {
    console.error('Charge adjustment error:', err);
    return NextResponse.json({ error: err.message || 'Failed to adjust charge' }, { status: 500 });
  }
}
