import { createHash } from 'node:crypto';

/**
 * Identity rules for Xero invoices and contacts created from an invoice run.
 * Pure (no Firebase, no Xero calls — those are injected), so every rule is
 * unit-tested without touching either.
 *
 * ── Invoice reference ────────────────────────────────────────────────────
 * The reference used to be "PM-{Month Year} - {contact name}". Two different
 * runs for the same office whose earliest charge fell in the same calendar
 * month produced the SAME reference, and the pre-flight "does an invoice with
 * this reference already exist?" check would then hand back the EARLIER run's
 * invoice — the later run's charges would be marked invoiced without ever being
 * billed. The reference is now derived from the run item's own document id:
 *
 *   - unique per run item (an office gets one item per run), so two runs, or
 *     two billing periods, can never share one;
 *   - stable across retries (the item id never changes), so a retry looks up
 *     and reuses the invoice ITS OWN earlier attempt created;
 *   - still readable: "PM-October 2026 - 9F3A71C2DE".
 * And an existing invoice is only ever reused after it has been verified to be
 * for this contact and this total (invoiceMatchesItem) — a reference match
 * alone is never trusted.
 *
 * ── Xero contact name ────────────────────────────────────────────────────
 * Contacts were named "{legal name} ({first 8 chars of the entity id})" so two
 * different billing entities with the same name could never share a Xero
 * contact. That suffix is customer-facing (it prints on the invoice), so it is
 * gone: the contact is the confirmed legal billing name. The entity→contact
 * link is now remembered by id (server-only `xeroContacts` records), and a
 * suffix is only used in the rare case where a DIFFERENT entity already owns
 * the same name in Xero.
 */

// ── invoice reference ────────────────────────────────────────────────────

/** 10 hex characters derived from the run item id: short, readable, effectively collision-free. */
export function invoiceReferenceCode(itemId) {
  return createHash('sha256').update(`premarket-invoice-reference:${itemId}`).digest('hex').slice(0, 10).toUpperCase();
}

export function buildInvoiceReference({ prefix = 'PM-', periodStart, itemId }) {
  if (!itemId) throw new Error('A run item id is required to build an invoice reference');
  const d = periodStart?.toDate?.() || (periodStart ? new Date(periodStart) : null);
  const period = d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
    : '';
  return `${prefix}${period ? `${period} - ` : ''}${invoiceReferenceCode(itemId)}`;
}

// ── verifying an invoice found by reference ──────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** What the invoice for this run item should total (inc tax), from the item's own per-property amounts. */
export function expectedInvoiceTotal(properties = []) {
  return round2(properties.reduce((sum, p) => sum + (Number(p.subtotalEx) || 0) + (Number(p.gstAmount) || 0), 0));
}

/**
 * Is `existing` (an invoice Xero returned for our reference) genuinely THIS run
 * item's invoice? Never trust a reference match alone. Returns { ok, reason }.
 */
export function invoiceMatchesItem(existing, { contactId, total, lineCount }) {
  if (!existing?.InvoiceID) return { ok: false, reason: 'no invoice' };
  if (existing.Status === 'VOIDED' || existing.Status === 'DELETED') {
    return { ok: false, reason: `the existing invoice ${existing.InvoiceNumber || existing.InvoiceID} is ${existing.Status}` };
  }
  if (existing.Contact?.ContactID && contactId && existing.Contact.ContactID !== contactId) {
    return { ok: false, reason: 'the existing invoice is for a different Xero contact' };
  }
  if (typeof existing.Total !== 'number') {
    return { ok: false, reason: 'the existing invoice total could not be verified' };
  }
  if (Math.abs(round2(existing.Total) - total) > 0.01 * Math.max(1, lineCount)) {
    return { ok: false, reason: `the existing invoice total (${round2(existing.Total)}) does not match this run (${total})` };
  }
  if (Array.isArray(existing.LineItems) && existing.LineItems.length > 0 && existing.LineItems.length !== lineCount) {
    return { ok: false, reason: 'the existing invoice has a different number of lines' };
  }
  return { ok: true, reason: null };
}

/** An invoice already exists in Xero under this run item's reference but is not this item's invoice. */
export class InvoiceReferenceConflictError extends Error {
  constructor(reference, reason) {
    super(`An invoice with reference "${reference}" already exists in Xero but is not this run's invoice: ${reason}. Nothing was created or marked invoiced — resolve it in Xero first.`);
    this.name = 'InvoiceReferenceConflictError';
    this.reference = reference;
  }
}

// ── Xero contact ─────────────────────────────────────────────────────────

/** The customer-facing contact name: the confirmed legal billing name. No technical suffix. */
export function cleanXeroContactName(item, confirmedBillingName) {
  return (confirmedBillingName || '').trim() || (item?.agencyName || '').trim() || 'Premarket customer';
}

/** Only ever used when a DIFFERENT billing entity already owns the clean name in Xero. */
export function disambiguatedXeroContactName(baseName, billingEntityKey) {
  const suffix = String(billingEntityKey || '').replace(/^(agent|office):/, '').slice(0, 8);
  return suffix ? `${baseName} (${suffix})` : baseName;
}

const digits = (v) => String(v || '').replace(/\D/g, '');

/**
 * Could the existing Xero contact (found by name) be this same billing entity?
 * Same ABN, or — if either side has none — the same accounts email. If it can't
 * be established, the answer is NO: keeping two entities apart is the safe error.
 */
export function isSameBillingEntityContact(existing, confirmed) {
  const theirAbn = digits(existing?.TaxNumber);
  const ourAbn = digits(confirmed?.abn);
  if (theirAbn && ourAbn) return theirAbn === ourAbn;
  const theirEmail = String(existing?.EmailAddress || '').trim().toLowerCase();
  const ourEmail = String(confirmed?.email || '').trim().toLowerCase();
  return !!theirEmail && theirEmail === ourEmail;
}

/**
 * Finds (or creates) the Xero contact for one run item.
 *
 *  1. If this billing entity already has a remembered Xero contact id, use it —
 *     no name matching at all, so names can never merge two entities.
 *  2. Otherwise look the clean legal name up in Xero: none → create it; found
 *     and it is the same entity (ABN/email) → reuse; found but a DIFFERENT
 *     entity → fall back to the suffixed name.
 *
 * `xero` = { getContactById, findOrCreateContact, searchContactByName } (injected).
 * Returns { contact, how }.
 */
export async function resolveXeroContact({ item, confirmed, storedContactId, xero }) {
  const nameParts = (confirmed.name || '').split(' ');
  const details = {
    email: confirmed.email,
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
    taxNumber: confirmed.abn || undefined,
    address: confirmed.address || undefined,
  };
  const baseName = cleanXeroContactName(item, confirmed.billingName);

  if (storedContactId) {
    const stored = await xero.getContactById(storedContactId);
    if (stored?.ContactID) {
      if (stored.ContactStatus === 'ARCHIVED') {
        throw new Error(`The Xero contact "${stored.Name || baseName}" is archived — restore it in Xero before invoicing`);
      }
      return { contact: stored, how: 'stored' };
    }
    // The remembered contact no longer exists in Xero: fall through and resolve by name again.
  }

  const found = await xero.searchContactByName(baseName);
  if (!found) {
    const created = await xero.findOrCreateContact({ name: baseName, ...details });
    return { contact: created, how: 'created' };
  }
  if (isSameBillingEntityContact(found, confirmed)) {
    return { contact: found, how: 'found' };
  }
  const safeName = disambiguatedXeroContactName(baseName, item.billingEntityKey);
  const contact = await xero.findOrCreateContact({ name: safeName, ...details });
  return { contact, how: 'disambiguated' };
}
