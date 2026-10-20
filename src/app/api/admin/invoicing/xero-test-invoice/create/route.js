import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../firebase/adminApp';
import { verifyAdmin } from '../../../../middleware/auth';
import { createXeroTestInvoice } from '../../../../services/xeroTestInvoiceService';

/**
 * POST /api/admin/invoicing/xero-test-invoice/create
 * Body: { email, confirm: true }
 *
 * The ONE real write this feature makes: a single DRAFT Xero invoice
 * for the dedicated "PREMARKET INVOICE TEST — Harcourts Property Hub
 * — DO NOT PAY" contact, using the given account's real properties as
 * line items. superAdmin-only. `confirm: true` is required or this
 * refuses before calling Xero at all. Unconditionally refuses if a
 * matching test invoice already exists — there is no override; the
 * existing draft must be deleted in Xero first if a genuinely fresh
 * one is ever needed.
 *
 * Never touches propertyCharges, invoiceRuns, invoiceRunItems, or
 * settings/invoicing.billingActivatedAt/cronEnabled — see
 * xeroTestInvoiceService.js for why that's structurally guaranteed.
 * Same XERO_DIAGNOSTIC_ENABLED gate as the existing Xero connection
 * diagnostic.
 */
export async function POST(request) {
  if (process.env.XERO_DIAGNOSTIC_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Xero diagnostic is disabled' }, { status: 404 });
  }

  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { email, confirm } = await request.json().catch(() => ({}));

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }
    if (confirm !== true) {
      return NextResponse.json({ error: 'confirm: true is required to create a real Xero invoice' }, { status: 400 });
    }

    const snap = await adminDb.collection('users').where('email', '==', email).limit(1).get();
    if (snap.empty) {
      return NextResponse.json({ error: 'No account found with that email' }, { status: 404 });
    }

    const agentUserId = snap.docs[0].id;
    const result = await createXeroTestInvoice({ agentUserId, confirm });

    return NextResponse.json(result);
  } catch (err) {
    console.error('Xero test invoice create error:', err);
    return NextResponse.json({ error: err.message || 'Failed to create the test invoice' }, { status: 500 });
  }
}
