import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { resolveBillingEntityForAgent, proposeBillingContact } from '../../services/billingService';

/**
 * POST /api/agency/propose-billing-contact
 * Body: { billingName, contactName, contactEmail }
 *
 * Submits the AUTHENTICATED caller's agency billing details for
 * Premarket-admin review. The billing entity (which agency this
 * applies to) is resolved server-side from auth.uid — never a
 * client-supplied billingEntityKey — so an agent can only ever
 * propose details for their own, real agency. Rejected with 409 if
 * that agency's contact is already confirmed or already has a
 * proposal pending review — see proposeBillingContact's own comment.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { billingName, contactName, contactEmail } = await request.json();

    const entity = await resolveBillingEntityForAgent(auth.uid);
    if (!entity || entity.billingEntityType !== 'agency') {
      return NextResponse.json({ error: 'Not applicable for an independent agent' }, { status: 400 });
    }

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
