// Creates exactly one real, inspectable DRAFT invoice in the connected
// Xero org, using an agent's actual current properties as line items —
// a step beyond invoicePreviewService.js (which never touches Xero at
// all), built specifically to let a human inspect Xero's own genuine
// invoice layout before any real billing happens.
//
// Deliberately disconnected from the real billing pipeline, same
// principle as the existing Xero connection diagnostic
// (xero-diagnostic/create/route.js): this file must never import
// recordPropertyCharge, createPropertyAndChargeAtomically,
// ensureChargesForProperties, reconcileMissingCharges,
// createInvoiceRunFromPendingCharges, or sendInvoice. The only Xero
// writes it can ever make are findOrCreateContact (idempotent — finds
// before creating) and one POST to /Invoices with Status hardcoded to
// 'DRAFT', never accepted as a caller-supplied value. Nothing here
// can ever authorise, email, or make an invoice payable.
//
// There is deliberately no way to force a second matching invoice —
// a prior version had a `force` override; it's gone. If a genuinely
// fresh test is ever needed, delete the existing draft in Xero first.

import { createHash } from 'crypto';
import { findOrCreateContact, makeXeroRequest } from './xeroService';
import { buildAgencyInvoicePreview } from './invoicePreviewService';

export const TEST_CONTACT_NAME = 'PREMARKET INVOICE TEST — Harcourts Property Hub — DO NOT PAY';
export const TEST_REFERENCE = 'TEST ONLY — DO NOT PAY';

function buildLineItems(preview) {
  return preview.properties.map((p) => ({
    description: `Premarket listing: ${p.address}`,
    quantity: 1,
    unitAmount: p.subtotalEx,
    taxType: p.gstAmount > 0 ? 'OUTPUT' : 'NONE',
  }));
}

function computeDueDateStr(paymentTermsDays) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (paymentTermsDays || 14));
  return dueDate.toISOString().split('T')[0];
}

/**
 * Deterministic, not random — the same agent always produces the
 * same key. That's deliberate: Xero's Idempotency-Key header (POST
 * /Invoices supports it) makes Xero itself treat any request carrying
 * this exact key as a retry of the same logical operation, returning
 * the invoice already created under it instead of creating a second
 * one — even if two requests for this agent's test invoice land at
 * Xero at the same moment, a race the earlier Reference-based
 * check-then-create (findExistingXeroTestInvoice, still run first as
 * a fast pre-check) can't fully close by itself. See
 * createXeroTestInvoice's own comment for what this does and doesn't
 * cover.
 */
function stableIdempotencyKey(agentUserId) {
  return createHash('sha256')
    .update(`xero-test-invoice:${agentUserId}:${TEST_REFERENCE}`)
    .digest('hex');
}

/**
 * Read-only. Looks for a Xero invoice already carrying this feature's
 * exact TEST_REFERENCE — the duplicate-protection check every caller
 * below must consult before creating anything. Never creates.
 */
export async function findExistingXeroTestInvoice() {
  const whereClause = `Reference=="${TEST_REFERENCE}"`;
  const result = await makeXeroRequest('GET', `/Invoices?where=${encodeURIComponent(whereClause)}`);
  return result.Invoices?.[0] || null;
}

/**
 * Builds exactly what createXeroTestInvoice would send to Xero,
 * without sending it — the explicit preview step a human reviews
 * before confirming. Reuses buildAgencyInvoicePreview, so these
 * amounts are provably the same ones the email preview already
 * showed, never a second, independently computed set of numbers.
 */
export async function previewXeroTestInvoice({ agentUserId }) {
  const preview = await buildAgencyInvoicePreview({ agentUserId });
  if (preview.propertyCount === 0) {
    throw new Error('This account has no properties to invoice');
  }

  const existing = await findExistingXeroTestInvoice();

  return {
    preview,
    alreadyExists: !!existing,
    existingInvoice: existing
      ? { invoiceId: existing.InvoiceID, invoiceNumber: existing.InvoiceNumber || null, status: existing.Status }
      : null,
    proposedInvoice: {
      contactName: TEST_CONTACT_NAME,
      reference: TEST_REFERENCE,
      dueDate: computeDueDateStr(preview.paymentTermsDays),
      status: 'DRAFT',
      accountCode: preview.xeroAccountCode,
      lineItems: buildLineItems(preview),
      totalInc: preview.totalInc,
      gstAmount: preview.gstAmount,
    },
  };
}

/**
 * The one real write this whole file makes. Requires confirm: true —
 * enforced here, server-side, not just as a UI dialog that could be
 * skipped by calling the API directly (same pattern the existing Xero
 * diagnostic's create route already uses). Unconditionally refuses if
 * a test invoice already exists (by TEST_REFERENCE) — there is no
 * override; delete the existing draft in Xero first if a genuinely
 * fresh one is ever needed.
 *
 * Two layers against a double-create, not one:
 *   1. findExistingXeroTestInvoice() — a plain read-then-decide check,
 *      same as before. Fast, but on its own has a race: two requests
 *      arriving close together could both read "doesn't exist yet"
 *      before either one's create lands.
 *   2. An Idempotency-Key header (stableIdempotencyKey, deterministic
 *      per agent) on the actual POST /Invoices call — Xero's own
 *      documented support for this header means Xero itself
 *      deduplicates two requests carrying the same key, closing
 *      exactly the race (1) can't. This is the "safest practical
 *      approach" available: the dedup decision happens inside Xero,
 *      atomically, not in a second round-trip this code could still
 *      lose a race on.
 *
 * Remaining limitation, stated plainly: Xero does not publish an
 * unlimited retention window for a given Idempotency-Key — if it ever
 * expires key reuse before this feature is deleted, two sufficiently
 * far-apart calls could both pass Xero's dedup and create two drafts.
 * The Reference-based check in step 1 is the backstop for that case,
 * not a perfect one (same race as above, just now vanishingly
 * unlikely rather than impossible) — acceptable for a rare,
 * admin-triggered, DRAFT-only test action, not something this feature
 * relies on alone.
 *
 * Status is always 'DRAFT' — never a parameter, never overridable —
 * and sendInvoice is never called anywhere in this file, so nothing
 * created here can become payable or be emailed by this code path.
 * This function builds the Xero invoice body itself (Type, Contact,
 * LineItems, Reference, DueDate, Status, LineAmountTypes) rather than
 * calling xeroService.createInvoice, specifically so the Idempotency-
 * Key header above can be attached to this one request — createInvoice
 * has no parameter for a custom header, and this file intentionally
 * leaves that shared, already-deployed function completely unchanged
 * rather than widen its signature for one caller.
 */
export async function createXeroTestInvoice({ agentUserId, confirm }) {
  if (confirm !== true) {
    throw new Error('Refusing to create a Xero invoice without explicit confirm: true');
  }

  const preview = await buildAgencyInvoicePreview({ agentUserId });
  if (preview.propertyCount === 0) {
    throw new Error('This account has no properties to invoice');
  }

  const existing = await findExistingXeroTestInvoice();
  if (existing) {
    return {
      created: false,
      reason: 'already-exists',
      existingInvoice: { invoiceId: existing.InvoiceID, invoiceNumber: existing.InvoiceNumber || null, status: existing.Status },
    };
  }

  const contact = await findOrCreateContact({ name: TEST_CONTACT_NAME });
  if (!contact?.ContactID) {
    throw new Error('Failed to find or create the dedicated test contact');
  }

  const invoiceBody = {
    Type: 'ACCREC',
    Contact: { ContactID: contact.ContactID },
    LineItems: buildLineItems(preview).map((li) => ({
      Description: li.description,
      Quantity: li.quantity,
      UnitAmount: li.unitAmount,
      AccountCode: preview.xeroAccountCode,
      TaxType: li.taxType,
    })),
    Reference: TEST_REFERENCE,
    DueDate: computeDueDateStr(preview.paymentTermsDays),
    Status: 'DRAFT', // hardcoded — see function comment; never accepted from a caller
    LineAmountTypes: 'Exclusive',
  };

  const result = await makeXeroRequest(
    'POST',
    '/Invoices',
    { Invoices: [invoiceBody] },
    true,
    { 'Idempotency-Key': stableIdempotencyKey(agentUserId) }
  );
  const invoice = result.Invoices?.[0];

  if (!invoice?.InvoiceID) {
    throw new Error('Xero did not return an invoice');
  }

  // Deliberately no call to sendInvoice() here — this is the entire point.

  return {
    created: true,
    invoiceId: invoice.InvoiceID,
    invoiceNumber: invoice.InvoiceNumber || null,
    status: invoice.Status,
    contactId: contact.ContactID,
    propertyCount: preview.propertyCount,
    total: preview.totalInc,
    message: 'Created as a DRAFT in Xero. It was never authorised or emailed.',
  };
}
