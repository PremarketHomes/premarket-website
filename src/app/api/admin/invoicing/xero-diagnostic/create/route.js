import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../../middleware/auth';
import { isXeroConnected, findOrCreateContact, createInvoice } from '../../../../services/xeroService';
import { adminDb } from '../../../../../firebase/adminApp';
import { TEST_CONTACT_NAME, TEST_CONTACT_EMAIL, TEST_REFERENCE, TEST_DESCRIPTION } from '../constants';

/**
 * POST /api/admin/invoicing/xero-diagnostic/create
 * Body: { confirm: true }
 *
 * The ONE real write this diagnostic ever makes: one $200 GST-free
 * invoice, for a dedicated test contact, in the connected Xero org —
 * created as Status: 'DRAFT' and NEVER followed by a call to
 * sendInvoice. Xero only emails on that separate, explicit send step
 * (see xeroService.sendInvoice) or once an invoice is AUTHORISED and
 * manually/automatically sent from within Xero itself — a DRAFT this
 * route never authorises stays exactly that, invisible to the
 * contact, until a human in Xero decides otherwise.
 *
 * Never touches propertyCharges, invoiceRuns, invoiceRunItems, or
 * settings/invoicing.billingActivatedAt — this is intentionally
 * disconnected from the real billing pipeline entirely, so it carries
 * none of that pipeline's side effects.
 *
 * `confirm: true` must be present in the request body or this refuses
 * outright, before calling Xero at all — enforced here server-side,
 * not just as a client-side dialog that could be skipped by calling
 * the API directly.
 *
 * Same XERO_DIAGNOSTIC_ENABLED gate as preview/route.js — see that
 * file's comment for how to disable/remove this after testing.
 */
export async function POST(request) {
  if (process.env.XERO_DIAGNOSTIC_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Xero diagnostic is disabled' }, { status: 404 });
  }

  const auth = await verifyAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { confirm } = await request.json().catch(() => ({}));
    if (confirm !== true) {
      return NextResponse.json({ error: 'confirm: true is required to create a real Xero invoice' }, { status: 400 });
    }

    if (!(await isXeroConnected())) {
      return NextResponse.json({ error: 'Xero is not connected' }, { status: 400 });
    }

    const settingsDoc = await adminDb.collection('settings').doc('invoicing').get();
    const accountCode = (settingsDoc.exists ? settingsDoc.data().xeroAccountCode : null) || '200';

    const contact = await findOrCreateContact({
      name: TEST_CONTACT_NAME,
      email: TEST_CONTACT_EMAIL,
      firstName: 'Premarket',
      lastName: 'Diagnostic Test',
    });
    if (!contact?.ContactID) {
      throw new Error('Failed to create the Xero test contact');
    }

    const invoice = await createInvoice({
      contactId: contact.ContactID,
      lineItems: [{ description: TEST_DESCRIPTION, quantity: 1, unitAmount: 200, taxType: 'NONE' }],
      reference: TEST_REFERENCE,
      accountCode, // the same configured code preview/route.js already confirmed exists
      status: 'DRAFT', // never authorised — see this file's own comment above
    });

    if (!invoice?.InvoiceID) {
      throw new Error('Xero did not return an invoice');
    }

    // Deliberately no call to sendInvoice() — this is the entire point.

    return NextResponse.json({
      success: true,
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoice.InvoiceNumber || null,
      status: invoice.Status,
      contactId: contact.ContactID,
      message: 'Created as a DRAFT in Xero. It was never authorised or emailed. Review and delete it directly in Xero when you\'re done.',
    });
  } catch (err) {
    console.error('Xero diagnostic create error:', err);
    return NextResponse.json({ error: err.message || 'Failed to create the test invoice' }, { status: 500 });
  }
}
