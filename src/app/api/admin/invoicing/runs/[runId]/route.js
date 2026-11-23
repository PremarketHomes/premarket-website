import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyAdmin } from '../../../../middleware/auth';
import { withChargeDetails } from '../../../../services/chargeDetails';
import { releaseCharges } from '../../../../services/billingService';
import { sendInvoice, getInvoiceById, deleteDraftInvoice } from '../../../../services/xeroService';
import { checkInvoiceDelivery } from '../../../../services/invoiceDelivery';

const EMAIL_CLAIM_MS = 2 * 60 * 1000; // a retry in progress blocks another for up to 2 minutes

/** Loads one item of this run that has a real Xero invoice, or returns an error response. */
async function loadInvoicedItem(runId, itemId) {
  if (!itemId) return { error: NextResponse.json({ error: 'itemId is required' }, { status: 400 }) };
  const itemRef = adminDb.collection('invoiceRunItems').doc(itemId);
  const itemDoc = await itemRef.get();
  if (!itemDoc.exists) return { error: NextResponse.json({ error: 'Item not found' }, { status: 404 }) };
  const item = itemDoc.data();
  if (item.runId !== runId) {
    return { error: NextResponse.json({ error: 'Item does not belong to this run' }, { status: 400 }) };
  }
  if (!item.xeroInvoiceId) {
    return { error: NextResponse.json({ error: 'This item has no Xero invoice to retry sending — it was never successfully created' }, { status: 400 }) };
  }
  return { itemRef, item };
}

/** Xero shows the invoice was emailed: record it as sent locally. No email, no Xero write. */
async function recordSentFromXero(itemRef, delivery) {
  await itemRef.update({
    status: 'sent',
    lastEmailError: null,
    emailConfirmedFromXeroAt: FieldValue.serverTimestamp(),
    emailConfirmation: delivery.evidence,
  });
}

/**
 * Once every item of a failed or partial run has been sent (or paid), the run itself is sent.
 * The original errors are kept as resolvedErrors.
 */
async function settleRunAfterEmail(runId, runRef) {
  const runDoc = await runRef.get();
  const run = runDoc.data() || {};
  if (!['failed', 'partial'].includes(run.status)) return run.status;
  const itemsSnap = await adminDb.collection('invoiceRunItems').where('runId', '==', runId).get();
  const allSent = itemsSnap.size > 0 && itemsSnap.docs.every((d) => ['sent', 'paid'].includes(d.data().status));
  if (!allSent) return run.status;
  await runRef.update({
    status: 'sent',
    resolvedErrors: run.errors || [],
    errors: [],
    emailResolvedAt: FieldValue.serverTimestamp(),
  });
  return 'sent';
}

/** Every propertyId currently attached to a run, across all its items —
 * used to release the right charges back to 'pending' whenever the run
 * itself (not an individual item) is cancelled or deleted. */
async function getAllPropertyIdsForRun(runId) {
  const itemsSnap = await adminDb.collection('invoiceRunItems').where('runId', '==', runId).get();
  return itemsSnap.docs.flatMap((d) => (d.data().properties || []).map((p) => p.propertyId)).filter(Boolean);
}

/**
 * When a run (or one agency's item) is cancelled, deleted or removed, the DRAFT invoices its
 * "Preview invoice" created in Xero are deleted too, so a draft for charges that are no longer
 * in this run can never be approved in Xero by mistake. Only a still-DRAFT preview is ever
 * touched (Xero refuses to delete an approved invoice anyway); items without a preview make no
 * Xero call at all. Best-effort: a Xero failure never blocks the cancel or delete. It is
 * returned as a warning naming the draft to delete by hand.
 */
async function discardPreviewDrafts(items) {
  const warnings = [];
  for (const item of items) {
    if (!item?.previewXeroInvoiceId || item.xeroInvoiceId) continue;
    const label = `draft invoice ${item.previewXeroInvoiceNumber || item.previewXeroInvoiceId} for ${item.agencyName || 'this agency'}`;
    try {
      const invoice = await getInvoiceById(item.previewXeroInvoiceId);
      if (invoice?.Status === 'DRAFT') await deleteDraftInvoice(invoice.InvoiceID);
    } catch (err) {
      console.error(`Could not delete the preview ${label} in Xero:`, err);
      warnings.push(`The preview ${label} could not be deleted in Xero (${err.message}). Delete it in Xero.`);
    }
  }
  return warnings;
}

async function getAllItemsForRun(runId) {
  const itemsSnap = await adminDb.collection('invoiceRunItems').where('runId', '==', runId).get();
  return itemsSnap.docs.map((d) => d.data());
}

/**
 * GET /api/admin/invoicing/runs/[runId]
 * Get full run details + all items.
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { runId } = await params;

    const runDoc = await adminDb.collection('invoiceRuns').doc(runId).get();
    if (!runDoc.exists) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const itemsSnap = await adminDb
      .collection('invoiceRunItems')
      .where('runId', '==', runId)
      .get();

    // Each property's full address, selling agent, submission date and charge
    // status come from its live records (display only; nothing is written).
    const items = await Promise.all(itemsSnap.docs.map(async (doc) => {
      const item = { id: doc.id, ...doc.data() };
      return { ...item, properties: await withChargeDetails(item.properties || [], 'address', { withChargeStatus: true }) };
    }));

    return NextResponse.json({
      run: { id: runDoc.id, ...runDoc.data() },
      items,
    });
  } catch (err) {
    console.error('Invoice run detail GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch run' }, { status: 500 });
  }
}

/**
 * Recalculate run totals from remaining items.
 */
async function recalculateRunTotals(runId, runRef) {
  const itemsSnap = await adminDb
    .collection('invoiceRunItems')
    .where('runId', '==', runId)
    .get();

  let totalProperties = 0;
  let totalAmountInc = 0;
  let totalAmountEx = 0;
  let totalGst = 0;

  for (const doc of itemsSnap.docs) {
    const item = doc.data();
    totalProperties += item.propertyCount || 0;
    totalAmountInc += item.totalInc || 0;
    totalAmountEx += item.subtotalEx || 0;
    totalGst += item.gstAmount || 0;
  }

  await runRef.update({
    totalProperties,
    totalAgencies: itemsSnap.size,
    totalAmountInc: Math.round(totalAmountInc * 100) / 100,
    totalAmountEx: Math.round(totalAmountEx * 100) / 100,
    totalGst: Math.round(totalGst * 100) / 100,
  });
}

/**
 * PATCH /api/admin/invoicing/runs/[runId]
 * Actions: approve, cancel, removeItems, removeProperties
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { action } = body;
    const { runId } = await params;

    const runRef = adminDb.collection('invoiceRuns').doc(runId);
    const runDoc = await runRef.get();
    if (!runDoc.exists) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const currentStatus = runDoc.data().status;

    if (action === 'approve') {
      if (currentStatus !== 'draft') {
        return NextResponse.json({ error: 'Can only approve draft runs' }, { status: 400 });
      }
      await runRef.update({ status: 'approved', approvedAt: FieldValue.serverTimestamp(), approvedBy: auth.uid });
      return NextResponse.json({ success: true, status: 'approved' });
    }

    if (action === 'cancel') {
      if (!['draft', 'approved'].includes(currentStatus)) {
        return NextResponse.json({ error: 'Cannot cancel this run' }, { status: 400 });
      }
      // Release every charge this run was holding back to 'pending' —
      // a cancelled run must never permanently strand a charge; it
      // just gets picked up by whichever run is created next.
      const propertyIds = await getAllPropertyIdsForRun(runId);
      await releaseCharges(propertyIds);
      await runRef.update({ status: 'cancelled', cancelledAt: FieldValue.serverTimestamp(), cancelledBy: auth.uid });
      const warnings = await discardPreviewDrafts(await getAllItemsForRun(runId));
      return NextResponse.json({ success: true, status: 'cancelled', ...(warnings.length ? { warnings } : {}) });
    }

    // Lets an admin see and resolve a failed send without re-sending
    // the whole run: retries ONLY the email step for one item that
    // already has a real xeroInvoiceId (the invoice itself already
    // exists in Xero — a prior email attempt just failed). Never
    // calls createInvoice — structurally can't, since this action
    // never even imports it — so it can never produce a duplicate
    // invoice, and it never touches propertyCharges at all (those
    // were already correctly marked invoiced when the invoice was
    // first created; nothing about a retried email changes that).
    // Gated on the item already having a xeroInvoiceId specifically
    // so this can never become a backdoor around the normal send
    // route's own approval requirement — there is no way to reach
    // 'email_failed' with a stored xeroInvoiceId except by having
    // already gone through POST .../send on an approved run.
    //
    // Never emails a customer twice: before sending, it asks Xero whether this invoice has
    // already been emailed (services/invoiceDelivery.js). If Xero shows it was, nothing is sent
    // and the item is recorded as sent. One retry at a time per item, so a double-click cannot
    // send twice either.
    if (action === 'retrySend') {
      const loaded = await loadInvoicedItem(runId, body.itemId);
      if (loaded.error) return loaded.error;
      const { itemRef, item } = loaded;
      if (item.status === 'sent') {
        return NextResponse.json({ error: 'This item has already been sent' }, { status: 400 });
      }

      try {
        await adminDb.runTransaction(async (tx) => {
          const snap = await tx.get(itemRef);
          const startedAt = snap.data()?.emailInProgressAt;
          const startedMs = startedAt?.toMillis?.() ?? (startedAt ? new Date(startedAt).getTime() : null);
          if (startedMs && Date.now() - startedMs < EMAIL_CLAIM_MS) {
            throw Object.assign(new Error('An email for this invoice is already being sent'), { status: 409 });
          }
          if (snap.data()?.status === 'sent') {
            throw Object.assign(new Error('This item has already been sent'), { status: 400 });
          }
          tx.update(itemRef, { emailInProgressAt: new Date() });
        });
      } catch (err) {
        if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
        throw err;
      }

      let delivery;
      try {
        delivery = await checkInvoiceDelivery(item.xeroInvoiceId);
      } catch (err) {
        await itemRef.update({ emailInProgressAt: null });
        return NextResponse.json({ error: `Could not check with Xero whether the invoice was already sent, so it was not emailed: ${err.message}` }, { status: 502 });
      }
      if (!delivery.found) {
        await itemRef.update({ emailInProgressAt: null });
        return NextResponse.json({ error: 'Xero has no record of this invoice, so it was not emailed' }, { status: 409 });
      }
      if (!['AUTHORISED', 'PAID'].includes(delivery.status)) {
        await itemRef.update({ emailInProgressAt: null });
        return NextResponse.json({ error: `The invoice is ${delivery.status} in Xero, so it was not emailed`, delivery }, { status: 409 });
      }
      if (delivery.emailed) {
        await recordSentFromXero(itemRef, delivery);
        await itemRef.update({ emailInProgressAt: null });
        const runStatus = await settleRunAfterEmail(runId, runRef);
        return NextResponse.json({ success: true, status: 'sent', alreadySent: true, runStatus, delivery });
      }

      try {
        await sendInvoice(item.xeroInvoiceId);
        await itemRef.update({
          status: 'sent',
          emailSentAt: FieldValue.serverTimestamp(),
          lastEmailError: null,
          emailAttempts: (item.emailAttempts || 0) + 1,
          emailInProgressAt: null,
        });
        const runStatus = await settleRunAfterEmail(runId, runRef);
        return NextResponse.json({ success: true, status: 'sent', runStatus });
      } catch (err) {
        await itemRef.update({
          status: 'email_failed',
          lastEmailError: err.message,
          emailAttempts: (item.emailAttempts || 0) + 1,
          emailInProgressAt: null,
        });
        return NextResponse.json({ error: err.message || 'Failed to send invoice' }, { status: 500 });
      }
    }

    // Read-only: what Xero holds for this item's invoice now (status, amounts, dates, contact)
    // and whether Xero has emailed it, from Xero's own records. Emails nothing and writes
    // nothing to Xero. If Xero shows the invoice was emailed but the item is still recorded as
    // a failed email, the item (and, once every item is sent, the run) is corrected to sent.
    if (action === 'checkDelivery') {
      const loaded = await loadInvoicedItem(runId, body.itemId);
      if (loaded.error) return loaded.error;
      const { itemRef, item } = loaded;
      let delivery;
      try {
        delivery = await checkInvoiceDelivery(item.xeroInvoiceId);
      } catch (err) {
        return NextResponse.json({ error: `Could not read the invoice from Xero: ${err.message}` }, { status: 502 });
      }
      let reconciled = false;
      let runStatus = currentStatus;
      if (delivery.found && delivery.emailed && item.status === 'email_failed') {
        await recordSentFromXero(itemRef, delivery);
        runStatus = await settleRunAfterEmail(runId, runRef);
        reconciled = true;
      }
      return NextResponse.json({ success: true, delivery, reconciled, runStatus }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    // Remove entire agency items from a draft run
    if (action === 'removeItems') {
      if (currentStatus !== 'draft') {
        return NextResponse.json({ error: 'Can only edit draft runs' }, { status: 400 });
      }
      const { itemIds } = body; // array of invoiceRunItem doc IDs
      if (!itemIds?.length) {
        return NextResponse.json({ error: 'No itemIds provided' }, { status: 400 });
      }

      // Release these items' charges before deleting the items
      // themselves — otherwise their propertyIds would be gone from
      // Firestore before we can look them up to release.
      const itemDocs = await Promise.all(itemIds.map((id) => adminDb.collection('invoiceRunItems').doc(id).get()));
      const propertyIdsToRelease = itemDocs.flatMap((d) => (d.exists ? (d.data().properties || []).map((p) => p.propertyId) : [])).filter(Boolean);
      await releaseCharges(propertyIdsToRelease);
      const warnings = await discardPreviewDrafts(itemDocs.filter((d) => d.exists && d.data().runId === runId).map((d) => d.data()));

      const batch = adminDb.batch();
      for (const itemId of itemIds) {
        batch.delete(adminDb.collection('invoiceRunItems').doc(itemId));
      }
      await batch.commit();
      await recalculateRunTotals(runId, runRef);

      return NextResponse.json({ success: true, removed: itemIds.length, ...(warnings.length ? { warnings } : {}) });
    }

    // Remove individual properties from an agency item, recalculating its totals
    if (action === 'removeProperties') {
      if (currentStatus !== 'draft') {
        return NextResponse.json({ error: 'Can only edit draft runs' }, { status: 400 });
      }
      const { itemId, propertyIds } = body; // single item + array of propertyIds to remove
      if (!itemId || !propertyIds?.length) {
        return NextResponse.json({ error: 'Missing itemId or propertyIds' }, { status: 400 });
      }

      const itemRef = adminDb.collection('invoiceRunItems').doc(itemId);
      const itemDoc = await itemRef.get();
      if (!itemDoc.exists) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }

      const item = itemDoc.data();
      const remaining = (item.properties || []).filter((p) => !propertyIds.includes(p.propertyId));

      // Release exactly the properties actually being removed — not
      // "remaining", the inverse — back to 'pending'.
      await releaseCharges(propertyIds);

      if (remaining.length === 0) {
        // All properties removed — delete the entire item
        await itemRef.delete();
      } else {
        // Recalculate item totals by summing what's left — each
        // property carries its own charge amounts (snapshotted at
        // charge-creation time, see billingService.js), which may not
        // all be the same price if settings/invoicing changed between
        // when they were each recorded. Never re-derive from a single
        // assumed run-wide price.
        const propertyCount = remaining.length;
        const subtotalEx = remaining.reduce((sum, p) => sum + (p.subtotalEx || 0), 0);
        const gstAmount = remaining.reduce((sum, p) => sum + (p.gstAmount || 0), 0);
        const totalInc = remaining.reduce((sum, p) => sum + (p.totalInc || 0), 0);

        await itemRef.update({
          properties: remaining,
          propertyCount,
          subtotalEx: Math.round(subtotalEx * 100) / 100,
          gstAmount: Math.round(gstAmount * 100) / 100,
          totalInc: Math.round(totalInc * 100) / 100,
        });
      }

      await recalculateRunTotals(runId, runRef);
      return NextResponse.json({ success: true, remainingProperties: remaining?.length ?? 0 });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('Invoice run PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update run' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/invoicing/runs/[runId]
 * Delete draft runs + their items.
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { runId } = await params;

    const runRef = adminDb.collection('invoiceRuns').doc(runId);
    const runDoc = await runRef.get();
    if (!runDoc.exists) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (runDoc.data().status !== 'draft') {
      return NextResponse.json({ error: 'Can only delete draft runs' }, { status: 400 });
    }

    // Release this run's charges back to 'pending' before deleting it
    // — a deleted draft must not strand them.
    const propertyIds = await getAllPropertyIdsForRun(runId);
    await releaseCharges(propertyIds);

    // Delete all items for this run
    const itemsSnap = await adminDb
      .collection('invoiceRunItems')
      .where('runId', '==', runId)
      .get();
    const warnings = await discardPreviewDrafts(itemsSnap.docs.map((d) => d.data()));

    const batch = adminDb.batch();
    for (const doc of itemsSnap.docs) {
      batch.delete(doc.ref);
    }
    batch.delete(runRef);
    await batch.commit();

    return NextResponse.json({ success: true, ...(warnings.length ? { warnings } : {}) });
  } catch (err) {
    console.error('Invoice run DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete run' }, { status: 500 });
  }
}
