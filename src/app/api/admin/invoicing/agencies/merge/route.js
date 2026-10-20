import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../../middleware/auth';
import { mergeIntoBillingEntity } from '../../../../services/billingService';

/**
 * POST /api/admin/invoicing/agencies/merge
 * Body: { agentUserIds, targetBillingEntityKey, targetBillingEntityName, reason }
 *
 * The "yes, these are actually the same agency" confirmation step for
 * a pair surfaced by GET /api/admin/invoicing/agencies. Only ever
 * writes billingAgencyOverrides — never touches agencyBrandId,
 * agencyBrands, or any existing charge's own billing entity (financial
 * history and branding assignments are both left exactly as they
 * were).
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { agentUserIds, targetBillingEntityKey, targetBillingEntityName, reason } = await request.json();

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
    }

    const result = await mergeIntoBillingEntity({
      agentUserIds,
      targetBillingEntityKey,
      targetBillingEntityName,
      adminUid: auth.uid,
      reason: reason.trim(),
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Merge billing entity error:', err);
    return NextResponse.json({ error: err.message || 'Failed to merge agencies' }, { status: 500 });
  }
}
