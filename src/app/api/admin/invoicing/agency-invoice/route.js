import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyAdmin } from '../../../middleware/auth';
import { recordPropertyCharge } from '../../../services/billingService';

/**
 * POST /api/admin/invoicing/agency-invoice
 * Create a manual, ad-hoc invoice run for a specific set of properties
 * (an edge case outside the normal monthly cycle — e.g. billing a
 * handful of properties immediately rather than waiting for the next
 * run). Reads from the same propertyCharges ledger the monthly engine
 * uses (billingService.js) rather than scanning `properties` directly,
 * so this can never double-bill something the monthly run already has,
 * and vice versa — a property only ever has one charge, and this just
 * queues whichever of the given properties' charges are still pending.
 *
 * Body: { propertyIds } — required, the specific properties to invoice
 * now. Any property without a charge yet gets one recorded first
 * (reusing the exact same recordPropertyCharge as every other creation
 * path); any whose charge is already queued/invoiced/excluded/reversed
 * is skipped and reported back, never double-counted.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { propertyIds } = await request.json();

    if (!propertyIds?.length) {
      return NextResponse.json({ error: 'At least one propertyId required' }, { status: 400 });
    }

    const uniquePropertyIds = [...new Set(propertyIds)];
    const skipped = [];
    const pendingCharges = [];

    for (const propertyId of uniquePropertyIds) {
      const propDoc = await adminDb.collection('properties').doc(propertyId).get();
      if (!propDoc.exists) {
        skipped.push({ propertyId, reason: 'property-not-found' });
        continue;
      }

      await recordPropertyCharge({ id: propDoc.id, ...propDoc.data() });

      const chargeDoc = await adminDb.collection('propertyCharges').doc(propertyId).get();
      if (!chargeDoc.exists) {
        skipped.push({ propertyId, reason: 'charge-not-recorded' });
        continue;
      }

      const charge = chargeDoc.data();
      if (charge.status !== 'pending') {
        skipped.push({ propertyId, reason: `charge-already-${charge.status}` });
        continue;
      }

      pendingCharges.push({ id: chargeDoc.id, ...charge });
    }

    if (pendingCharges.length === 0) {
      return NextResponse.json({ error: 'None of the given properties have a billable pending charge', skipped }, { status: 400 });
    }

    // Group by billing entity, same shape invoiceRunService uses for the
    // monthly run — this is deliberately simple inline grouping rather
    // than importing that module's internal helper, since a manual
    // invoice is normally for one agency's handful of properties and
    // doesn't need the monthly run's safety-net reconciliation sweep.
    const groups = {};
    for (const charge of pendingCharges) {
      const key = charge.billingEntityKey;
      if (!groups[key]) {
        groups[key] = {
          billingEntityKey: key,
          billingEntityType: charge.billingEntityType,
          agencyName: charge.billingEntityName,
          agentUserId: charge.agentUserId,
          agentName: charge.agentName,
          agentEmail: charge.agentEmail,
          properties: [],
          propertyIds: [],
          subtotalEx: 0,
          gstAmount: 0,
          totalInc: 0,
        };
      }
      const group = groups[key];
      group.properties.push({
        propertyId: charge.propertyId,
        address: charge.propertyAddress,
        subtotalEx: charge.subtotalEx || 0,
        gstAmount: charge.gstAmount || 0,
        totalInc: charge.totalInc || 0,
      });
      group.propertyIds.push(charge.propertyId);
      group.subtotalEx += charge.subtotalEx || 0;
      group.gstAmount += charge.gstAmount || 0;
      group.totalInc += charge.totalInc || 0;
    }

    const items = Object.values(groups).map((g) => ({
      ...g,
      propertyCount: g.properties.length,
      subtotalEx: Math.round(g.subtotalEx * 100) / 100,
      gstAmount: Math.round(g.gstAmount * 100) / 100,
      totalInc: Math.round(g.totalInc * 100) / 100,
      status: 'pending',
      xeroContactId: null,
      xeroInvoiceId: null,
      xeroInvoiceNumber: null,
      xeroInvoiceUrl: null,
      xeroStatus: null,
      paidAt: null,
      lastSyncedAt: null,
    }));

    const totalProperties = items.reduce((sum, i) => sum + i.propertyCount, 0);
    const totalAmountInc = items.reduce((sum, i) => sum + i.totalInc, 0);
    const totalAmountEx = items.reduce((sum, i) => sum + i.subtotalEx, 0);
    const totalGst = items.reduce((sum, i) => sum + i.gstAmount, 0);

    const runRef = adminDb.collection('invoiceRuns').doc();
    const runData = {
      type: 'manual',
      status: 'draft',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: auth.uid,
      executedAt: null,
      totalProperties,
      totalAgencies: items.length,
      totalAmountInc: Math.round(totalAmountInc * 100) / 100,
      totalAmountEx: Math.round(totalAmountEx * 100) / 100,
      totalGst: Math.round(totalGst * 100) / 100,
      previousRunId: null,
      previousTotalProperties: 0,
      previousTotalAmountInc: 0,
      errors: [],
      xeroSendResults: [],
    };

    const batch = adminDb.batch();
    batch.set(runRef, runData);
    for (const item of items) {
      const { propertyIds: itemPropertyIds, ...itemData } = item;
      const itemRef = adminDb.collection('invoiceRunItems').doc();
      batch.set(itemRef, { ...itemData, runId: runRef.id });
      for (const propertyId of itemPropertyIds) {
        batch.update(adminDb.collection('propertyCharges').doc(propertyId), {
          status: 'queued',
          runId: runRef.id,
        });
      }
    }
    await batch.commit();

    return NextResponse.json({
      success: true,
      runId: runRef.id,
      propertyCount: totalProperties,
      subtotalEx: runData.totalAmountEx,
      gst: runData.totalGst,
      total: runData.totalAmountInc,
      skipped,
    });
  } catch (err) {
    console.error('Agency invoice error:', err);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
