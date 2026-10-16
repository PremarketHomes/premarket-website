// Billing — the charge ledger.
//
// One `propertyCharges/{propertyId}` document is ever created per
// property, the moment that property is successfully created (its
// private buyer link is live from that same instant — see
// dashboard/add/page.js, propertyScrapeService.js, and the AgentBox/Rex
// import routes, the three places a NEW property document is created).
// The doc ID is the property ID itself, so recording a charge is
// idempotent by construction: recordPropertyCharge() always checks for
// an existing doc first, and uses Firestore's `create()` (which fails
// if the doc already exists) rather than `set()`, so even two
// near-simultaneous calls for the same property can only ever produce
// one charge — the second one's `create()` throws, which is caught and
// treated as "already recorded," not an error.
//
// Editing, archiving, toggling visibility, or re-saving an existing
// property never calls this — only the three creation paths do — so
// none of those can ever generate a second charge for the same
// property. The monthly invoice-run engine (invoiceRunService.js) also
// sweeps for any property missing a charge before each run, as a safety
// net in case a creation path's call to this ever failed silently
// (e.g. a client-side network error) — calling recordPropertyCharge
// again for an already-charged property is always a safe no-op.
//
// Price/GST are snapshotted onto the charge at creation time, not
// recomputed later — a later change to settings/invoicing must never
// retroactively alter a charge that was already recorded under the old
// price.

import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';

export const DEFAULT_PRICE_PER_LISTING = 200;
export const DEFAULT_GST_RATE = 0.1;

export async function getInvoicingSettings() {
  const doc = await adminDb.collection('settings').doc('invoicing').get();
  const data = doc.exists ? doc.data() : {};
  return {
    pricePerListing: data.pricePerListing || DEFAULT_PRICE_PER_LISTING,
    gstRate: typeof data.gstRate === 'number' ? data.gstRate : DEFAULT_GST_RATE,
    excludeAgentIds: data.excludeAgentIds || [],
  };
}

/**
 * Pure (no Firestore) — resolves which billing entity a property's
 * charge belongs to, given the creating agent's own user doc.
 *
 * Grouping key is the agent's `companyName`, normalised (trimmed,
 * lower-cased) exactly like the existing agencyBrands exact-match logic
 * in brandProfileService.js (findBrandByExactName/linkExistingBrand) —
 * so "Harcourts Property Hub" and "harcourts property hub " land in the
 * same group. This is a deliberate choice, not the only one available:
 * `agencyBrandId` (a stable, server-assigned ID — see
 * brandProfileService.js) is also recorded on the charge below for
 * future cross-reference, but is NOT used as the grouping key, because
 * brand adoption is partial — many agents have a companyName but have
 * never set up or joined a branding profile, and grouping by
 * agencyBrandId would silently fall back to "independent" for every one
 * of them, which is wrong (they do have an agency, just no brand row).
 * If two agents at the same company spell it differently in
 * companyName, they'll bill as two separate entities — a known,
 * reportable limitation of this approach, not a silent bug.
 *
 * An agent with no companyName at all is genuinely independent — billed
 * individually, under their own name, never grouped with anyone else.
 */
export function resolveBillingEntity({ agentUserId, companyName, firstName, lastName, agencyBrandId }) {
  const trimmedCompany = String(companyName || '').trim();
  const agentName = `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown agent';

  if (!trimmedCompany) {
    return {
      billingEntityType: 'independent',
      billingEntityKey: `agent:${agentUserId}`,
      billingEntityName: agentName,
      agencyBrandId: agencyBrandId || null,
    };
  }

  return {
    billingEntityType: 'agency',
    billingEntityKey: `agency:${trimmedCompany.toLowerCase()}`,
    billingEntityName: trimmedCompany,
    agencyBrandId: agencyBrandId || null,
  };
}

/** Pure (no Firestore) — the three amounts a single property's charge
 * carries, derived once from the price/GST in force at charge time. */
export function computeChargeAmounts(pricePerListing, gstRate) {
  const totalInc = pricePerListing;
  const subtotalEx = totalInc / (1 + gstRate);
  const gstAmount = totalInc - subtotalEx;
  return {
    totalInc: Math.round(totalInc * 100) / 100,
    subtotalEx: Math.round(subtotalEx * 100) / 100,
    gstAmount: Math.round(gstAmount * 100) / 100,
  };
}

/**
 * Records a charge for a single property, if one doesn't already
 * exist. Safe to call more than once for the same property — every
 * call after the first is a no-op.
 *
 * `property` needs at minimum: id, userId (or uid) — the creating
 * agent — and address (for the eventual invoice line item). Returns
 * { created, chargeId, reason? }.
 */
export async function recordPropertyCharge(property) {
  const propertyId = property.id;
  if (!propertyId) return { created: false, reason: 'no-property-id' };

  const agentUserId = property.userId || property.uid;
  if (!agentUserId) {
    console.warn(`recordPropertyCharge: property ${propertyId} has no agent userId — skipped`);
    return { created: false, reason: 'no-agent' };
  }

  const chargeRef = adminDb.collection('propertyCharges').doc(propertyId);
  const existing = await chargeRef.get();
  if (existing.exists) return { created: false, chargeId: propertyId, reason: 'already-recorded' };

  const [agentDoc, settings] = await Promise.all([
    adminDb.collection('users').doc(agentUserId).get(),
    getInvoicingSettings(),
  ]);
  const agent = agentDoc.exists ? agentDoc.data() : {};

  if (settings.excludeAgentIds.includes(agentUserId)) {
    return { created: false, reason: 'agent-excluded' };
  }

  const entity = resolveBillingEntity({
    agentUserId,
    companyName: agent.companyName,
    firstName: agent.firstName,
    lastName: agent.lastName,
    agencyBrandId: agent.agencyBrandId,
  });

  const amounts = computeChargeAmounts(settings.pricePerListing, settings.gstRate);

  const chargeData = {
    propertyId,
    propertyAddress: property.address || property.formattedAddress || 'Unknown address',
    agentUserId,
    agentName: `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || 'Unknown agent',
    agentEmail: agent.email || '',
    ...entity,
    pricePerListing: settings.pricePerListing,
    gstRate: settings.gstRate,
    ...amounts,
    status: 'pending', // pending -> queued (in a draft run) -> invoiced | excluded | reversed
    runId: null,
    createdAt: FieldValue.serverTimestamp(),
    invoicedAt: null,
    requiresCreditNote: false,
    adjustment: null,
  };

  try {
    await chargeRef.create(chargeData);
  } catch (err) {
    // Another concurrent call already created it between our .get()
    // check and this .create() — that's the exact race this is meant
    // to close, not a real failure.
    if (isAlreadyExistsError(err)) {
      return { created: false, chargeId: propertyId, reason: 'already-recorded' };
    }
    throw err;
  }

  return { created: true, chargeId: propertyId };
}

function isAlreadyExistsError(err) {
  // Firestore Admin SDK uses gRPC status code 6 (ALREADY_EXISTS) for a
  // failed .create() on an existing doc; the mocked adminApp used in
  // this project's unit tests throws a plain Error with this message.
  return err?.code === 6 || /already exists/i.test(err?.message || '');
}

/**
 * Safety net for the monthly run: given a batch of property docs,
 * ensures every one of them has a charge recorded. Always safe to call
 * on properties that already have one — recordPropertyCharge no-ops.
 */
export async function ensureChargesForProperties(propertyDocs) {
  let created = 0;
  let skipped = 0;
  for (const property of propertyDocs) {
    const result = await recordPropertyCharge(property);
    if (result.created) created++;
    else skipped++;
  }
  return { created, skipped };
}

/**
 * Admin adjustment — excludes a charge that hasn't been invoiced yet
 * (status 'pending'). Never deletes the record; the charge document
 * stays forever, just flagged excluded with who/when/why.
 */
export async function excludeCharge({ chargeId, adminUid, reason }) {
  const ref = adminDb.collection('propertyCharges').doc(chargeId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Charge not found');

  const charge = doc.data();
  if (charge.status !== 'pending') {
    throw new Error(`Cannot exclude a charge with status "${charge.status}" — only pending charges can be excluded directly. A queued charge must be removed from its draft run instead; an invoiced charge must be reversed, not excluded.`);
  }

  await ref.update({
    status: 'excluded',
    adjustment: {
      action: 'excluded',
      reason: reason || null,
      adminUid,
      at: FieldValue.serverTimestamp(),
    },
  });

  return { chargeId, status: 'excluded' };
}

/**
 * Admin adjustment — reverses a charge that has already been invoiced.
 * The accounting record (the charge, and the Xero invoice it's part
 * of) is preserved exactly as it was — this only flags that a credit
 * note or manual adjustment is needed in Xero, it never touches the
 * invoice itself.
 */
export async function reverseCharge({ chargeId, adminUid, reason }) {
  const ref = adminDb.collection('propertyCharges').doc(chargeId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Charge not found');

  const charge = doc.data();
  if (charge.status !== 'invoiced') {
    throw new Error(`Cannot reverse a charge with status "${charge.status}" — reversal is only for charges that have already been invoiced. Use excludeCharge for a pending charge instead.`);
  }

  await ref.update({
    status: 'reversed',
    requiresCreditNote: true,
    adjustment: {
      action: 'reversed',
      reason: reason || null,
      adminUid,
      at: FieldValue.serverTimestamp(),
    },
  });

  return { chargeId, status: 'reversed', requiresCreditNote: true };
}

/**
 * Releases charges back to 'pending' (detaching them from a run) —
 * used when a draft run is cancelled/deleted, or specific
 * properties/items are removed from it before sending. A charge only
 * ever reaches this from 'queued', never from 'invoiced' or
 * 'excluded'/'reversed' — the run actions that call this only ever act
 * on draft/approved (not-yet-sent) runs, see runs/[runId]/route.js.
 */
export async function releaseCharges(propertyIds) {
  if (!propertyIds?.length) return { released: 0 };
  const batch = adminDb.batch();
  let released = 0;
  for (const propertyId of propertyIds) {
    const ref = adminDb.collection('propertyCharges').doc(propertyId);
    const doc = await ref.get();
    if (doc.exists && doc.data().status === 'queued') {
      batch.update(ref, { status: 'pending', runId: null });
      released++;
    }
  }
  if (released > 0) await batch.commit();
  return { released };
}

/** Flips queued charges to invoiced once their Xero invoice send succeeds. */
export async function markChargesInvoiced(propertyIds) {
  if (!propertyIds?.length) return;
  const batch = adminDb.batch();
  for (const propertyId of propertyIds) {
    batch.update(adminDb.collection('propertyCharges').doc(propertyId), {
      status: 'invoiced',
      invoicedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

/** Reverts queued charges back to pending if their Xero send fails —
 * so they're automatically picked up by a future run instead of being
 * stranded attached to a failed run forever. */
export async function markChargesFailed(propertyIds) {
  if (!propertyIds?.length) return;
  const batch = adminDb.batch();
  for (const propertyId of propertyIds) {
    batch.update(adminDb.collection('propertyCharges').doc(propertyId), {
      status: 'pending',
      runId: null,
    });
  }
  await batch.commit();
}
