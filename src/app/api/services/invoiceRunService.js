// Invoice-run creation — groups every PENDING property charge by
// billing entity (agency or independent agent) into a new draft run,
// ready for admin review/approval. This is the one shared
// implementation used by both the manual "Create run" admin action
// (api/admin/invoicing/runs/route.js) and the daily cron
// (api/cron/invoice-dry-run/route.js) — previously each had its own
// copy of this logic, computed straight from the `properties`
// collection; both now read from the propertyCharges ledger instead
// (see billingService.js), which is what makes "counts billable
// properties once" and "prevents duplicate billing across runs"
// actually guaranteed rather than inferred from a createdAt date range.
//
// A charge only leaves 'pending' when it's grouped into a run here (it
// becomes 'queued', attached to that run's ID) — so a second run
// created five minutes later, or a retried request, can never also
// grab the same charge: it's already queued, and the query below only
// ever selects status == 'pending'.

import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { reconcileMissingCharges, resolveBillingContact, getBillingContactStatus } from './billingService';

/**
 * Groups a list of { id, ...chargeData } charge docs by
 * billingEntityKey into the shape invoiceRunItems already expects
 * (propertyCount/subtotalEx/gstAmount/totalInc summed from each
 * charge's own snapshotted amounts, not recomputed from a single
 * run-wide price — see billingService.computeChargeAmounts).
 */
function groupChargesByEntity(charges) {
  const groups = {};
  for (const charge of charges) {
    const key = charge.billingEntityKey;
    if (!groups[key]) {
      groups[key] = {
        billingEntityKey: key,
        billingEntityType: charge.billingEntityType,
        agencyName: charge.billingEntityName,
        agentUserId: charge.agentUserId,
        agentName: charge.agentName,
        agentEmail: charge.agentEmail,
        agencyBrandId: charge.agencyBrandId || null,
        properties: [],
        propertyIds: [],
        subtotalEx: 0,
        gstAmount: 0,
        totalInc: 0,
      };
    }
    const group = groups[key];
    // Each property carries its own charge amounts (not just id/address)
    // so a later partial removal (removeProperties, in
    // runs/[runId]/route.js) can recompute the item's remaining totals
    // by summing what's left, instead of re-deriving from a single
    // run-wide price that may not match what each charge actually
    // snapshotted.
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

  return Object.values(groups).map((g) => ({
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
}

/**
 * Creates a new draft invoice run from currently-pending charges.
 * Returns null (no run created) if there's nothing to bill — callers
 * decide what that means for them (the cron treats it as "nothing to
 * do today"; the manual admin action can just say so).
 *
 * `onlyEntityKeys`, when given, restricts this to charges belonging
 * to those billingEntityKeys — used by the daily cron to bundle only
 * the agencies whose 30-day cycle is actually due (see
 * billingService.getDueBillingEntityKeys), leaving every other
 * agency's charges untouched at 'pending' for a later day. The manual
 * "Create Run" admin action never passes this — it always bundles
 * everything currently pending, on demand, which is what lets testing
 * happen without waiting out a real 30-day cycle.
 */
export async function createInvoiceRunFromPendingCharges({ createdBy, onlyEntityKeys }) {
  await reconcileMissingCharges();

  const pendingSnap = await adminDb.collection('propertyCharges').where('status', '==', 'pending').get();
  if (pendingSnap.empty) return null;

  let charges = pendingSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (onlyEntityKeys) {
    const allowed = new Set(onlyEntityKeys);
    charges = charges.filter((c) => allowed.has(c.billingEntityKey));
  }
  if (charges.length === 0) return null;

  const items = groupChargesByEntity(charges);

  // The agency's designated billing contact (if one has been set)
  // overrides whichever agent's charge happened to be grouped first —
  // see billingService.setBillingContact. This stamp is informational
  // only, for the admin's draft/approved-run preview — the actual send
  // route never trusts it; it always re-resolves resolveBillingContact
  // live, right before creating anything in Xero, so a contact
  // confirmed (or changed) after this run was created still takes
  // effect correctly at send time.
  //
  // billingContactStatus likewise is purely a display flag — it's what
  // lets the admin UI show "Billing details required" / "Pending
  // confirmation" next to an agency before the run is even approved,
  // without the admin having to attempt a send first to find out.
  for (const item of items) {
    if (item.billingEntityType === 'independent') {
      item.billingContactStatus = 'not_applicable';
      continue;
    }
    const contact = await resolveBillingContact(item.billingEntityKey);
    if (contact) {
      item.agentName = contact.name;
      item.agentEmail = contact.email;
      item.billingContactStatus = 'confirmed';
    } else {
      const statusInfo = await getBillingContactStatus(item.billingEntityKey);
      item.billingContactStatus = statusInfo.status;
    }
  }

  const totalProperties = items.reduce((sum, i) => sum + i.propertyCount, 0);
  const totalAmountInc = items.reduce((sum, i) => sum + i.totalInc, 0);
  const totalAmountEx = items.reduce((sum, i) => sum + i.subtotalEx, 0);
  const totalGst = items.reduce((sum, i) => sum + i.gstAmount, 0);

  const prevRunSnap = await adminDb.collection('invoiceRuns').orderBy('createdAt', 'desc').limit(1).get();
  const previousRun = prevRunSnap.empty ? null : prevRunSnap.docs[0];

  // periodStart/periodEnd are a display label, not a billing filter —
  // the actual date range of the charges this run happens to bundle,
  // for the admin UI's existing "X – Y" run list (InvoiceRunsPanel.js /
  // InvoiceRunDetail.js). Nothing is selected *by* this range any more.
  const chargeDates = charges
    .map((c) => c.createdAt?.toDate?.() || (c.createdAt ? new Date(c.createdAt) : null))
    .filter(Boolean);
  const periodStart = chargeDates.length ? new Date(Math.min(...chargeDates)) : new Date();
  const periodEnd = chargeDates.length ? new Date(Math.max(...chargeDates)) : new Date();

  const runRef = adminDb.collection('invoiceRuns').doc();
  const runData = {
    status: 'draft',
    periodStart,
    periodEnd,
    createdAt: FieldValue.serverTimestamp(),
    createdBy,
    executedAt: null,
    totalProperties,
    totalAgencies: items.length,
    totalAmountInc: Math.round(totalAmountInc * 100) / 100,
    totalAmountEx: Math.round(totalAmountEx * 100) / 100,
    totalGst: Math.round(totalGst * 100) / 100,
    previousRunId: previousRun?.id || null,
    previousTotalProperties: previousRun?.data()?.totalProperties || 0,
    previousTotalAmountInc: previousRun?.data()?.totalAmountInc || 0,
    errors: [],
    xeroSendResults: [],
  };

  const batch = adminDb.batch();
  batch.set(runRef, runData);

  for (const item of items) {
    const { propertyIds, ...itemData } = item;
    const itemRef = adminDb.collection('invoiceRunItems').doc();
    batch.set(itemRef, { ...itemData, runId: runRef.id });
    for (const propertyId of propertyIds) {
      batch.update(adminDb.collection('propertyCharges').doc(propertyId), {
        status: 'queued',
        runId: runRef.id,
      });
    }
  }

  await batch.commit();

  return {
    runId: runRef.id,
    totalProperties,
    totalAgencies: items.length,
    totalAmountInc: runData.totalAmountInc,
    totalAmountEx: runData.totalAmountEx,
    totalGst: runData.totalGst,
  };
}
