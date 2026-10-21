import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../../middleware/auth';
import { rejectBillingContact } from '../../../../services/billingService';

/**
 * POST /api/admin/invoicing/billing-contacts/reject
 * Body: { billingEntityKey, reason }
 *
 * Declines a pending proposal so the agency can submit a corrected
 * one. 409s (via rejectBillingContact) if there's no pending proposal
 * for this key any more — already approved, already rejected, or a
 * concurrent reject/approve won the race.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { billingEntityKey, reason } = await request.json();
    const result = await rejectBillingContact({ billingEntityKey, reason, adminUid: auth.uid });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Reject billing contact error:', err);
    return NextResponse.json({ error: err.message || 'Failed to reject billing contact' }, { status: err.status || 400 });
  }
}
