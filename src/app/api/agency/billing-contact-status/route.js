import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { resolveBillingEntityForAgent, getBillingContactStatus } from '../../services/billingService';

/**
 * GET /api/agency/billing-contact-status
 *
 * Tells the AUTHENTICATED caller's own dashboard whether to show the
 * "Confirm Your Agency's Billing Details" prompt. The billing entity
 * is resolved server-side from auth.uid — never a client-supplied
 * key — via the exact same resolution a real charge uses, so this can
 * never be pointed at another agency.
 *
 * Returns { applicable: false } for independent agents (no company) —
 * their own identity is already the correct billing contact, so they
 * never see this prompt at all.
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const entity = await resolveBillingEntityForAgent(auth.uid);
    if (!entity || entity.billingEntityType !== 'agency') {
      return NextResponse.json({ applicable: false });
    }

    const statusInfo = await getBillingContactStatus(entity.billingEntityKey);

    return NextResponse.json({
      applicable: true,
      billingEntityName: entity.billingEntityName,
      status: statusInfo.status,
      rejectionReason: statusInfo.rejectionReason || null,
    });
  } catch (err) {
    console.error('Billing contact status error:', err);
    return NextResponse.json({ error: 'Failed to load billing contact status' }, { status: 500 });
  }
}
