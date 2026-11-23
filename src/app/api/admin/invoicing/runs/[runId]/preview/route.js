import { NextResponse } from 'next/server';
import { randomUUID, createHash } from 'crypto';
import { adminDb } from '../../../../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
// Deliberately NOT imported: sendInvoice (emailing). Nothing here can email anyone, and
// every invoice this route creates or changes is a DRAFT (status is passed explicitly).
import {
  createInvoice,
  updateDraftInvoice,
  getInvoicePdf,
  getOrganisation,
  isXeroConnected,
} from '../../../../../services/xeroService';
import { resolveBillingContact } from '../../../../../services/billingService';
import { buildRunItemInvoice, findExistingRunItemInvoice } from '../../../../../services/runItemInvoice';
import { verifyAdmin } from '../../../../../middleware/auth';

/**
 * Invoice preview: the real Xero invoice for one run item, saved in Xero as a DRAFT so it can
 * be reviewed exactly as Xero renders it (the organisation's own branding theme, legal
 * details, payment terms and bank details) before anything is approved or emailed.
 *
 *   POST /api/admin/invoicing/runs/[runId]/preview   Body: { itemId, confirm: true }
 *     Creates the draft, or refreshes the existing one, from the run exactly as Send would
 *     build it (services/runItemInvoice.js). Returns a summary.
 *   GET  /api/admin/invoicing/runs/[runId]/preview?itemId=...
 *     The draft's PDF, rendered by Xero.
 *
 * A DRAFT is not approved, not emailed, not payable and not in Xero's reports. Nothing is
 * emailed by this route. Nothing about the run, its charges or its status changes. When the
 * run is later sent, Send approves this same draft (keeping its invoice number) instead of
 * creating a second invoice. Cancelling or deleting the run deletes the draft.
 *
 * superAdmin only; the POST needs confirm: true; only a draft or approved run, and only an item
 * that has no real Xero invoice yet.
 */

const PREVIEWABLE_RUN_STATUSES = ['draft', 'approved'];
const CLAIM_MS = 2 * 60 * 1000; // a preview in progress blocks a second one for up to 2 minutes

async function loadRunAndItem(runId, itemId) {
  if (!itemId) return { error: 'itemId is required', status: 400 };
  const runDoc = await adminDb.collection('invoiceRuns').doc(runId).get();
  if (!runDoc.exists) return { error: 'Run not found', status: 404 };
  const itemRef = adminDb.collection('invoiceRunItems').doc(itemId);
  const itemDoc = await itemRef.get();
  if (!itemDoc.exists) return { error: 'Item not found', status: 404 };
  const item = itemDoc.data();
  if (item.runId !== runId) return { error: 'Item does not belong to this run', status: 400 };
  return { runData: runDoc.data(), itemRef, item };
}

function xeroDeepLink(shortCode, invoiceId) {
  if (!shortCode || !invoiceId) return null;
  return `https://go.xero.com/organisationlogin/default.aspx?shortcode=${encodeURIComponent(shortCode)}&redirecturl=/AccountsReceivable/Edit.aspx?InvoiceID=${encodeURIComponent(invoiceId)}`;
}

export async function POST(request, { params }) {
  const auth = await verifyAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { runId } = await params;
  const { itemId, confirm } = await request.json().catch(() => ({}));
  if (confirm !== true) {
    return NextResponse.json({ error: 'confirm: true is required to create the draft invoice in Xero' }, { status: 400 });
  }

  const loaded = await loadRunAndItem(runId, itemId);
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { runData, itemRef, item } = loaded;

  if (!PREVIEWABLE_RUN_STATUSES.includes(runData.status)) {
    return NextResponse.json({ error: `Only a draft or approved run can be previewed (this run is ${runData.status})` }, { status: 400 });
  }
  if (item.xeroInvoiceId) {
    return NextResponse.json({ error: 'This invoice has already been created in Xero; there is nothing to preview' }, { status: 400 });
  }
  if (!(await isXeroConnected())) {
    return NextResponse.json({ error: 'Xero is not connected' }, { status: 400 });
  }
  const confirmed = await resolveBillingContact(item.billingEntityKey);
  if (!confirmed) {
    return NextResponse.json({ error: 'Billing details required: this agency has no confirmed billing contact' }, { status: 400 });
  }

  // One preview at a time per item, so a double-click can never create two drafts.
  const claim = randomUUID();
  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(itemRef);
      const startedAt = snap.data()?.previewInProgressAt;
      const startedMs = startedAt?.toMillis?.() ?? (startedAt ? new Date(startedAt).getTime() : null);
      if (startedMs && Date.now() - startedMs < CLAIM_MS) {
        throw Object.assign(new Error('A preview of this invoice is already being prepared'), { status: 409 });
      }
      tx.update(itemRef, { previewInProgressAt: new Date(), previewClaim: claim });
    });
  } catch (err) {
    if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  try {
    const settingsDoc = await adminDb.collection('settings').doc('invoicing').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};

    const { contact, lineItems, reference, accountCode, date, dueDate, paymentTermsDays } = await buildRunItemInvoice({
      itemId, item, runData, confirmed, settings,
    });

    const { draft, existing } = await findExistingRunItemInvoice({ item, reference });
    if (existing) {
      // A real (approved, paid or voided) invoice already carries this item's reference.
      // Never touch it from a preview.
      await itemRef.update({ previewInProgressAt: null, previewClaim: null });
      return NextResponse.json({
        error: `Xero already has invoice ${existing.InvoiceNumber || existing.InvoiceID} (${existing.Status}) for this run item, so no preview was made. Nothing was changed.`,
      }, { status: 409 });
    }

    const payload = { contactId: contact.ContactID, lineItems, reference, date, dueDate, accountCode, status: 'DRAFT' };
    const idempotencyKey = createHash('sha256').update(`premarket-invoice-preview:${itemId}:${claim}`).digest('hex');
    const invoice = draft
      ? await updateDraftInvoice({ invoiceId: draft.InvoiceID, ...payload, idempotencyKey })
      : await createInvoice({ ...payload, idempotencyKey });

    if (!invoice?.InvoiceID) throw new Error('Xero did not return the draft invoice');
    if (invoice.Status !== 'DRAFT') {
      // Defence in depth: this route only ever asks for DRAFT.
      throw new Error(`Xero returned the preview invoice with status ${invoice.Status} instead of DRAFT`);
    }

    let xeroUrl = null;
    try {
      xeroUrl = xeroDeepLink((await getOrganisation())?.ShortCode, invoice.InvoiceID);
    } catch { /* the link is a convenience only */ }

    await itemRef.update({
      previewXeroInvoiceId: invoice.InvoiceID,
      previewXeroInvoiceNumber: invoice.InvoiceNumber || null,
      previewXeroContactId: contact.ContactID,
      previewXeroUrl: xeroUrl,
      previewTotal: typeof invoice.Total === 'number' ? invoice.Total : null,
      previewLineCount: lineItems.length,
      previewDate: date,
      previewDueDate: dueDate,
      previewedAt: FieldValue.serverTimestamp(),
      previewedBy: auth.uid,
      previewInProgressAt: null,
      previewClaim: null,
    });

    return NextResponse.json({
      success: true,
      created: !draft,
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoice.InvoiceNumber || null,
      status: invoice.Status,
      contactName: contact.Name || null,
      reference,
      date,
      dueDate,
      paymentTermsDays,
      subTotal: invoice.SubTotal ?? null,
      totalTax: invoice.TotalTax ?? null,
      total: invoice.Total ?? null,
      lines: lineItems.map((l) => ({ description: l.description, amount: l.unitAmount * l.quantity })),
      xeroUrl,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('Invoice preview error:', err);
    await itemRef.update({ previewInProgressAt: null, previewClaim: null }).catch(() => {});
    return NextResponse.json({ error: `The invoice preview failed: ${err.message}` }, { status: 500 });
  }
}

export async function GET(request, { params }) {
  const auth = await verifyAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { runId } = await params;
  const itemId = new URL(request.url).searchParams.get('itemId');
  const loaded = await loadRunAndItem(runId, itemId);
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { item } = loaded;

  const invoiceId = item.previewXeroInvoiceId;
  if (!invoiceId) {
    return NextResponse.json({ error: 'There is no preview for this invoice yet' }, { status: 404 });
  }

  try {
    const pdf = await getInvoicePdf(invoiceId);
    const number = String(item.previewXeroInvoiceNumber || 'draft').replace(/[^A-Za-z0-9._-]/g, '');
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Premarket-invoice-${number}-preview.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('Invoice preview PDF error:', err);
    return NextResponse.json({ error: `Could not get the invoice PDF from Xero: ${err.message}` }, { status: 502 });
  }
}
