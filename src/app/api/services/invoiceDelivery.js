// Has Xero already emailed this invoice? Read-only: answered from Xero's own records, so that
// "Retry Email" can never email a customer a second time and an admin can confirm delivery
// without sending anything.
//
// Evidence, either is enough:
//   - the invoice's SentToContact flag (Xero marks an invoice as sent when it is emailed), or
//   - a record in the invoice's Xero history that mentions sending or emailing.
// The history test is deliberately broad: if in doubt, Premarket does NOT email again. A
// deliberate resend can always be done from Xero itself.

import { getInvoiceById, getInvoiceHistory } from './xeroService';

const EMAIL_HISTORY = /\b(sent|emailed|email)\b/i;

// Xero's JSON uses "/Date(1795395210000+0000)/" for UTC timestamps, and *String fields for ISO.
function xeroWhen(record) {
  if (record?.DateUTCString) return `${record.DateUTCString.replace(/Z?$/, 'Z')}`;
  const ms = /\/Date\((\d+)/.exec(record?.DateUTC || '')?.[1];
  return ms ? new Date(Number(ms)).toISOString() : null;
}

/** Pure. { emailed, evidence, history } from an invoice and its history records. */
export function deliveryEvidence(invoice, historyRecords = []) {
  const history = (historyRecords || []).map((r) => ({
    when: xeroWhen(r),
    user: r?.User || null,
    changes: r?.Changes || null,
    details: r?.Details || null,
  }));
  const emailRecords = history.filter((h) => EMAIL_HISTORY.test(`${h.changes || ''} ${h.details || ''}`));
  if (invoice?.SentToContact === true) {
    return { emailed: true, evidence: 'Xero marks this invoice as sent to the contact.', history, emailRecords };
  }
  if (emailRecords.length) {
    const r = emailRecords[emailRecords.length - 1];
    return { emailed: true, evidence: `Xero's history records: ${[r.changes, r.details].filter(Boolean).join(' — ')}`, history, emailRecords };
  }
  return { emailed: false, evidence: 'Xero has no record of this invoice being sent.', history, emailRecords };
}

/** Read-only Xero lookup: the invoice as Xero holds it now, and whether it has been emailed. */
export async function checkInvoiceDelivery(invoiceId) {
  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) return { found: false, invoiceId };
  const historyRecords = await getInvoiceHistory(invoiceId);
  const { emailed, evidence, history, emailRecords } = deliveryEvidence(invoice, historyRecords);
  return {
    found: true,
    invoiceId,
    invoiceNumber: invoice.InvoiceNumber || null,
    status: invoice.Status || null,
    sentToContact: invoice.SentToContact === true,
    contactName: invoice.Contact?.Name || null,
    total: typeof invoice.Total === 'number' ? invoice.Total : null,
    totalTax: typeof invoice.TotalTax === 'number' ? invoice.TotalTax : null,
    amountDue: typeof invoice.AmountDue === 'number' ? invoice.AmountDue : null,
    date: invoice.DateString ? invoice.DateString.slice(0, 10) : null,
    dueDate: invoice.DueDateString ? invoice.DueDateString.slice(0, 10) : null,
    emailed,
    evidence,
    emailRecords,
    history,
  };
}
