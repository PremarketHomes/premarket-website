/**
 * The Xero tax types Premarket invoices use — ONE place, so the invoice send route, the Xero
 * service default and the readiness check can never disagree.
 *
 * Premarket Group Pty Ltd is NOT registered for GST (Xero: PaysTax=false), so the $200 campaign
 * fee carries no GST. In an Australian Xero organisation the zero-tax revenue rate for a supplier
 * that is not GST registered is "BAS Excluded" (BASEXCLUDED). There is no "NONE" rate in the
 * organisation's tax-rate list.
 *
 * Invoices used to send the placeholder "NONE". Xero accepted it and, for account 200, recorded
 * BASEXCLUDED — but only because that is account 200's DEFAULT tax type, so the outcome depended
 * on an account setting (point invoices at an account whose default is GST on Income and the same
 * request could have charged 10% GST without any error). The type is now sent explicitly.
 */
export const ZERO_GST_TAX_TYPE = 'BASEXCLUDED';

/** 10% GST on income — only used if a charge was snapshotted with GST (gstRate > 0). */
export const GST_TAX_TYPE = 'OUTPUT';

/** The Xero tax type for one invoice line, from that property's own snapshotted GST amount. */
export function taxTypeForGstAmount(gstAmount) {
  return Number(gstAmount) > 0 ? GST_TAX_TYPE : ZERO_GST_TAX_TYPE;
}
