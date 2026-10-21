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
import { isVerifiedAgencyMember } from './brandProfileService';

// $200 (or whatever settings/invoicing.pricePerListing is set to) is the
// GST-INCLUSIVE total an agency is charged per property — confirmed
// consistent with the admin settings UI itself (InvoicingSettings.js
// explicitly labels the field "Price per listing (inc GST)" and shows
// the inc/ex breakdown live). Premarket Group Pty Ltd is NOT GST
// registered, so gstRate defaults to 0 — the $200 is $200 ex-GST too,
// $0 GST — and send/route.js tells Xero not to apply any tax (TaxType
// derived from this same rate, never hardcoded). computeChargeAmounts
// below is the one place that does the inc -> ex/GST split; every other
// place that needs the ex-GST or GST component derives it from here
// rather than recomputing independently. If Premarket ever registers
// for GST, update settings/invoicing.gstRate (not this default) so the
// change is deliberate and visible, not a silent code default.
export const DEFAULT_PRICE_PER_LISTING = 200;
export const DEFAULT_GST_RATE = 0;

export async function getInvoicingSettings() {
  const doc = await adminDb.collection('settings').doc('invoicing').get();
  const data = doc.exists ? doc.data() : {};
  return {
    pricePerListing: data.pricePerListing || DEFAULT_PRICE_PER_LISTING,
    gstRate: typeof data.gstRate === 'number' ? data.gstRate : DEFAULT_GST_RATE,
    excludeAgentIds: data.excludeAgentIds || [],
    // null/unset = billing has never been activated — the master
    // switch defaults OFF (see isPropertyBillable below), set only by
    // the dedicated activate-billing admin action, never by deploying
    // code or editing this doc's other fields.
    billingActivatedAt: data.billingActivatedAt || null,
  };
}

// Accepts whatever shape a timestamp happens to be in across this
// codebase: a Firestore Timestamp (has toMillis/toDate), a plain JS
// Date, a serialized {_seconds} (seen e.g. in InvoicingOverview.js),
// or an ISO string. Returns null for anything unusable — callers treat
// "can't tell" the same as "no", never guess yes.
function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * The one rule every charge-creation pathway must agree on: a property
 * is billable only if billing has been explicitly activated (a null
 * billingActivatedAt means never — billing defaults OFF) AND this
 * property was created on or after that activation moment. A property
 * that predates activation is excluded permanently — this same check
 * runs identically whether it's being decided right now (a brand new
 * property) or retroactively (the reconciliation sweep revisiting an
 * old one), so there is no separate "backfill" path that could ever
 * disagree with it.
 */
export function isPropertyBillable(propertyCreatedAt, billingActivatedAt) {
  const activatedMs = toMillis(billingActivatedAt);
  if (activatedMs === null) return false;
  const createdMs = toMillis(propertyCreatedAt);
  if (createdMs === null) return false;
  return createdMs >= activatedMs;
}

// Each agency runs its own rolling 30-day billing cycle rather than
// everyone sharing one fixed calendar day — deliberately not tracked
// as a separate "cycle anchor" doc per agency. Instead it's derived
// statelessly from the charges themselves: an agency becomes "due"
// the moment its OLDEST still-pending charge turns 30 days old, which
// means no charge ever waits longer than 30 days, different agencies
// naturally fall on their own independent cadence (whoever's oldest
// unbilled campaign crosses the line triggers just that agency), and
// nothing needs to be initialised or migrated when a new agency's
// first charge is recorded — the same `propertyCharges` data this
// whole ledger already relies on is the only input.
export const DEFAULT_BILLING_CYCLE_DAYS = 30;

/**
 * Pure — given every currently-pending charge, returns the set of
 * billingEntityKeys that are due for consolidation right now: at
 * least one of that entity's pending charges is `cycleDays` or older.
 * Used by the daily cron (see invoiceRunService.createInvoiceRunFromPendingCharges's
 * `onlyEntityKeys` filter) to decide which agencies to bundle today —
 * the manual "Create Run" admin action deliberately does NOT call
 * this and bundles everything pending on demand instead, so testing
 * never has to wait out a real 30-day cycle.
 */
export function getDueBillingEntityKeys(charges, now = new Date(), cycleDays = DEFAULT_BILLING_CYCLE_DAYS) {
  const nowMs = toMillis(now) ?? Date.now();
  const cycleMs = cycleDays * 24 * 60 * 60 * 1000;
  const oldestByEntity = {};

  for (const charge of charges) {
    const key = charge.billingEntityKey;
    if (!key) continue;
    const createdMs = toMillis(charge.createdAt);
    if (createdMs === null) continue;
    if (oldestByEntity[key] === undefined || createdMs < oldestByEntity[key]) {
      oldestByEntity[key] = createdMs;
    }
  }

  return Object.entries(oldestByEntity)
    .filter(([, oldestMs]) => nowMs - oldestMs >= cycleMs)
    .map(([key]) => key);
}

/**
 * The agency's designated billing contact — who the consolidated
 * invoice actually gets emailed to, overriding whichever agent's
 * charge happened to be grouped first (see invoiceRunService.js). A
 * deliberate admin action (setBillingContact below), never inferred.
 * Returns null if none has been set — callers fall back to the
 * triggering agent's own name/email, today's existing behaviour.
 */
export async function resolveBillingContact(billingEntityKey) {
  if (!billingEntityKey) return null;
  const doc = await adminDb.collection('billingContacts').doc(billingEntityKey).get();
  if (!doc.exists) return null;
  const data = doc.data();
  // status must be the admin-confirmed state — a 'pending' (agent
  // proposed, not yet reviewed) or 'rejected' doc has no `email` field
  // at all by construction (see proposeBillingContact), so the second
  // half of this check is redundant with the first in practice, but
  // kept as defence in depth: this is the one function every invoice
  // send ultimately trusts, so it never returns a contact on anything
  // less than an explicit admin confirmation.
  if (data.status !== 'confirmed' || !data.email) return null;
  return { name: data.name || '', email: data.email, billingName: data.billingName || '' };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin action — designates who an agency's invoices get emailed to,
 * going forward, and the org name its Xero contact is created under
 * (billingName). Works whether or not an agent ever proposed
 * anything first — an admin can always set this directly (e.g. a
 * brand-new agency with no proposal yet) and always wins over
 * whatever an agent proposed, which is why this is the one and only
 * function that ever writes status: 'confirmed'. Wrapped in a
 * transaction purely so the read-then-write (checking for a prior
 * proposal to carry its audit fields forward) is atomic against a
 * concurrent reject/approve of the same key, not because an
 * unconditional admin overwrite needs protecting from itself.
 *
 * Also immediately updates any invoiceRunItems for this entity still
 * sitting at item-level status 'pending' (i.e. in a
 * draft/approved-but-not-yet-sent run) so a correction made before
 * sending takes effect on what's about to be sent, not just future
 * runs — items already sent are financial history and are never
 * touched here. This is purely a display convenience for the admin's
 * draft/approved view: the actual send route (see
 * runs/[runId]/send/route.js) never trusts these stamped fields
 * either way — it always re-resolves resolveBillingContact live,
 * right before creating the Xero contact.
 */
export async function setBillingContact({ billingEntityKey, billingName, name, email, adminUid }) {
  if (!billingEntityKey) throw new Error('billingEntityKey is required');
  if (!email || !EMAIL_RE.test(email)) throw new Error('A valid email is required');

  const ref = adminDb.collection('billingContacts').doc(billingEntityKey);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prior = snap.exists ? snap.data() : {};
    tx.set(ref, {
      billingEntityKey,
      billingEntityType: prior.billingEntityType || 'agency',
      billingEntityName: prior.billingEntityName || null,
      status: 'confirmed',
      billingName: billingName || prior.proposedBillingName || prior.billingName || '',
      name: name || '',
      email,
      setBy: adminUid,
      setAt: FieldValue.serverTimestamp(),
      proposedBy: prior.proposedBy ?? null,
      proposedAt: prior.proposedAt ?? null,
    });
  });

  const pendingItemsSnap = await adminDb
    .collection('invoiceRunItems')
    .where('billingEntityKey', '==', billingEntityKey)
    .where('status', '==', 'pending')
    .get();

  for (const itemDoc of pendingItemsSnap.docs) {
    await itemDoc.ref.update({ agentName: name || '', agentEmail: email });
  }

  return { billingEntityKey, email, updatedOpenItems: pendingItemsSnap.size };
}

/**
 * Agent action — proposes their agency's billing details for review.
 * Never trusts a client-supplied billingEntityKey/Type/Name: every
 * caller of this (see /api/agency/propose-billing-contact) resolves
 * those server-side from the authenticated agent via
 * resolveBillingEntityForAgent below, exactly the same resolution a
 * real charge would use, before this function ever sees them.
 *
 * Rejected with 409 if a proposal is already pending (so one agent
 * can't silently overwrite another's still-unreviewed submission —
 * the first one in holds the slot until an admin acts on it) or if
 * the contact is already confirmed (changes past that point are
 * admin-only, via setBillingContact/rejectBillingContact, never
 * through this path again). Wrapped in a transaction so two agents
 * submitting at nearly the same moment can't both "win" and silently
 * clobber each other.
 */
export async function proposeBillingContact({
  billingEntityKey,
  billingEntityType,
  billingEntityName,
  proposedBillingName,
  proposedName,
  proposedEmail,
  agentUserId,
}) {
  if (!billingEntityKey) throw new Error('billingEntityKey is required');
  if (billingEntityType === 'independent') {
    throw new Error('Independent agents have no separate agency billing contact to propose');
  }
  if (!proposedEmail || !EMAIL_RE.test(proposedEmail)) throw new Error('A valid email is required');

  const ref = adminDb.collection('billingContacts').doc(billingEntityKey);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (data?.status === 'confirmed') {
      const err = new Error("This agency's billing contact is already confirmed — changes require a Premarket admin.");
      err.status = 409;
      throw err;
    }
    if (data?.status === 'pending') {
      const err = new Error('A billing-contact proposal is already pending review for this agency.');
      err.status = 409;
      throw err;
    }
    tx.set(ref, {
      billingEntityKey,
      billingEntityType,
      billingEntityName,
      status: 'pending',
      proposedBillingName: proposedBillingName || '',
      proposedName: proposedName || '',
      proposedEmail,
      proposedBy: agentUserId,
      proposedAt: FieldValue.serverTimestamp(),
    });
    return { billingEntityKey, status: 'pending' };
  });
}

/**
 * Admin action — declines a pending proposal so the agency can submit
 * a corrected one. Transactional for the same reason propose/approve
 * are: safe against a reject racing an approve (or a second reject)
 * for the same key. Keeps the declined submission under
 * previousProposal purely for audit; it is never auto-reused.
 */
export async function rejectBillingContact({ billingEntityKey, reason, adminUid }) {
  if (!billingEntityKey) throw new Error('billingEntityKey is required');
  const ref = adminDb.collection('billingContacts').doc(billingEntityKey);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().status !== 'pending') {
      const err = new Error('No pending proposal for this agency — it may already have been approved or rejected.');
      err.status = 409;
      throw err;
    }
    const data = snap.data();
    tx.set(ref, {
      billingEntityKey,
      billingEntityType: data.billingEntityType,
      billingEntityName: data.billingEntityName,
      status: 'rejected',
      rejectionReason: reason || '',
      rejectedBy: adminUid,
      rejectedAt: FieldValue.serverTimestamp(),
      previousProposal: {
        proposedBillingName: data.proposedBillingName || '',
        proposedName: data.proposedName || '',
        proposedEmail: data.proposedEmail || '',
        proposedBy: data.proposedBy || null,
        proposedAt: data.proposedAt || null,
      },
    });
    return { billingEntityKey, status: 'rejected' };
  });
}

/**
 * Read-only status lookup — powers both the agent-facing prompt
 * (which only needs to know unset/pending/confirmed, see
 * /api/agency/billing-contact-status) and the admin "pending
 * proposals" list. Deliberately never returns the confirmed name/
 * email/billingName unless status is actually 'confirmed' — a
 * still-pending proposal's contents are visible to admins through
 * listPendingBillingContacts, not through this agent-facing shape.
 */
export async function getBillingContactStatus(billingEntityKey) {
  if (!billingEntityKey) return { status: 'unset' };
  const doc = await adminDb.collection('billingContacts').doc(billingEntityKey).get();
  if (!doc.exists) return { billingEntityKey, status: 'unset' };
  const data = doc.data();
  return {
    billingEntityKey,
    status: data.status || 'unset',
    billingEntityName: data.billingEntityName || null,
    proposedBillingName: data.proposedBillingName || null,
    proposedName: data.proposedName || null,
    proposedEmail: data.proposedEmail || null,
    proposedBy: data.proposedBy || null,
    proposedAt: data.proposedAt || null,
    billingName: data.status === 'confirmed' ? data.billingName || null : null,
    name: data.status === 'confirmed' ? data.name || null : null,
    email: data.status === 'confirmed' ? data.email || null : null,
    rejectionReason: data.status === 'rejected' ? data.rejectionReason || null : null,
  };
}

/**
 * Admin-dashboard listing — every agency currently awaiting review,
 * discoverable even before any invoice run exists (a proposal can
 * arrive the moment an agent first sees the dashboard prompt, long
 * before their agency's first 30-day cycle is even due).
 */
export async function listPendingBillingContacts() {
  const snap = await adminDb.collection('billingContacts').where('status', '==', 'pending').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Resolves the billing entity an AUTHENTICATED agent's own charges
 * currently resolve to — the exact same override > brand > pinned >
 * companyName chain resolveChargeForAgent uses for a real charge, so
 * this is provably the right billingEntityKey for them, never a
 * client-supplied one. Read-only: creates nothing, pins nothing.
 * Used by the agency billing-contact endpoints so an agent can only
 * ever act on their own, server-resolved agency.
 */
export async function resolveBillingEntityForAgent(agentUserId) {
  const agentDoc = await adminDb.collection('users').doc(agentUserId).get();
  const agent = agentDoc.exists ? agentDoc.data() : {};
  const override = await resolveBillingOverride(agentUserId);
  return override || resolveAgencyIdentity(agent, agentUserId);
}

/**
 * Finds the agencyBrands entity (if any) that an agent's billing should
 * key off, read-only — never creates, links, or modifies a brand or an
 * agent's agencyBrandId. Two cases, in priority order:
 *
 *   1. The agent has agencyBrandId set AND a VERIFIED agencyMemberships
 *      record for that exact brand (or they are the brand's own
 *      createdBy — the originator needs no separate record). This is
 *      the strongest possible signal: two agents who are both verified
 *      members of the same brand are provably the same real agency,
 *      regardless of what either currently types as companyName.
 *
 * Security history: this function used to ALSO trust a second,
 * weaker signal — any agent whose self-reported companyName exactly
 * matched an existing brand's name was silently treated as that
 * brand's billing entity, with no verification at all. That let any
 * agent type an existing agency's name and be automatically folded
 * into its billing identity — able to see and submit billing-contact
 * proposals for an agency they may have no real connection to. That
 * fallback is removed entirely. agencyBrandId being SET (e.g. from
 * requestAgencyMembership below) still drives branding DISPLAY
 * immediately — that's cosmetic and stays unchanged — but it is no
 * longer enough on its own to affect billing, charges, or who may
 * propose a billing contact. See isVerifiedAgencyMember.
 *
 * Returns { verified, pending }: `verified` is the brand object when
 * membership is confirmed (usable for billing); `pending` is the same
 * brand object when agencyBrandId is set but not yet verified — never
 * usable for billing, but returned so callers can flag it for admin
 * visibility rather than silently dropping the signal.
 */
export async function resolveAgencyBrand(agent, agentUserId) {
  if (!agent.agencyBrandId) return { verified: null, pending: null };

  const brandDoc = await adminDb.collection('agencyBrands').doc(agent.agencyBrandId).get();
  if (!brandDoc.exists) {
    // Dangling reference — don't trust it for anything.
    return { verified: null, pending: null };
  }

  const brand = { id: brandDoc.id, name: brandDoc.data().name };
  const verified = await isVerifiedAgencyMember(agentUserId, agent.agencyBrandId, brandDoc.data());
  return verified ? { verified: brand, pending: null } : { verified: null, pending: brand };
}

/**
 * Pure (no Firestore) — resolves which billing entity a property's
 * charge belongs to. `matchedBrand` (the `verified` brand from
 * resolveAgencyBrand above) is the only way to get billingEntityType
 * 'agency' — consolidation under one Xero contact now REQUIRES a
 * verified membership, never a companyName string match alone.
 *
 * An agent with no verified brand is always billed as `independent` —
 * under their own name, their own charges, never silently grouped with
 * anyone else — even if their companyName happens to match an existing
 * agency's name exactly. `pendingAgencyName` is purely an informational
 * flag (set only when agencyBrandId is set but unverified — i.e. they
 * actually requested/were linked to something, not just a coincidental
 * name match) so admins can find and resolve it; it never affects
 * billingEntityKey/Type itself.
 */
export function resolveBillingEntity({ agentUserId, companyName, firstName, lastName, matchedBrand, pendingAgencyName }) {
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

  if (pendingAgencyName) {
    return {
      billingEntityType: 'independent',
      billingEntityKey: `agent:${agentUserId}`,
      billingEntityName: agentName,
      agencyBrandId: null,
      pendingAgencyName,
    };
  }

  // A companyName with no matching verified (or even pending) brand at
  // all — never grouped with anyone, by design (see this function's
  // own comment). trimmedCompany is kept only as part of their display
  // name, exactly like an independent agent with no company at all.
  return {
    billingEntityType: 'independent',
    billingEntityKey: `agent:${agentUserId}`,
    billingEntityName: agentName,
    agencyBrandId: null,
  };
}

/**
 * Admin override — an admin's explicit decision that a specific agent
 * bills under a different entity than brand/companyName resolution
 * would otherwise give them (see mergeIntoBillingEntity below, and the
 * "Possible Duplicate Agencies" admin UI that calls it). Read-only
 * here; never written except through that one function. Checked first
 * by resolveChargeForAgent, ahead of agencyBrandId and companyName.
 */
export async function resolveBillingOverride(agentUserId) {
  const doc = await adminDb.collection('billingAgencyOverrides').doc(agentUserId).get();
  if (!doc.exists) return null;
  const data = doc.data();
  return {
    billingEntityType: 'agency',
    billingEntityKey: data.billingEntityKey,
    billingEntityName: data.billingEntityName,
    agencyBrandId: data.agencyBrandId || null,
  };
}

/**
 * Admin action — "these agents are actually the same agency," without
 * touching branding or companyName at all. Writes a
 * billingAgencyOverrides/{agentUserId} doc for each agent in
 * `agentUserIds`, pointing their FUTURE charges at
 * `targetBillingEntityKey`/`targetBillingEntityName` (normally one of
 * the two entities a duplicate-detection pair already resolved to —
 * see findPossibleDuplicateAgencies). Deliberately does not touch any
 * already-recorded charge (those keep the billing entity they were
 * actually recorded under — financial history is never silently
 * rewritten) or any agencyBrands/agencyBrandId data (branding
 * assignments are a completely separate concern, per the "without
 * changing their branding" requirement this exists to satisfy).
 */
export async function mergeIntoBillingEntity({ agentUserIds, targetBillingEntityKey, targetBillingEntityName, adminUid, reason }) {
  if (!agentUserIds?.length) throw new Error('At least one agentUserId is required');
  if (!targetBillingEntityKey || !targetBillingEntityName) throw new Error('A target billing entity is required');

  const batch = adminDb.batch();
  for (const agentUserId of agentUserIds) {
    batch.set(adminDb.collection('billingAgencyOverrides').doc(agentUserId), {
      agentUserId,
      billingEntityKey: targetBillingEntityKey,
      billingEntityName: targetBillingEntityName,
      setBy: adminUid,
      setAt: FieldValue.serverTimestamp(),
      reason: reason || null,
    });
  }
  await batch.commit();

  return { merged: agentUserIds.length, billingEntityKey: targetBillingEntityKey };
}

/** Pure (no Firestore) — normalises a company/agency name the same way
 * findBrandByExactName compares names (trim, lower-case), plus
 * stripping punctuation so "Harcourts Pty. Ltd." and "Harcourts Pty
 * Ltd" compare the same. Used only for the admin-facing "possible
 * duplicate agencies" suggestion below — never to automatically group
 * billing, which no longer happens from companyName text alone at
 * all (see resolveBillingEntity). */
function normalizeAgencyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pure (no Firestore) — a deliberately simple, explainable heuristic
 * for "might this be the same real agency, spelled differently,"
 * never a fuzzy-matching library. Two names are flagged as possibly
 * the same agency when, after normalising:
 *   - they're identical (callers only ever compare names from DIFFERENT
 *     billing entities, so two groups already sharing a normalised
 *     name would mean something else is wrong — not this function's
 *     job to catch), or
 *   - one is wholly contained in the other ("Harcourts" inside
 *     "Harcourts Property Hub" — a common abbreviation pattern), or
 *   - they share the same first word, at least 3 characters long (two
 *     different-looking names for what's likely the same brand
 *     prefix, e.g. "Harcourts Prop Hub" / "Harcourts Pty Ltd").
 * Known limitation, deliberately not solved here: two names with no
 * shared prefix or substring at all (e.g. "HPH" vs "Harcourts Property
 * Hub") will never be flagged — that case still needs a human to
 * notice, same as before this feature existed.
 */
export function namesLikelySameAgency(nameA, nameB) {
  const a = normalizeAgencyName(nameA);
  const b = normalizeAgencyName(nameB);
  if (!a || !b || a === b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const firstWordA = a.split(' ')[0];
  const firstWordB = b.split(' ')[0];
  return firstWordA.length >= 3 && firstWordA === firstWordB;
}

/**
 * Scans every agent (users with 'agent' in their roles) and resolves
 * each one's CURRENT billing entity exactly as a real charge would
 * (brand -> companyName fallback -> independent, including any
 * existing override), then looks for pairs of DIFFERENT entities whose
 * names look like they might be the same real agency
 * (namesLikelySameAgency). Read-only — never merges, verifies, or
 * links anything itself; the admin UI calls mergeIntoBillingEntity
 * (or the agency-membership approval flow) separately once a human
 * has reviewed and confirmed a pair really is a duplicate.
 *
 * Deliberately groups by raw, normalised companyName text directly —
 * NOT by resolveBillingEntity/resolveAgencyBrand's actual (now
 * verification-gated) billing resolution. Those two concerns are
 * different on purpose: real billing must never trust a bare
 * companyName match, but an admin-only DISCOVERY tool, which writes
 * nothing and grants no trust by itself, is exactly where that same
 * signal is still useful — it's how an admin finds candidates to
 * manually verify in the first place, now that nothing does this
 * automatically any more.
 *
 * Scoped to agents only (roles array-contains 'agent'), not every user
 * — buyers/homeowners never have a billing entity to begin with.
 */
export async function findPossibleDuplicateAgencies() {
  const snap = await adminDb.collection('users').where('roles', 'array-contains', 'agent').get();
  const agents = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.companyName && a.companyName.trim());

  const groups = {};
  for (const agent of agents) {
    const override = await resolveBillingOverride(agent.id);
    const key = override ? override.billingEntityKey : `agency:${agent.companyName.trim().toLowerCase()}`;
    const name = override ? override.billingEntityName : agent.companyName.trim();

    groups[key] = groups[key] || { billingEntityKey: key, billingEntityName: name, agents: [] };
    groups[key].agents.push({
      agentUserId: agent.id,
      agentName: `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || 'Unknown agent',
      companyName: agent.companyName.trim(),
    });
  }

  const groupList = Object.values(groups);
  const possibleDuplicates = [];
  for (let i = 0; i < groupList.length; i++) {
    for (let j = i + 1; j < groupList.length; j++) {
      if (namesLikelySameAgency(groupList[i].billingEntityName, groupList[j].billingEntityName)) {
        possibleDuplicates.push({ groupA: groupList[i], groupB: groupList[j] });
      }
    }
  }
  return possibleDuplicates;
}

/** Pure (no Firestore) — the three amounts a single property's charge
 * carries, derived once from the price/GST in force at charge time.
 * `pricePerListing` is GST-INCLUSIVE (see the module-level comment
 * above) — this backs the ex-GST subtotal and GST component out of it,
 * never the other way around. */
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
 * Read-only. Looks for this agent's own oldest prior charge (if any)
 * that was itself resolved via companyName — never one that was
 * brand- or override-based, since those stay live/dynamic and must
 * keep tracking whatever the agent's current brand/override actually
 * is, not freeze onto a stale snapshot. A plain equality `where` on
 * agentUserId needs no composite index, so this never requires a
 * separate Firestore index deploy.
 *
 * `limit(1)` with no `orderBy` is deliberate and safe here, not just
 * convenient: billing has never been activated for any real agency
 * yet (billingActivatedAt is still null as of this fix), so there is
 * zero pre-existing charge history anywhere that this fix could ever
 * see as "inconsistent" — from the very first real charge onward,
 * every charge resolveAgencyIdentity pins will already agree with
 * every other one for that agent, by construction.
 */
async function resolvePinnedCompanyNameEntity(agentUserId) {
  // No .limit() here deliberately — not every Firestore query builder
  // in this codebase's test fakes chains .limit() after .where() the
  // same way, and a plain equality query over one agent's own (small)
  // charge history costs nothing extra to read in full and pick the
  // first doc from in JS instead.
  const snap = await adminDb
    .collection('propertyCharges')
    .where('agentUserId', '==', agentUserId)
    .get();

  if (snap.empty || snap.docs.length === 0) return null;
  const prior = snap.docs[0].data();
  if (prior.agencyBrandId) return null; // was brand-based — not ours to pin
  if (!prior.billingEntityKey) return null;

  return {
    billingEntityType: prior.billingEntityType,
    billingEntityKey: prior.billingEntityKey,
    billingEntityName: prior.billingEntityName,
    agencyBrandId: null,
  };
}

/**
 * Decides which billing entity a NEW charge resolves to, when no
 * admin override exists (resolveChargeForAgent checks that first).
 * Three tiers, most to least authoritative:
 *
 *   1. A real agencyBrandId — always checked fresh, always wins when
 *      present. Getting a brand is a deliberate, server-validated
 *      action (see brandProfileService.js / /api/branding/confirm),
 *      never something a plain profile edit can trigger, so it's
 *      trusted completely, same as before this fix.
 *
 *   2. This agent's own PINNED prior billing entity, if they've ever
 *      had a companyName-based charge before. This is the fix: once
 *      an agent's first charge resolves to entity X via whatever
 *      companyName they had at that moment, every later charge stays
 *      pinned to X — even if they rename companyName afterwards,
 *      even to a name that would otherwise resolve to some OTHER
 *      agency's existing entity. A companyName edit can no longer
 *      silently redirect an agent's charges onto a different agency's
 *      invoice, which is exactly the risk this fix closes.
 *
 *   3. A fresh companyName resolution — only ever reached for an
 *      agent's very first charge, when no brand and no prior history
 *      exist yet. Identical to this codebase's original behaviour.
 *
 * Preserves agency branding and every existing agent-facing flow
 * untouched: nothing about getting/having a brand, or about editing
 * companyName in dashboard/settings, changes at all. This only
 * changes which billing entity a later charge resolves to when that
 * agent has no brand and has been charged before.
 */
async function resolveAgencyIdentity(agent, agentUserId) {
  const { verified: matchedBrand, pending: pendingBrand } = await resolveAgencyBrand(agent, agentUserId);
  if (matchedBrand) {
    return resolveBillingEntity({
      agentUserId,
      companyName: agent.companyName,
      firstName: agent.firstName,
      lastName: agent.lastName,
      matchedBrand,
    });
  }

  const pinned = await resolvePinnedCompanyNameEntity(agentUserId);
  if (pinned) return pinned;

  return resolveBillingEntity({
    agentUserId,
    companyName: agent.companyName,
    firstName: agent.firstName,
    lastName: agent.lastName,
    matchedBrand: null,
    pendingAgencyName: pendingBrand?.name || null,
  });
}

/**
 * Looks up everything needed to build a charge for a given agent
 * (their user doc, current invoicing settings, and their resolved
 * billing entity/brand) and, unless they're on the exclusion list OR
 * this property predates billing activation (see isPropertyBillable),
 * returns the exact document a charge for them should contain. Shared
 * by recordPropertyCharge (retroactive — property already exists) and
 * createPropertyAndChargeAtomically (property is being created right
 * now) so the two never drift into computing a charge's shape — or
 * deciding eligibility — differently depending on which path recorded
 * it. This is the one and only place that decision is made.
 *
 * `propertyCreatedAt` is required: pass the property's real createdAt
 * for a retroactive call, or `new Date()` for a brand new property
 * being created in this same call (its real serverTimestamp will
 * resolve to effectively the same instant).
 *
 * Returns null if this charge should not be created at all — on the
 * exclusion list, or the property predates billing activation —
 * callers treat that as "create/leave the property, skip the charge,"
 * never as an error.
 */
async function resolveChargeForAgent({ propertyId, propertyAddress, agentUserId, propertyCreatedAt }) {
  const [agentDoc, settings] = await Promise.all([
    adminDb.collection('users').doc(agentUserId).get(),
    getInvoicingSettings(),
  ]);
  const agent = agentDoc.exists ? agentDoc.data() : {};

  if (!isPropertyBillable(propertyCreatedAt, settings.billingActivatedAt)) {
    return null;
  }

  if (settings.excludeAgentIds.includes(agentUserId)) {
    return null;
  }

  // Priority, most to least authoritative — see resolveAgencyIdentity's
  // own comment for why pinned history sits between brand and a fresh
  // companyName resolution, not above brand or below override.
  // An admin's explicit "these are the same agency" merge (see
  // mergeIntoBillingEntity below) always wins over everything else —
  // it exists specifically for the case neither brand nor companyName
  // can bridge (two genuinely different-looking company names, neither
  // with a brand). Checked first so there's only ever one code path
  // that decides an agent's billing group.
  const override = await resolveBillingOverride(agentUserId);
  const entity = override || await resolveAgencyIdentity(agent, agentUserId);
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
    propertyCreatedAt: property.createdAt,
  });
  if (!chargeData) return { created: false, reason: 'not-billable' };

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
      // This property doesn't exist yet — its real createdAt will
      // resolve via FieldValue.serverTimestamp() to effectively this
      // same instant, which is what matters for the billing-cutoff
      // check (see isPropertyBillable).
      propertyCreatedAt: new Date(),
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
/**
 * How many of an agent's charges are currently held back from every
 * invoice run (see invoiceRunService.createInvoiceRunFromPendingCharges's
 * pendingAgencyName filter) because their agency membership is
 * unresolved. Read-only — purely for admin visibility (surfaced next
 * to each pending membership in the admin UI), never affects which
 * charges actually get held; that's decided solely by the
 * pendingAgencyName flag already stamped on each charge.
 */
export async function countHeldChargesForAgent(agentUserId) {
  if (!agentUserId) return 0;
  const snap = await adminDb
    .collection('propertyCharges')
    .where('agentUserId', '==', agentUserId)
    .where('status', '==', 'pending')
    .get();
  return snap.docs.filter((d) => !!d.data().pendingAgencyName).length;
}

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
