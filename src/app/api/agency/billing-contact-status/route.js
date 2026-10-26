import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { resolveBillingAccessForAgent, getBillingContactStatus } from '../../services/billingService';

/**
 * GET /api/agency/billing-contact-status
 *
 * Tells the AUTHENTICATED caller's own dashboard whether to show the
 * "Confirm Your Billing Details" prompt. The billing entity is
 * resolved server-side from auth.uid — never a client-supplied key —
 * via the exact same resolution a real charge uses (always their own
 * `agent:{uid}`), so this can never be pointed at another agent.
 *
 * Always applicable: every agent is their own independent billing
 * account under the UID-only model, so every agent sees this prompt
 * until their OWN billing contact is confirmed — never shared with,
 * or satisfied by, any other agent's confirmation, even one at the
 * same agency.
 *
 * Also the one read this agent's Account Settings "Billing Details"
 * section uses (see dashboard/settings/page.js) — so the full
 * confirmed billingName/name/email are included once status is
 * 'confirmed', plus `changeRequest` (pending/rejected amendment, if
 * any) so that page can show a pending/rejected edit ALONGSIDE the
 * still-fully-active confirmed contact, never in place of it.
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { entity, canManage } = await resolveBillingAccessForAgent(auth.uid);
    // Office agents are billed through their office, never individually:
    // only the office's administrators are asked for (or shown) its
    // billing details.
    if (!canManage) {
      return NextResponse.json({ applicable: false, officeBilling: true, billingEntityName: entity.billingEntityName });
    }
    const statusInfo = await getBillingContactStatus(entity.billingEntityKey);
    return NextResponse.json({
      applicable: true,
      billingEntityType: entity.billingEntityType,
      billingEntityName: entity.billingEntityName,
      status: statusInfo.status,
      billingName: statusInfo.billingName,
      name: statusInfo.name,
      email: statusInfo.email,
      proposedBillingName: statusInfo.proposedBillingName,
      proposedName: statusInfo.proposedName,
      proposedEmail: statusInfo.proposedEmail,
      rejectionReason: statusInfo.rejectionReason || null,
      changeRequest: statusInfo.changeRequest || null,
    });
  } catch (err) {
    console.error('Billing contact status error:', err);
    return NextResponse.json({ error: 'Failed to load billing contact status' }, { status: 500 });
  }
}
