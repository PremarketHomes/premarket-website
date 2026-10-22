import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../middleware/auth';
import { setBillingContact, listPendingBillingContacts } from '../../../services/billingService';

/**
 * GET /api/admin/invoicing/billing-contacts
 *
 * Every agency currently awaiting review — discoverable in the admin
 * invoicing area even before any invoice run exists, since a proposal
 * can arrive the moment an agent first sees their dashboard prompt.
 */
export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const pending = await listPendingBillingContacts();
    return NextResponse.json({ success: true, pending });
  } catch (err) {
    console.error('List pending billing contacts error:', err);
    return NextResponse.json({ error: 'Failed to list pending billing contacts' }, { status: 500 });
  }
}

/**
 * POST /api/admin/invoicing/billing-contacts
 * Body: { billingEntityKey, billingName, name, email, expectedVersion }
 *
 * Designates who an agency's invoice gets emailed to (name/email) and
 * what organisation name its Xero contact is created under
 * (billingName) — confirming an agent's prior proposal if one exists,
 * or setting it fresh with no proposal at all. Always wins over
 * whatever was proposed; this is the one and only way
 * billingContacts.status ever becomes 'confirmed'.
 *
 * `expectedVersion` is the version the admin UI loaded when it opened
 * this item for review (see listPendingBillingContacts) — passed
 * straight through so setBillingContact can refuse (409) a stale
 * approval if the agent has edited their request again since.
 *
 * The key is passed in the body (not a URL segment) because
 * billingEntityKey values (e.g. "agency:harcourts property hub")
 * contain characters that aren't safe as a raw path segment.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { billingEntityKey, billingName, name, email, expectedVersion } = await request.json();
    const result = await setBillingContact({ billingEntityKey, billingName, name, email, expectedVersion, adminUid: auth.uid });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Set billing contact error:', err);
    // Every error setBillingContact itself throws is either a
    // validation failure (missing key, malformed email) or a stale-
    // version conflict (409) — both client errors, never a server fault.
    return NextResponse.json({ error: err.message || 'Failed to set billing contact' }, { status: err.status || 400 });
  }
}
