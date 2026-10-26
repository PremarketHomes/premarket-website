// Billing — the charge ledger.
//
// One `propertyCharges/{propertyId}` document is ever created per
// property, the moment that property is successfully created (its
// private buyer link is live from that same instant — see
// dashboard/add/page.js and the AgentBox/Rex import routes, the three
// places a NEW property document is created).
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
 * Admin action — designates who THIS INDIVIDUAL AGENT's invoices get
 * emailed to, going forward, and the org name their Xero contact is
 * created under (billingName). Works whether or not the agent ever
 * proposed anything first — an admin can always set this directly —
 * and always wins over whatever was proposed, which is why this is
 * the one and only function that ever writes status: 'confirmed'.
 * Wrapped in a transaction purely so the read-then-write (checking
 * for a prior proposal to carry its audit fields forward) is atomic
 * against a concurrent reject/approve of the same key, not because
 * an unconditional admin overwrite needs protecting from itself.
 *
 * billingEntityKey is always exclusively this one agent's own
 * `agent:{uid}` — confirming it can never affect, merge with, or
 * borrow from any other agent's charges, invoices, or billing cycle,
 * even one sharing the same agency name, branding, or billing email.
 *
 * Also immediately updates any invoiceRunItems for this agent still
 * sitting at item-level status 'pending' (i.e. in a
 * draft/approved-but-not-yet-sent run) so a correction made before
 * sending takes effect on what's about to be sent, not just future
 * runs — items already sent are financial history and are never
 * touched here. This is purely a display convenience for the admin's
 * draft/approved view: the actual send route (see
 * runs/[runId]/send/route.js) never trusts these stamped fields
 * either way — it always re-resolves resolveBillingContact live,
 * right before creating the Xero contact.
 *
 * Also the one function that approves an AMENDMENT (see
 * proposeBillingContact's `changeRequest` branch, used by the agent's
 * Account Settings "Edit Billing Details" flow) — called with exactly
 * the same shape either way, since the admin always supplies the
 * final name/email/billingName to confirm regardless of where they
 * came from. Approving one always clears any changeRequest on the
 * doc (the full `.set()` below omits it), since it's now fully
 * superseded by this confirmation — never left dangling as "still
 * pending" after its own approval.
 *
 * `expectedVersion`, when supplied, guards against approving a STALE
 * submission: proposeBillingContact bumps `version` by 1 on every
 * single submission (initial or amendment), so if the agent edits
 * their request again after the admin loaded it for review but
 * before clicking Approve, the doc's current version will have moved
 * on. Checked inside this same transaction so it's race-free against
 * a submission landing concurrently with the approval itself — not
 * just a UI-level staleness hint. Mismatched ⇒ 409, nothing is
 * written, and the admin must refresh to see the newer request
 * before deciding again. Omit it only for a direct admin-initiated
 * set with no proposal being reviewed at all.
 */
export async function setBillingContact({ billingEntityKey, billingName, name, email, adminUid, expectedVersion }) {
  if (!billingEntityKey) throw new Error('billingEntityKey is required');
  if (!email || !EMAIL_RE.test(email)) throw new Error('A valid email is required');

  const ref = adminDb.collection('billingContacts').doc(billingEntityKey);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prior = snap.exists ? snap.data() : {};

    if (expectedVersion != null && prior.version !== expectedVersion) {
      const err = new Error('This request has changed since you reviewed it — please refresh and try again.');
      err.status = 409;
      throw err;
    }

    tx.set(ref, {
      billingEntityKey,
      billingEntityType: prior.billingEntityType || (billingEntityKey.startsWith('office:') ? 'office' : 'independent'),
      billingEntityName: prior.billingEntityName || null,
      status: 'confirmed',
      billingName: billingName || prior.changeRequest?.proposedBillingName || prior.proposedBillingName || prior.billingName || '',
      name: name || '',
      email,
      setBy: adminUid,
      setAt: FieldValue.serverTimestamp(),
      proposedBy: prior.proposedBy ?? null,
      proposedAt: prior.proposedAt ?? null,
      version: prior.version ?? null,
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
 * Agent action — proposes their OWN billing details for review.
 * Never trusts a client-supplied billingEntityKey/Type/Name: every
 * caller of this (see /api/agency/propose-billing-contact) resolves
 * those server-side from the authenticated agent via
 * resolveBillingEntityForAgent below, exactly the same resolution a
 * real charge would use, before this function ever sees them — so
 * billingEntityKey is always this agent's own exclusive `agent:{uid}`.
 *
 * Two modes, chosen purely by the doc's CURRENT status:
 *
 *   1. Not yet confirmed (unset/pending/rejected) — the initial
 *      confirmation workflow, unchanged: overwrites the top-level
 *      status and proposed-name/email fields directly. There is no
 *      one else who could ever collide on this key (unlike the old
 *      agency-grouping model this replaces), so a second submission
 *      from the same agent while still pending simply updates it —
 *      no 409, no "first one in holds the slot" semantics needed.
 *
 *   2. Already confirmed — the AMENDMENT workflow (the agent's
 *      Account Settings "Edit Billing Details" flow). The active,
 *      previously-approved billingName/name/email/status fields are
 *      left completely untouched — still fully valid for every charge
 *      and invoice send in the meantime — and the proposed change is
 *      attached ONLY as `changeRequest`, a separate pending record a
 *      superAdmin reviews via the exact same approve/reject actions
 *      (setBillingContact/rejectBillingContact). Only approving it
 *      ever promotes changeRequest's values into the active contact.
 *      Submitting again while a changeRequest is already pending
 *      simply replaces it — same no-collision reasoning as mode 1.
 *
 * Every call bumps `version` by 1, regardless of which mode — the
 * one thing setBillingContact/rejectBillingContact's `expectedVersion`
 * check needs to tell an outdated review decision apart from a
 * current one, so a newer edit here can never be silently overwritten
 * by an admin action that was based on an older submission.
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
  if (!proposedEmail || !EMAIL_RE.test(proposedEmail)) throw new Error('A valid email is required');

  const ref = adminDb.collection('billingContacts').doc(billingEntityKey);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const nextVersion = (data?.version || 0) + 1;

    if (data?.status === 'confirmed') {
      tx.set(ref, {
        ...data,
        version: nextVersion,
        changeRequest: {
          proposedBillingName: proposedBillingName || '',
          proposedName: proposedName || '',
          proposedEmail,
          proposedBy: agentUserId,
          proposedAt: FieldValue.serverTimestamp(),
          status: 'pending',
          version: nextVersion,
        },
      });
      return { billingEntityKey, status: 'confirmed', changeRequestStatus: 'pending', version: nextVersion };
    }

    tx.set(ref, {
      billingEntityKey,
      billingEntityType,
      billingEntityName,
      status: 'pending',
      version: nextVersion,
      proposedBillingName: proposedBillingName || '',
      proposedName: proposedName || '',
      proposedEmail,
      proposedBy: agentUserId,
      proposedAt: FieldValue.serverTimestamp(),
    });
    return { billingEntityKey, status: 'pending', version: nextVersion };
  });
}

/**
 * Admin action — declines a pending proposal OR a pending amendment
 * (changeRequest) so the agent can submit a corrected one.
 * Transactional for the same reason propose/approve are: safe against
 * a reject racing an approve (or a second reject) for the same key.
 *
 * Two modes:
 *
 *   1. A pending changeRequest on an already-CONFIRMED contact —
 *      rejecting it marks ONLY the changeRequest itself rejected
 *      (with the reason, for the agent to see). The active
 *      billingName/name/email/status fields are left byte-for-byte
 *      as they were; the previously-approved contact keeps invoicing
 *      exactly as before. The agent can submit another changeRequest
 *      afterwards (see proposeBillingContact).
 *
 *   2. The original initial-confirmation proposal (status 'pending',
 *      never yet confirmed) — unchanged: flips status to 'rejected'
 *      so the agent can resubmit from scratch.
 *
 * Either way, keeps the declined submission under
 * previousProposal/changeRequest purely for audit; it is never
 * auto-reused.
 *
 * `expectedVersion`, when supplied, guards against rejecting a STALE
 * submission — same optimistic-lock reasoning as setBillingContact's
 * own `expectedVersion`: if the agent has edited their request again
 * since the admin loaded it, this rejects with 409 rather than
 * discarding a newer submission the admin never actually saw.
 */
export async function rejectBillingContact({ billingEntityKey, reason, adminUid, expectedVersion }) {
  if (!billingEntityKey) throw new Error('billingEntityKey is required');
  const ref = adminDb.collection('billingContacts').doc(billingEntityKey);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;

    if (data?.status === 'confirmed' && data.changeRequest?.status === 'pending') {
      if (expectedVersion != null && data.version !== expectedVersion) {
        const err = new Error('This request has changed since you reviewed it — please refresh and try again.');
        err.status = 409;
        throw err;
      }
      tx.set(ref, {
        ...data,
        changeRequest: {
          ...data.changeRequest,
          status: 'rejected',
          rejectionReason: reason || '',
          rejectedBy: adminUid,
          rejectedAt: FieldValue.serverTimestamp(),
        },
      });
      return { billingEntityKey, status: 'confirmed', changeRequestStatus: 'rejected' };
    }

    if (!data || data.status !== 'pending') {
      const err = new Error('No pending proposal for this agency — it may already have been approved or rejected.');
      err.status = 409;
      throw err;
    }
    if (expectedVersion != null && data.version !== expectedVersion) {
      const err = new Error('This request has changed since you reviewed it — please refresh and try again.');
      err.status = 409;
      throw err;
    }
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
 * Read-only status lookup — powers both the agent-facing prompt/
 * Account Settings billing section (see /api/agency/billing-contact-
 * status) and the admin "pending proposals" list. Deliberately never
 * returns the confirmed name/email/billingName unless status is
 * actually 'confirmed' — a still-pending INITIAL proposal's contents
 * are visible to admins through listPendingBillingContacts, not
 * through this agent-facing shape.
 *
 * `changeRequest`, when present, is returned as-is (status pending/
 * rejected, plus its own proposed* fields and rejectionReason) so the
 * agent's own Account Settings page can show "a change is pending
 * review" or "your last change was rejected: ..." ALONGSIDE their
 * still-fully-active confirmed contact — never instead of it.
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
    changeRequest: data.status === 'confirmed' && data.changeRequest ? data.changeRequest : null,
  };
}

/**
 * Admin-dashboard listing — every agent currently awaiting review,
 * discoverable even before any invoice run exists (a proposal can
 * arrive the moment an agent first sees the dashboard prompt, long
 * before their own first 30-day cycle is even due). One row per
 * agent, never grouped.
 *
 * Surfaces TWO distinct kinds of pending review, in the one shared
 * shape BillingContactsPanel.js already expects (billingEntityName/
 * proposedBillingName/proposedName/proposedEmail) so the existing
 * admin approve/reject actions work unchanged either way:
 *
 *   1. A brand-new, never-confirmed proposal (status 'pending').
 *   2. An AMENDMENT (changeRequest.status 'pending') on an agent
 *      whose contact is already confirmed — flagged `isChangeRequest`
 *      so the admin UI can show it's a change, not a first-time
 *      submission, alongside the currently-active contact for
 *      context (current*). Approving/rejecting these goes through
 *      the exact same setBillingContact/rejectBillingContact actions,
 *      keyed by the same billingEntityKey — those functions already
 *      know how to tell the two cases apart.
 *
 * Scans every doc rather than a single `where` — needed because an
 * amendment's "pending" signal lives on a nested field
 * (changeRequest.status), not the top-level status Firestore would
 * otherwise let this filter on directly. Fine at this project's scale
 * (same reasoning as every other admin-only full-collection scan in
 * this codebase).
 */
export async function listPendingBillingContacts() {
  const snap = await adminDb.collection('billingContacts').get();
  const results = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.status === 'pending') {
      results.push({ id: doc.id, ...data, isChangeRequest: false });
      continue;
    }
    if (data.status === 'confirmed' && data.changeRequest?.status === 'pending') {
      results.push({
        id: doc.id,
        billingEntityKey: data.billingEntityKey,
        billingEntityType: data.billingEntityType,
        billingEntityName: data.billingEntityName,
        isChangeRequest: true,
        version: data.version,
        currentBillingName: data.billingName || null,
        currentName: data.name || null,
        currentEmail: data.email || null,
        proposedBillingName: data.changeRequest.proposedBillingName,
        proposedName: data.changeRequest.proposedName,
        proposedEmail: data.changeRequest.proposedEmail,
        proposedBy: data.changeRequest.proposedBy,
        proposedAt: data.changeRequest.proposedAt,
      });
    }
  }
  return results;
}

/**
 * Resolves the billing entity an AUTHENTICATED agent's own charges
 * currently resolve to. Read-only: creates nothing. Used by the
 * agency billing-contact endpoints so an agent can only ever act on
 * their own, server-resolved identity.
 *
 * Under the UID-only billing model this is deliberately trivial —
 * every agent is their own independent billing account, keyed
 * exclusively by their Firebase UID (`agent:{uid}`), regardless of
 * agencyName, agencyBrandId, or billing email. There is no agency
 * grouping, brand matching, or company-name resolution left in this
 * path at all — see resolveBillingEntity's own comment for why.
 */
export async function resolveBillingEntityForAgent(agentUserId) {
  const agentDoc = await adminDb.collection('users').doc(agentUserId).get();
  return resolveBillingEntityForAgentDoc(agentUserId, agentDoc.exists ? agentDoc.data() : {});
}

async function loadActiveOffice(officeId) {
  if (!officeId) return null;
  const officeDoc = await adminDb.collection('officeAdminInfo').doc(officeId).get();
  if (!officeDoc.exists || officeDoc.data().status !== 'active') return null;
  const data = officeDoc.data();
  return { officeId, officeName: data.name || '', officeAdminUids: data.officeAdminUids || [] };
}

// Server-only record (default-deny in firestore.rules) of an agent being
// removed from an office. officeId on `users` is deleted at removal, so
// without this an ex-member would be indistinguishable from a genuinely
// independent agent. Cleared only by an admin's explicit review decision.
const OFFICE_HISTORY_COLLECTION = 'officeMembershipHistory';

export async function recordOfficeDeparture({ uid, officeId, officeName, removedBy }) {
  await adminDb.collection(OFFICE_HISTORY_COLLECTION).doc(uid).set({
    uid,
    officeId,
    officeName: officeName || '',
    leftAt: FieldValue.serverTimestamp(),
    removedBy: removedBy || null,
    clearedAt: null,
    clearedBy: null,
  });
}

/**
 * The single place that decides what an agent's campaigns are billed to.
 * Returns `{ entity }` for an unambiguous answer, or `{ entity, hold }`
 * when the attribution can't be trusted without a human look:
 *
 *   - `office-missing-or-inactive`: the agent still points at an office
 *     that is gone or no longer active (e.g. the office was disabled).
 *   - `former-office-member`: the agent was removed from an office and an
 *     admin hasn't yet confirmed how they should be billed from now on.
 *
 * A held agent is NEVER silently billed as an independent: the charge is
 * recorded (so nothing is lost) but keyed `review:{uid}`, which no invoice
 * run will ever pick up until an admin resolves it. Agents with no office
 * link and no unresolved office history — genuine independents — are
 * entirely unaffected.
 */
async function resolveBillingAttribution(agentUserId, agent) {
  if (agent.officeId) {
    const office = await loadActiveOffice(agent.officeId);
    if (office) {
      return {
        entity: resolveBillingEntity({
          agentUserId,
          firstName: agent.firstName,
          lastName: agent.lastName,
          officeId: office.officeId,
          officeName: office.officeName,
        }),
        office,
      };
    }
    return heldAttribution(agentUserId, agent, 'office-missing-or-inactive', { officeId: agent.officeId });
  }

  const history = await adminDb.collection(OFFICE_HISTORY_COLLECTION).doc(agentUserId).get();
  if (history.exists && !history.data().clearedAt) {
    const h = history.data();
    return heldAttribution(agentUserId, agent, 'former-office-member', { officeId: h.officeId, officeName: h.officeName });
  }

  return {
    entity: resolveBillingEntity({ agentUserId, firstName: agent.firstName, lastName: agent.lastName }),
    office: null,
  };
}

function heldAttribution(agentUserId, agent, reason, { officeId, officeName }) {
  const agentName = `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || 'Unknown agent';
  return {
    office: null,
    hold: { reason, officeId: officeId || null, officeName: officeName || null },
    entity: {
      billingEntityType: 'review',
      billingEntityKey: `review:${agentUserId}`,
      billingEntityName: agentName,
      billingReview: {
        reason,
        formerOfficeId: officeId || null,
        formerOfficeName: officeName || null,
        flaggedAt: new Date().toISOString(),
      },
    },
  };
}

async function resolveBillingEntityForAgentDoc(agentUserId, agent) {
  return (await resolveBillingAttribution(agentUserId, agent)).entity;
}

/**
 * Who may view/propose billing details for this agent's billing entity:
 * an independent agent for their own account, but for an office account
 * ONLY that office's administrators — individual office agents never
 * see or edit the office's billing details, and are never invoiced.
 * An agent whose attribution is on hold can't manage anything until an
 * admin resolves it (`hold` is set).
 */
export async function resolveBillingAccessForAgent(agentUserId) {
  const agentDoc = await adminDb.collection('users').doc(agentUserId).get();
  const agent = agentDoc.exists ? agentDoc.data() : {};
  const { entity, office, hold } = await resolveBillingAttribution(agentUserId, agent);
  if (hold) return { entity, canManage: false, hold };
  const canManage = office ? office.officeAdminUids.includes(agentUserId) : true;
  return { entity, canManage };
}

/**
 * Pure (no Firestore) — resolves which billing entity a property's
 * charge belongs to:
 *
 *   - `office:{officeId}` when the agent is a member of an office
 *     (`officeId` supplied): every campaign by every agent in that
 *     office consolidates onto the one office account — one billing
 *     contact, one 30-day cycle, one invoice with a line per property.
 *   - `agent:{uid}` otherwise: ONE AGENT = ONE BILLING ACCOUNT,
 *     exactly as before. Independent agents are completely unchanged.
 *
 * Agency/brand/company-name grouping stays removed — only a real,
 * server-verified office membership ever groups agents together.
 * Office-keyed results also carry `officeId`/`officeName`, which the
 * charge snapshots so its attribution survives the agent later leaving
 * or changing offices.
 */
export function resolveBillingEntity({ agentUserId, firstName, lastName, officeId, officeName }) {
  if (officeId) {
    return {
      billingEntityType: 'office',
      billingEntityKey: `office:${officeId}`,
      billingEntityName: officeName || 'Office',
      officeId,
      officeName: officeName || '',
    };
  }
  const agentName = `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown agent';
  return {
    billingEntityType: 'independent',
    billingEntityKey: `agent:${agentUserId}`,
    billingEntityName: agentName,
  };
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

  // office:{officeId} for an office member, otherwise this agent's own
  // agent:{uid} — never an agency/brand/company-name grouping. See
  // resolveBillingEntity's own comment. The result (including the
  // office) is snapshotted onto the charge, so it never changes later.
  const entity = await resolveBillingEntityForAgentDoc(agentUserId, agent);
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
 * Used by the fully server-side AgentBox/Rex import routes. Pass
 * `skipCharge: true` for a demo-mode import (sample data, never
 * billable) — the property is still created normally, just with no
 * charge attached, same as any excluded agent.
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
 * Records a charge for every property this agent already owns that
 * doesn't have one yet, under their CURRENT billing entity. Called just
 * before an agent joins or leaves an office, so a property they created
 * (but whose charge the hourly sweep hadn't recorded yet) is attributed
 * to the entity that was true when it was created, not to wherever the
 * agent happens to be when the sweep eventually catches up. Charges
 * already recorded are never touched (idempotent).
 */
export async function settleChargesForAgent(agentUserId) {
  if (!agentUserId) return { created: 0, skipped: 0 };
  const snap = await adminDb.collection('properties').where('userId', '==', agentUserId).get();
  return ensureChargesForProperties(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

/**
 * Admin decision on a charge held for billing review (`review:{uid}`).
 * Only a still-pending charge not attached to any run can be resolved, and
 * only to one of two explicit outcomes:
 *
 *   - `assignTo: 'office'` with an `officeId` that is currently ACTIVE:
 *     the charge joins that office's consolidated invoice.
 *   - `assignTo: 'independent'`: the charge becomes the agent's own
 *     `agent:{uid}` charge, and the agent's office history is marked
 *     cleared so their future campaigns are billed individually without
 *     being held again.
 *
 * The original hold reason is kept on the charge with who/when/why.
 */
export async function resolveBillingReview({ chargeId, assignTo, officeId, adminUid, reason }) {
  if (!adminUid) throw new Error('adminUid is required');
  if (assignTo !== 'office' && assignTo !== 'independent') throw new Error('assignTo must be "office" or "independent"');

  const ref = adminDb.collection('propertyCharges').doc(chargeId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('Charge not found'), { status: 404 });
    const charge = snap.data();
    if (charge.billingEntityType !== 'review') {
      throw Object.assign(new Error('This charge is not held for billing review'), { status: 409 });
    }
    if (charge.status !== 'pending' || charge.runId) {
      throw Object.assign(new Error(`Cannot resolve a charge with status "${charge.status}"`), { status: 409 });
    }

    const resolution = {
      assignedTo: assignTo,
      by: adminUid,
      at: FieldValue.serverTimestamp(),
      reason: reason || null,
      previousKey: charge.billingEntityKey,
    };

    if (assignTo === 'office') {
      const officeSnap = officeId ? await tx.get(adminDb.collection('officeAdminInfo').doc(officeId)) : null;
      if (!officeSnap || !officeSnap.exists || officeSnap.data().status !== 'active') {
        throw Object.assign(new Error('That office does not exist or is not active'), { status: 400 });
      }
      const officeName = officeSnap.data().name || '';
      tx.update(ref, {
        billingEntityType: 'office',
        billingEntityKey: `office:${officeId}`,
        billingEntityName: officeName || 'Office',
        officeId,
        officeName,
        billingReview: { ...charge.billingReview, resolved: true },
        billingReviewResolution: resolution,
      });
      return { chargeId, billingEntityKey: `office:${officeId}` };
    }

    tx.update(ref, {
      billingEntityType: 'independent',
      billingEntityKey: `agent:${charge.agentUserId}`,
      billingEntityName: charge.agentName || 'Unknown agent',
      billingReview: { ...charge.billingReview, resolved: true },
      billingReviewResolution: resolution,
    });
    const historyRef = adminDb.collection(OFFICE_HISTORY_COLLECTION).doc(charge.agentUserId);
    const history = await tx.get(historyRef);
    if (history.exists && !history.data().clearedAt) {
      tx.update(historyRef, { clearedAt: FieldValue.serverTimestamp(), clearedBy: adminUid });
    }
    return { chargeId, billingEntityKey: `agent:${charge.agentUserId}` };
  });
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
