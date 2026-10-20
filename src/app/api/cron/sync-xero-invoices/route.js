import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { batchGetInvoiceStatuses, isXeroConnected } from '../../services/xeroService';
import { verifyCron } from '../../middleware/auth';

export const maxDuration = 60;

/**
 * GET /api/cron/sync-xero-invoices
 *
 * The periodic-pull safety net alongside the Xero webhook (push) and
 * the manual "Sync from Xero" admin action — the same pairing already
 * used for property charges (see reconcile-property-charges's own
 * comment). The webhook should catch a status change in real time,
 * but webhook delivery can fail silently (XERO_WEBHOOK_KEY not
 * configured yet, a dropped delivery, a Xero-side outage) and nothing
 * else would ever notice. This runs daily across EVERY outstanding
 * sent invoice, not just one run, and applies the exact same
 * PAID/VOIDED/other status logic as the manual per-run sync action
 * (runs/[runId]/sync/route.js) and the webhook
 * (xeroService.updateInvoiceRunItem) — all three are documented to
 * agree with each other and must never drift apart.
 *
 * Always safe to run repeatedly: it only ever updates xeroStatus/
 * paidAt/status fields to whatever Xero currently reports, never
 * creates or sends anything.
 */
export async function GET(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    if (!(await isXeroConnected())) {
      return NextResponse.json({ message: 'Xero is not connected', skipped: true });
    }

    const itemsSnap = await adminDb.collection('invoiceRunItems').where('status', '==', 'sent').get();
    const itemsWithXero = itemsSnap.docs.filter((d) => d.data().xeroInvoiceId);

    if (itemsWithXero.length === 0) {
      return NextResponse.json({ success: true, synced: 0, message: 'No outstanding invoices to sync' });
    }

    const xeroIds = itemsWithXero.map((d) => d.data().xeroInvoiceId);
    const xeroInvoices = await batchGetInvoiceStatuses(xeroIds);

    const statusMap = {};
    for (const inv of xeroInvoices) {
      statusMap[inv.InvoiceID] = inv;
    }

    let synced = 0;
    let paidCount = 0;

    for (const itemDoc of itemsWithXero) {
      const item = itemDoc.data();
      const xeroInvoice = statusMap[item.xeroInvoiceId];
      if (!xeroInvoice) continue;

      const updates = {
        xeroStatus: xeroInvoice.Status,
        lastSyncedAt: FieldValue.serverTimestamp(),
      };

      if (xeroInvoice.Status === 'PAID') {
        updates.paidAt = xeroInvoice.FullyPaidOnDate || new Date().toISOString();
        updates.status = 'paid';
        paidCount++;
      } else if (xeroInvoice.Status === 'VOIDED') {
        updates.status = 'voided';
      }

      await itemDoc.ref.update(updates);
      synced++;
    }

    return NextResponse.json({ success: true, synced, paidCount, total: itemsWithXero.length });
  } catch (err) {
    console.error('Sync Xero invoices cron error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
