import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyAdmin } from '../../../../middleware/auth';
import { releaseCharges } from '../../../../services/billingService';

/** Every propertyId currently attached to a run, across all its items —
 * used to release the right charges back to 'pending' whenever the run
 * itself (not an individual item) is cancelled or deleted. */
async function getAllPropertyIdsForRun(runId) {
  const itemsSnap = await adminDb.collection('invoiceRunItems').where('runId', '==', runId).get();
  return itemsSnap.docs.flatMap((d) => (d.data().properties || []).map((p) => p.propertyId)).filter(Boolean);
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

    const items = itemsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

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
      return NextResponse.json({ success: true, status: 'cancelled' });
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

      const batch = adminDb.batch();
      for (const itemId of itemIds) {
        batch.delete(adminDb.collection('invoiceRunItems').doc(itemId));
      }
      await batch.commit();
      await recalculateRunTotals(runId, runRef);

      return NextResponse.json({ success: true, removed: itemIds.length });
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

    const batch = adminDb.batch();
    for (const doc of itemsSnap.docs) {
      batch.delete(doc.ref);
    }
    batch.delete(runRef);
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Invoice run DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete run' }, { status: 500 });
  }
}
