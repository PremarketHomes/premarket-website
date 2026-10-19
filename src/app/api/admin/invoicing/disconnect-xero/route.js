import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../middleware/auth';
import { disconnectXero } from '../../../services/xeroService';

/**
 * POST /api/admin/invoicing/disconnect-xero
 *
 * The real disconnect — see xeroService.disconnectXero for exactly
 * what this does and why the previous "Disconnect" button (a PUT to
 * the generic settings endpoint with an empty body) never actually
 * disconnected anything. Only ever touches settings/xeroTokens —
 * never propertyCharges, invoiceRuns, or any billing setting — and
 * never calls createInvoice/sendInvoice, so disconnecting can't
 * itself trigger an invoice.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await disconnectXero();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Disconnect Xero error:', err);
    return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 });
  }
}
