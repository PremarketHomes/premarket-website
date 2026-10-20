import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAdmin } from '../../../middleware/auth';
import { buildAgencyInvoicePreview, buildTestInvoicePreviewEmail } from '../../../services/invoicePreviewService';

/**
 * GET /api/admin/invoicing/preview?email=agent@example.com
 *
 * Read-only, non-persisting invoice preview for a single agent's
 * account, by email. superAdmin-only (verifyAdmin) — this must never
 * be reachable without that check, since it reveals an agent's real
 * property list and computed charge amounts. Never writes
 * propertyCharges, invoiceRuns, or calls Xero — see
 * invoicePreviewService.js for why that's structurally guaranteed,
 * not just a convention followed here.
 */
export async function GET(request) {
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
    const preview = await buildAgencyInvoicePreview({ agentUserId });

    if (preview.propertyCount === 0) {
      return NextResponse.json({ error: 'This account has no properties to preview', preview }, { status: 400 });
    }

    const email_ = buildTestInvoicePreviewEmail(preview);

    return NextResponse.json({ preview, email: email_ });
  } catch (err) {
    console.error('Invoice preview error:', err);
    return NextResponse.json({ error: err.message || 'Failed to build preview' }, { status: 500 });
  }
}
