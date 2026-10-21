import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { resolveBillingEntityForAgent, proposeBillingContact } from '../../services/billingService';

/**
 * POST /api/agency/propose-billing-contact
 * Body: { billingName, contactName, contactEmail }
 *
 * The one shared entry point for both the existing dashboard
 * "Confirm Your Billing Details" banner AND the signup form's
 * billing-details section — same fields, same call, same server-side
 * resolution either way. The billing entity is always resolved from
 * auth.uid — never a client-supplied key — so a caller can only ever
 * act on their own, real identity: always their own exclusive
 * `agent:{uid}`, never shared with any other agent regardless of
 * agency name, branding, or billing email.
 *
 * Always files a pending proposal awaiting one superAdmin review —
 * there is no instant self-confirm path for any agent any more (the
 * old "genuinely independent agents confirm immediately" shortcut is
 * removed): every agent, solo or at a large agency, goes through the
 * same one approval queue, per the simplified admin model.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { billingName, contactName, contactEmail } = await request.json();

    const entity = await resolveBillingEntityForAgent(auth.uid);
    const result = await proposeBillingContact({
      billingEntityKey: entity.billingEntityKey,
      billingEntityType: entity.billingEntityType,
      billingEntityName: entity.billingEntityName,
      proposedBillingName: billingName,
      proposedName: contactName,
      proposedEmail: contactEmail,
      agentUserId: auth.uid,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Propose billing contact error:', err);
    return NextResponse.json({ error: err.message || 'Failed to submit billing details' }, { status: err.status || 400 });
  }
}
