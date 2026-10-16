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
import { findBrandByExactName } from './brandProfileService';

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
 * Finds the agencyBrands entity (if any) that an agent's billing should
 * key off, read-only — never creates, links, or modifies a brand or an
 * agent's agencyBrandId. Two cases, in priority order:
 *
 *   1. The agent already has agencyBrandId set (they explicitly created
 *      or joined a brand — see brandProfileService.js) and that brand
 *      still exists. This is the strongest possible signal: two agents
 *      who share this ID are provably the same agency regardless of
 *      what either currently types as companyName, which is exactly
 *      what lets billing survive differently-spelled company names.
 *
 *   2. The agent has NOT set agencyBrandId, but their companyName
 *      exactly matches (case/whitespace-insensitive — same rule
 *      findBrandByExactName and linkExistingBrand already use) a brand
 *      another agent at the same company already created. Without this
 *      fallback, agent A (who set up the brand) and agent B (same
 *      company, never visited the branding page) would silently split
 *      into two billing groups the moment A's billing switched to
 *      keying off the brand ID — a regression this fallback exists
 *      specifically to prevent. B is NOT auto-linked to the brand by
 *      this (their agencyBrandId is never written here); their billing
 *      just resolves to the same group as if they had been.
 *
 * Returns null (fall back to plain companyName grouping) if neither
 * applies — most agencies today have no brand at all.
 */
export async function resolveAgencyBrand(agent) {
  if (agent.agencyBrandId) {
    const brandDoc = await adminDb.collection('agencyBrands').doc(agent.agencyBrandId).get();
    if (brandDoc.exists) {
      return { id: brandDoc.id, name: brandDoc.data().name };
    }
    // agencyBrandId points at a brand that no longer exists — don't
    // trust a dangling reference; fall through to the companyName path
    // below exactly as if agencyBrandId had never been set.
  }

  if (agent.companyName) {
    const match = await findBrandByExactName(agent.companyName);
    if (match) return { id: match.id, name: match.name };
  }

  return null;
}

/**
 * Pure (no Firestore) — resolves which billing entity a property's
 * charge belongs to. `matchedBrand` (from resolveAgencyBrand above) is
 * the primary signal when present — two agents with the same brand
 * always consolidate, regardless of how differently they each spell
 * their companyName. Only when no brand applies at all does this fall
 * back to companyName, normalised (trimmed, lower-cased) the same way
 * findBrandByExactName itself matches — so even in the no-brand case,
 * "Harcourts Property Hub" and "harcourts property hub " still land in
 * the same group, just without a stable ID behind it.
 *
 * An agent with no companyName and no matched brand is genuinely
 * independent — billed individually, under their own name, never
 * grouped with anyone else.
 */
export function resolveBillingEntity({ agentUserId, companyName, firstName, lastName, matchedBrand }) {
  const trimmedCompany = String(companyName || '').trim();
  const agentName = `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown agent';

  if (matchedBrand?.id) {
    return {
      billingEntityType: 'agency',
      billingEntityKey: `brand:${matchedBrand.id}`,
      billingEntityName: matchedBrand.name || trimmedCompany || 'Unknown agency',
      agencyBrandId: matchedBrand.id,
    };
  }

  if (!trimmedCompany) {
    return {
      billingEntityType: 'independent',
      billingEntityKey: `agent:${agentUserId}`,
      billingEntityName: agentName,
      agencyBrandId: null,
    };
  }

  return {
    billingEntityType: 'agency',
    billingEntityKey: `agency:${trimmedCompany.toLowerCase()}`,
    billingEntityName: trimmedCompany,
    agencyBrandId: null,
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
 * Looks up everything needed to build a charge for a given agent
 * (their user doc, current invoicing settings, and their resolved
 * billing entity/brand) and, unless they're on the exclusion list,
 * returns the exact document a charge for them should contain. Shared
 * by recordPropertyCharge (retroactive — property already exists) and
 * createPropertyAndChargeAtomically (property is being created right
 * now) so the two never drift into computing a charge's shape
 * differently depending on which path recorded it.
 *
 * Returns null if this agent should not be charged at all (on the
 * exclusion list) — callers treat that as "create the property, skip
 * the charge," never as an error.
 */
async function resolveChargeForAgent({ propertyId, propertyAddress, agentUserId }) {
  const [agentDoc, settings] = await Promise.all([
    adminDb.collection('users').doc(agentUserId).get(),
    getInvoicingSettings(),
  ]);
  const agent = agentDoc.exists ? agentDoc.data() : {};

  if (settings.excludeAgentIds.includes(agentUserId)) {
    return null;
  }

  const matchedBrand = await resolveAgencyBrand(agent);
  const entity = resolveBillingEntity({
    agentUserId,
    companyName: agent.companyName,
    firstName: agent.firstName,
    lastName: agent.lastName,
    matchedBrand,
  });
  const amounts = computeChargeAmounts(settings.pricePerListing, settings.gstRate);

  return {
    propertyId,
    propertyAddress: propertyAddress || 'Unknown address',
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
}

/**
 * Records a charge for a property that already exists, if one doesn't
 * already exist for it. Safe to call more than once — every call
 * after the first is a no-op. This is the RETROACTIVE path: use
 * createPropertyAndChargeAtomically instead when creating a brand new
 * property, which gives a strictly stronger atomicity guarantee (see
 * its own comment) than this function's get-then-create ever can for
 * that case.
 *
 * Used by: the client-side dashboard/add flow's follow-up API call
 * (the property was created by the browser's own Firestore SDK, so
 * there's no transaction available to that caller at all), the
 * monthly run's reconciliation sweep, and the manual ad-hoc agency
 * invoice endpoint — all three are "this property exists, does it
 * have a charge yet?" scenarios, never "create both right now."
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

  const chargeData = await resolveChargeForAgent({
    propertyId,
    propertyAddress: property.address || property.formattedAddress,
    agentUserId,
  });
  if (!chargeData) return { created: false, reason: 'agent-excluded' };

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
 * Creates a brand new property document AND its first charge in the
 * same Firestore transaction — the property either ends up billed or
 * it doesn't exist at all; there is no state where it was created but
 * the charge silently failed to follow. This is strictly possible
 * here (and not for the client-side dashboard/add flow, which creates
 * the property via the browser's Firestore SDK and has no write
 * access to propertyCharges at all per firestore.rules) because both
 * writes happen server-side, in the same call.
 *
 * Used by the two fully server-side creation paths:
 * propertyScrapeService.js (SMS-created listings) and the AgentBox/Rex
 * import routes. Pass `skipCharge: true` for a demo-mode import (sample
 * data, never billable) — the property is still created normally,
 * just with no charge attached, same as any excluded agent.
 *
 * The agent/settings/brand lookups that decide the charge's contents
 * happen BEFORE the transaction (plain reads, not `tx.get()`) — a tiny
 * staleness window between that read and the transaction's commit is
 * immaterial for a price/GST snapshot, and keeping the transaction
 * itself write-only (no reads) avoids any read-after-write ordering
 * constraint entirely. The property ID is always freshly generated
 * (`.doc()` with no argument) specifically so there is no existing
 * charge to race against — unlike recordPropertyCharge, this never
 * needs a get-before-create idempotency check, by construction.
 *
 * Returns { propertyId, charged }.
 */
export async function createPropertyAndChargeAtomically(propertyData, { skipCharge = false } = {}) {
  const propRef = adminDb.collection('properties').doc();
  const chargeRef = adminDb.collection('propertyCharges').doc(propRef.id);
  const agentUserId = propertyData.userId || propertyData.uid;

  let chargeData = null;
  if (!skipCharge && agentUserId) {
    chargeData = await resolveChargeForAgent({
      propertyId: propRef.id,
      propertyAddress: propertyData.address || propertyData.formattedAddress,
      agentUserId,
    });
  } else if (!skipCharge) {
    console.warn(`createPropertyAndChargeAtomically: property ${propRef.id} has no agent userId — created without a charge`);
  }

  await adminDb.runTransaction(async (tx) => {
    tx.set(propRef, propertyData);
    if (chargeData) tx.set(chargeRef, chargeData);
  });

  return { propertyId: propRef.id, charged: !!chargeData };
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
 * The actual "detect and recover" mechanism for the one creation path
 * that can't use createPropertyAndChargeAtomically's transaction — the
 * client-side dashboard/add flow, which creates the property via the
 * browser's own Firestore SDK (no write access to propertyCharges at
 * all, let alone a transaction spanning both) and then makes a
 * best-effort server call to record its charge. If that call never
 * arrives (closed tab, network failure), this is what notices and
 * fixes it — not a transaction, because none is possible across that
 * client/server boundary; a sweep-and-reconcile is the mechanism
 * "appropriate to the existing architecture" here instead.
 *
 * Called from two places: before every monthly invoice run (so nothing
 * pending is ever missed before billing happens), and by its own
 * dedicated, much more frequent cron
 * (api/cron/reconcile-property-charges) so a gap is caught within
 * roughly an hour rather than potentially sitting unbilled until the
 * next monthly run.
 *
 * Scans the whole properties collection — fine at this project's
 * current scale (every property is one cheap existence check against
 * propertyCharges, and most already have one and short-circuit with no
 * write). If that collection grows very large, narrow this to
 * properties created since the last successful sweep instead of a full
 * scan every time.
 */
export async function reconcileMissingCharges() {
  const propertiesSnap = await adminDb.collection('properties').get();
  const properties = propertiesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return ensureChargesForProperties(properties);
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
