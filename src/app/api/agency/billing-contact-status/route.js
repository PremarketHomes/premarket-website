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
 * applicable is true in two cases:
 *   - billingEntityType 'agency' (a verified formal brand OR an
 *     already-confirmed company-name entity) with status !== 'confirmed'
 *     — practically this means "confirmed but we're asked anyway",
 *     which getBillingContactStatus already reports correctly.
 *   - billingEntityType 'independent' with a pendingAgencyName —
 *     they gave a company name that hasn't resolved to either
 *     confirmed path yet. This is now the common case for a new
 *     agent who just signed up with an agency name.
 * Returns { applicable: false } for a genuinely independent agent
 * with no company name at all — they have nothing agency-level to
 * confirm here (see /api/agency/propose-billing-contact for their
 * own, separate, always-safe billing-email path).
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const entity = await resolveBillingEntityForAgent(auth.uid);
    if (!entity) {
      return NextResponse.json({ applicable: false });
    }

    if (entity.billingEntityType === 'agency') {
      const statusInfo = await getBillingContactStatus(entity.billingEntityKey);
      return NextResponse.json({
        applicable: true,
        billingEntityName: entity.billingEntityName,
        status: statusInfo.status,
        rejectionReason: statusInfo.rejectionReason || null,
      });
    }

    if (entity.pendingAgencyName) {
      const normalized = entity.pendingAgencyName.trim().toLowerCase();
      const statusInfo = await getBillingContactStatus(`agency:${normalized}`);
      return NextResponse.json({
        applicable: true,
        billingEntityName: entity.pendingAgencyName,
        status: statusInfo.status,
        rejectionReason: statusInfo.rejectionReason || null,
      });
    }

    return NextResponse.json({ applicable: false });
  } catch (err) {
    console.error('Billing contact status error:', err);
    return NextResponse.json({ error: 'Failed to load billing contact status' }, { status: 500 });
  }
}
