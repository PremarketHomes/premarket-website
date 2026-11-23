// The Xero invoice for one invoice-run item: contact, lines, reference, dates. This is the ONE
// builder used by both "Send to Xero" (runs/[runId]/send) and "Preview invoice"
// (runs/[runId]/preview), so a preview can never differ from what is sent.
//
// Preview workflow: the preview is the real invoice, saved in Xero as a DRAFT (not
// approved, not emailed, not payable). Its PDF is rendered by Xero itself, with the
// organisation's own branding theme. When the run is later sent, that same draft is
// rewritten from the run as it stands and approved. It keeps its invoice number, and
// nothing is ever created twice.

import { createHash } from 'crypto';
import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import {
  findOrCreateContact,
  getContactById,
  searchContactByName,
  findInvoiceByReference,
  getInvoiceById,
} from './xeroService';
import { buildInvoiceReference, resolveXeroContact } from './xeroInvoiceIdentity';
import { taxTypeForGstAmount } from './xeroTaxTypes';
import { withChargeDetails } from './chargeDetails';
import { chargeLineDescription } from '../../utils/chargeLine';
import { invoiceDates } from './invoiceDates';

/** The invoicing settings an invoice is built with (settings/invoicing), with the same defaults Send has always used. */
export function invoiceSettings(settings = {}) {
  return {
    accountCode: settings.xeroAccountCode || '200',
    invoicePrefix: settings.invoicePrefix || 'PM-',
    paymentTermsDays: settings.paymentTermsDays || 14,
  };
}

/**
 * Deterministic, not random: the same invoiceRunItem always produces the same key, forever
 * (derived from its own Firestore doc ID). Sent with the one real createInvoice call as Xero's
 * Idempotency-Key, so a retried create hands back the same invoice instead of a second one.
 */
export function stableInvoiceIdempotencyKey(itemId) {
  return createHash('sha256').update(`premarket-invoice-run-item:${itemId}`).digest('hex');
}

/** The Idempotency-Key for approving this item's previewed DRAFT at Send: stable per item, and
 * distinct from the create key above, so the two different requests can never be confused. */
export function approveDraftIdempotencyKey(itemId) {
  return createHash('sha256').update(`premarket-invoice-approve-draft:${itemId}`).digest('hex');
}

/**
 * Everything the Xero invoice for this run item is made of. `confirmed` is the item's live,
 * admin-confirmed billing contact (billingService.resolveBillingContact); callers check it
 * exists first. Resolves (or creates) the Xero contact and remembers the link, exactly as Send
 * always has.
 */
export async function buildRunItemInvoice({ itemId, item, runData, confirmed, settings, now = new Date() }) {
  const { accountCode, invoicePrefix, paymentTermsDays } = invoiceSettings(settings);

  // The Xero contact is the confirmed LEGAL billing name (no technical suffix on the
  // customer-facing name). The entity -> contact link is remembered by id in a server-only
  // `xeroContacts` record, so later runs never depend on name matching; see
  // xeroInvoiceIdentity.resolveXeroContact for the (rare) same-name-different-entity case.
  const contactLinkRef = adminDb.collection('xeroContacts').doc(item.billingEntityKey);
  const storedLink = (await contactLinkRef.get()).data();
  const { contact } = await resolveXeroContact({
    item,
    confirmed,
    storedContactId: storedLink?.xeroContactId || null,
    xero: { getContactById, searchContactByName, findOrCreateContact },
  });

  if (!contact?.ContactID) {
    throw new Error(`Failed to create Xero contact for ${item.agencyName}`);
  }
  if (storedLink?.xeroContactId !== contact.ContactID) {
    await contactLinkRef.set({
      billingEntityKey: item.billingEntityKey,
      xeroContactId: contact.ContactID,
      xeroContactName: contact.Name || null,
      linkedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // One line per property, using THAT property's own already ex-GST subtotalEx and
  // already-computed gstAmount (both snapshotted onto the charge at charge-creation time, see
  // billingService.js) — never a single run-wide unit amount or tax rate. Description: "full
  // address — selling agent — submission date", read from each linked property record.
  const lineProperties = await withChargeDetails(item.properties, 'address');
  const lineItems = lineProperties.map((prop) => ({
    description: chargeLineDescription(prop),
    quantity: 1,
    unitAmount: prop.subtotalEx,
    taxType: taxTypeForGstAmount(prop.gstAmount),
  }));

  // Invoice date = today in Brisbane; due date = exactly paymentTermsDays later.
  const { date, dueDate } = invoiceDates(now, paymentTermsDays);

  // A unique, stable reference per run item (see xeroInvoiceIdentity.js): two runs or billing
  // periods for the same office can never share one, and a retry of THIS item gets the same
  // reference back, so it finds the invoice its own earlier attempt (or preview) created.
  const reference = buildInvoiceReference({ prefix: invoicePrefix, periodStart: runData.periodStart, itemId });

  return { contact, lineItems, reference, accountCode, date, dueDate, paymentTermsDays };
}

/**
 * The invoice already in Xero for this run item, if any:
 *   - the DRAFT its preview created (by the stored id, else by its unique reference), or
 *   - any other live (not deleted) invoice carrying its reference — e.g. one an earlier,
 *     interrupted Send created.
 * Returns { draft, existing }: at most one is set. DELETED invoices never count.
 */
export async function findExistingRunItemInvoice({ item, reference }) {
  if (item.previewXeroInvoiceId) {
    const preview = await getInvoiceById(item.previewXeroInvoiceId);
    if (preview?.Status === 'DRAFT') return { draft: preview, existing: null };
  }
  const byReference = await findInvoiceByReference(reference);
  if (!byReference?.InvoiceID) return { draft: null, existing: null };
  if (byReference.Status === 'DRAFT') return { draft: byReference, existing: null };
  return { draft: null, existing: byReference };
}
