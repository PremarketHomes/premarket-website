import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import {
  resolveBillingEntityForAgent,
  proposeBillingContact,
  proposeCompanyNameBillingContact,
  confirmIndependentBillingContact,
} from '../../services/billingService';

/**
 * POST /api/agency/propose-billing-contact
 * Body: { billingName, contactName, contactEmail }
 *
 * The one shared entry point for both the existing dashboard
 * "Confirm Your Agency's Billing Details" banner AND the new signup
 * form's billing-details section — same fields, same call, same
 * server-side resolution either way. The billing entity (which
 * agency, if any, this applies to) is always resolved from auth.uid
 * — never a client-supplied key — so a caller can only ever act on
 * their own, real identity. Three outcomes, in priority order:
 *
 *   1. billingEntityType 'agency' (a verified formal brand with no
 *      confirmed contact yet) — the existing single-claimant
 *      proposeBillingContact, unchanged. A formal brand's membership
 *      is already admin-vetted, so "first proposer holds the slot"
 *      is the right behaviour there.
 *   2. billingEntityType 'independent' with a pendingAgencyName (a
 *      company name that hasn't resolved to a confirmed entity yet —
 *      the common new-signup case) — proposeCompanyNameBillingContact,
 *      which allows multiple legitimate agents at the same new
 *      agency to each propose without colliding; a superAdmin
 *      resolves them together with one approval.
 *   3. Genuinely independent (no company name at all) — confirmed
 *      immediately, no admin review at all: this is the agent's own
 *      exclusive billing-contact key, so there is no one else they
 *      could possibly be confused with.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { billingName, contactName, contactEmail } = await request.json();

    const entity = await resolveBillingEntityForAgent(auth.uid);
    if (!entity) {
      return NextResponse.json({ error: 'Unable to resolve billing entity' }, { status: 400 });
    }

    if (entity.billingEntityType === 'agency') {
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
    }

    if (entity.pendingAgencyName) {
      const result = await proposeCompanyNameBillingContact({
        companyName: entity.pendingAgencyName,
        proposedBillingName: billingName,
        proposedName: contactName,
        proposedEmail: contactEmail,
        agentUserId: auth.uid,
      });
      return NextResponse.json({ success: true, ...result });
    }

    // Genuinely independent — their own exclusive key, confirmed
    // immediately, no review needed.
    const result = await confirmIndependentBillingContact({
      uid: auth.uid,
      billingName,
      contactName,
      contactEmail,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Propose billing contact error:', err);
    return NextResponse.json({ error: err.message || 'Failed to submit billing details' }, { status: err.status || 400 });
  }
}
