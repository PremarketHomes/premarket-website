import { NextResponse } from 'next/server';
import { batchGetInvoiceStatuses, updateInvoiceRunItem } from '../../services/xeroService';
import crypto from 'crypto';

/**
 * POST /api/webhooks/xero
 *
 * A webhook event only ever tells you an invoice CHANGED and which
 * eventType/eventCategory fired — never its current status. The
 * previous version of this handler ignored that and hard-coded every
 * event as `{ Status: 'PAID' }`, so an invoice being created, edited,
 * or even voided would get marked paid here. Fixed: this now always
 * fetches the invoice's REAL current status from Xero's own API
 * (batchGetInvoiceStatuses — the exact same call the manual "Sync"
 * admin action already uses, see runs/[runId]/sync/route.js) before
 * updating anything, and only ever writes what Xero actually reports.
 *
 * Also removed the dead call to the old updateInvoiceInFirestore
 * (users.invoices array) path — nothing in this codebase has ever
 * written invoiceIds/invoices onto a user doc, so that call only ever
 * logged a "no user found" warning and did nothing. invoiceRunItems is
 * the one real target.
 */
export async function POST(request) {
  try {
    // Read at request time (not a module-level constant) so this
    // always reflects the actual current environment.
    const WEBHOOK_KEY = process.env.XERO_WEBHOOK_KEY;

    // Fails closed, the same way verifyCron does for the scheduled
    // jobs: no configured secret means the signature can never be
    // verified, so the request is rejected rather than trusting an
    // unverifiable payload.
    if (!WEBHOOK_KEY) {
      console.error('Xero webhook received but XERO_WEBHOOK_KEY is not configured');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 });
    }

    const signature = request.headers.get('x-xero-signature');
    const rawBody = Buffer.from(await request.arrayBuffer());

    if (!signature || !rawBody.length) {
      return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
    }

    const hmac = crypto
      .createHmac('sha256', WEBHOOK_KEY)
      .update(rawBody)
      .digest('base64');

    if (signature !== hmac) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody.toString());

    // Intent to Receive handshake
    if (Array.isArray(payload.events) && payload.events.length === 0 && payload.entropy) {
      return new NextResponse(null, { status: 200 });
    }

    const invoiceIds = [...new Set((payload.events || []).map((e) => e.resourceId).filter(Boolean))];
    if (invoiceIds.length === 0) {
      return NextResponse.json({ success: true, received: 0, updated: 0 });
    }

    // One real call to Xero for every affected invoice in this batch —
    // never trust the event itself for status.
    const xeroInvoices = await batchGetInvoiceStatuses(invoiceIds);

    let updated = 0;
    for (const invoice of xeroInvoices) {
      const result = await updateInvoiceRunItem(invoice.InvoiceID, invoice);
      if (result) updated++;
    }

    return NextResponse.json({ success: true, received: invoiceIds.length, updated });
  } catch (err) {
    // A thrown error here (e.g. Xero's API temporarily unavailable)
    // deliberately surfaces as a non-2xx response — Xero retries
    // webhook deliveries on failure, so this is the safe outcome:
    // the update is retried later rather than silently dropped.
    console.error('Webhook processing error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
