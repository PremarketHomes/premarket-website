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
// before creating) and createInvoice with Status hardcoded to 'DRAFT',
// never accepted as a caller-supplied value. Nothing here can ever
// authorise, email, or make an invoice payable.

import { findOrCreateContact, createInvoice, makeXeroRequest } from './xeroService';
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
 * diagnostic's create route already uses). Refuses to create a
 * second test invoice if one already exists (by TEST_REFERENCE)
 * unless the caller explicitly passes force: true, having already
 * seen that flag via previewXeroTestInvoice first.
 *
 * Status is always 'DRAFT' — never a parameter, never overridable —
 * and sendInvoice is never called anywhere in this file, so nothing
 * created here can become payable or be emailed by this code path.
 */
export async function createXeroTestInvoice({ agentUserId, confirm, force = false }) {
  if (confirm !== true) {
    throw new Error('Refusing to create a Xero invoice without explicit confirm: true');
  }

  const preview = await buildAgencyInvoicePreview({ agentUserId });
  if (preview.propertyCount === 0) {
    throw new Error('This account has no properties to invoice');
  }

  const existing = await findExistingXeroTestInvoice();
  if (existing && !force) {
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

  const invoice = await createInvoice({
    contactId: contact.ContactID,
    lineItems: buildLineItems(preview),
    reference: TEST_REFERENCE,
    dueDate: computeDueDateStr(preview.paymentTermsDays),
    accountCode: preview.xeroAccountCode,
    status: 'DRAFT', // hardcoded — see module comment; never accepted from a caller
  });

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
