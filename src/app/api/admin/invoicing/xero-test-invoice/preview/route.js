import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../firebase/adminApp';
import { verifyAdmin } from '../../../../middleware/auth';
import { previewXeroTestInvoice } from '../../../../services/xeroTestInvoiceService';

/**
 * GET /api/admin/invoicing/xero-test-invoice/preview?email=...
 *
 * Read-only. Builds exactly what the create step below would send to
 * Xero — including whether a matching test invoice already exists —
 * without creating anything. superAdmin-only. Same
 * XERO_DIAGNOSTIC_ENABLED gate as the existing Xero connection
 * diagnostic, since this is the same class of one-off, removable
 * test tooling.
 */
export async function GET(request) {
  if (process.env.XERO_DIAGNOSTIC_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Xero diagnostic is disabled' }, { status: 404 });
  }

  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    if (!email) {
      return NextResponse.json({ error: 'email query parameter is required' }, { status: 400 });
    }

    const snap = await adminDb.collection('users').where('email', '==', email).limit(1).get();
    if (snap.empty) {
      return NextResponse.json({ error: 'No account found with that email' }, { status: 404 });
    }

    const agentUserId = snap.docs[0].id;
    const result = await previewXeroTestInvoice({ agentUserId });

    return NextResponse.json(result);
  } catch (err) {
    console.error('Xero test invoice preview error:', err);
    return NextResponse.json({ error: err.message || 'Failed to build preview' }, { status: 500 });
  }
}
