import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../middleware/auth';
import { setBillingContact } from '../../../services/billingService';

/**
 * POST /api/admin/invoicing/billing-contacts
 * Body: { billingEntityKey, name, email }
 *
 * Designates who an agency's consolidated invoice gets emailed to.
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

    const { billingEntityKey, name, email } = await request.json();
    const result = await setBillingContact({ billingEntityKey, name, email, adminUid: auth.uid });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Set billing contact error:', err);
    // Every error setBillingContact itself throws is a validation
    // failure (missing key, malformed email) — a client error, not a
    // server fault.
    return NextResponse.json({ error: err.message || 'Failed to set billing contact' }, { status: 400 });
  }
}
