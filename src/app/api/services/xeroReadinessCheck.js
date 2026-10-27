import { disambiguatedXeroContactName, isSameBillingEntityContact } from './xeroInvoiceIdentity';
import { ZERO_GST_TAX_TYPE } from './xeroTaxTypes';

/**
 * Xero readiness check — READ-ONLY by construction.
 *
 * It is handed a small set of Xero READ functions (`xero`) and nothing else, so
 * it has no way to create, authorise, email, void, delete or modify a Xero
 * contact or invoice: those functions are never passed in, and this module does
 * not import them. (A test asserts both.) The only side effect of running it is
 * the ordinary OAuth token refresh the Xero service already does when the access
 * token has expired.
 *
 * It answers, before the first real HPH invoice is ever created:
 *   1. Are we connected, and to WHICH Xero organisation? (Not a demo company.)
 *   2. How is the organisation set up for GST? (Premarket is not GST registered.)
 *   3. Does the invoice revenue account code exist, is it active and suitable?
 *   4. Is the zero-GST tax type we send (BAS Excluded) available, active, 0%, and valid for revenue?
 *   5. Is the revenue account's DEFAULT tax treatment sensible?
 *   6. Does an HPH contact already exist, and what would the invoice run do?
 *   7. Do any old Premarket diagnostic test invoices remain live, and is the test contact still active?
 *
 * Note on tax types: an Australian Xero organisation has no "NONE" tax rate. The zero-tax revenue rate
 * for a supplier that is not GST registered is "BAS Excluded" (BASEXCLUDED). See xeroTaxTypes.js.
 */

export const OLD_TEST_CONTACT_NAME = 'PREMARKET DIAGNOSTIC TEST — DO NOT USE';
export const OLD_TEST_REFERENCES = [
  'TEST — Premarket Xero connection diagnostic — safe to delete',
  'TEST ONLY — DO NOT AUTHORISE OR SEND',
];

// The read functions this check is allowed to use. Anything else is rejected.
export const ALLOWED_XERO_READERS = [
  'getOrganisation',
  'getAccountByCode',
  'getTaxRates',
  'searchContactByName',
  'getContactById',
  'listInvoicesByReference',
  'listInvoicesForContact',
];

const REVENUE_TYPES = ['REVENUE', 'SALES', 'OTHERINCOME'];
// Invoices in these states are historical records only: never payable, never reported.
const HISTORICAL_STATUSES = ['DELETED', 'VOIDED'];

const short = (err) => String(err?.message || err || 'unknown error').slice(0, 300);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));

function guardReaders(xero) {
  const extra = Object.keys(xero || {}).filter((k) => !ALLOWED_XERO_READERS.includes(k));
  if (extra.length) throw new Error(`Readiness check refuses non-read Xero functions: ${extra.join(', ')}`);
  return xero;
}

/**
 * @param xero    { getOrganisation, getAccountByCode, getTaxRates, searchContactByName, getContactById,
 *                  listInvoicesByReference, listInvoicesForContact }  (read-only; see ALLOWED_XERO_READERS)
 * @param accountCode  the invoice revenue account code (settings.xeroAccountCode || '200')
 * @param officeContacts  [{ billingEntityKey, billingName, abn, email, storedContactId }]  confirmed office billing contacts
 */
export async function runXeroReadinessCheck({ xero, accountCode = '200', officeContacts = [], now = () => new Date() }) {
  guardReaders(xero);
  const checks = [];
  const calls = [];
  const call = async (name, ...args) => { calls.push(name); return xero[name](...args); };
  const add = (c) => { checks.push(c); return c; };

  // Everything Xero tells us about the org, account and tax rates is read once, then checked below.
  let org = null; let orgError = null;
  try { org = await call('getOrganisation'); } catch (err) { orgError = err; }

  let acct = null; let acctError = null;
  try { acct = await call('getAccountByCode', accountCode); } catch (err) { acctError = err; }

  let rates = null; let ratesError = null;
  try { rates = await call('getTaxRates'); } catch (err) { ratesError = err; }

  // 1. Connection + organisation identity ------------------------------------------------
  if (orgError) {
    add({ id: 'organisation', label: 'Connection and organisation', status: 'fail', detail: `Could not reach Xero: ${short(orgError)}` });
  } else if (!org?.Name) {
    add({ id: 'organisation', label: 'Connection and organisation', status: 'fail', detail: 'Xero did not return an organisation for the stored connection.' });
  } else if (org.IsDemoCompany === true) {
    add({ id: 'organisation', label: 'Connection and organisation', status: 'fail', detail: `Connected to the Xero DEMO company "${org.Name}", not a live organisation. Invoices would go nowhere real.`, data: pick(org, ['Name', 'LegalName', 'IsDemoCompany']) });
  } else {
    add({
      id: 'organisation', label: 'Connection and organisation', status: 'pass',
      detail: `Connected to "${org.Name}"${org.LegalName && org.LegalName !== org.Name ? ` (${org.LegalName})` : ''}. Confirm this is the Premarket organisation.`,
      data: pick(org, ['Name', 'LegalName', 'OrganisationType', 'CountryCode', 'BaseCurrency', 'IsDemoCompany', 'OrganisationStatus']),
    });
  }

  // 2. GST registration as Xero has it configured --------------------------------------------
  if (org?.Name) {
    const data = pick(org, ['PaysTax', 'SalesTaxBasis', 'SalesTaxPeriod', 'TaxNumber', 'DefaultSalesTax']);
    if (org.PaysTax === false) {
      add({ id: 'gstRegistration', label: 'GST registration in Xero', status: 'pass', detail: `Xero has the organisation as NOT registered for GST (pays tax: no, sales tax basis: ${org.SalesTaxBasis ?? 'n/a'}). That matches invoicing with no GST.`, data });
    } else if (org.PaysTax === true) {
      add({ id: 'gstRegistration', label: 'GST registration in Xero', status: 'warn', detail: `Xero has the organisation set up to collect GST (basis ${org.SalesTaxBasis ?? 'n/a'}, ${org.SalesTaxPeriod ?? 'n/a'}). Premarket invoices carry NO GST — confirm with your accountant that this is correct before invoicing.`, data });
    } else {
      add({ id: 'gstRegistration', label: 'GST registration in Xero', status: 'warn', detail: 'Xero did not say whether the organisation is registered for GST.', data });
    }
  }

  // 3. Revenue account code ----------------------------------------------------------------
  const accountLabel = `Account code ${accountCode}`;
  if (acctError) {
    add({ id: 'account', label: accountLabel, status: 'fail', detail: `Could not check the account: ${short(acctError)}` });
  } else if (!acct) {
    add({ id: 'account', label: accountLabel, status: 'fail', detail: `No account with code ${accountCode} exists in this organisation.` });
  } else {
    const active = acct.Status === 'ACTIVE';
    const revenue = acct.Class === 'REVENUE' || REVENUE_TYPES.includes(acct.Type);
    const data = pick(acct, ['Code', 'Name', 'Type', 'Class', 'Status', 'TaxType']);
    if (active && revenue) add({ id: 'account', label: accountLabel, status: 'pass', detail: `"${acct.Name}" is an active ${acct.Type || acct.Class} account.`, data });
    else add({ id: 'account', label: accountLabel, status: 'fail', detail: `Account ${accountCode} "${acct.Name}" is ${active ? '' : 'not active and '}${revenue ? 'a revenue account' : `not a revenue account (type ${acct.Type}, class ${acct.Class})`} — it cannot be used for invoice lines.`, data });
  }

  // 4. The zero-GST tax type the invoices send (BAS Excluded) --------------------------------
  const taxLabel = `Tax type ${ZERO_GST_TAX_TYPE} (BAS Excluded, no GST)`;
  if (ratesError) {
    add({ id: 'taxType', label: taxLabel, status: 'fail', detail: `Could not read tax rates: ${short(ratesError)}` });
  } else {
    const rate = (rates || []).find((r) => r.TaxType === ZERO_GST_TAX_TYPE);
    const output = (rates || []).find((r) => r.TaxType === 'OUTPUT');
    const data = pick(rate, ['Name', 'TaxType', 'Status', 'EffectiveRate', 'CanApplyToRevenue']);
    if (!rate) add({ id: 'taxType', label: taxLabel, status: 'fail', detail: `The ${ZERO_GST_TAX_TYPE} tax type was not found in this organisation, so invoice lines cannot be sent with no GST.` });
    else if (rate.Status && rate.Status !== 'ACTIVE') add({ id: 'taxType', label: taxLabel, status: 'fail', detail: `"${rate.Name}" exists but is ${rate.Status}.`, data });
    else if (rate.CanApplyToRevenue === false) add({ id: 'taxType', label: taxLabel, status: 'fail', detail: `"${rate.Name}" cannot be applied to revenue lines.`, data });
    else if (Number(rate.EffectiveRate) > 0) add({ id: 'taxType', label: taxLabel, status: 'fail', detail: `"${rate.Name}" has a ${rate.EffectiveRate}% rate — it would charge GST.`, data });
    else add({ id: 'taxType', label: taxLabel, status: 'pass', detail: `"${rate.Name}" is active, 0%, and valid for revenue lines.${output ? ` ("${output.Name}" also exists and is NOT used.)` : ''}`, data });
  }

  // 5. The revenue account's default tax treatment --------------------------------------------
  if (acct && !ratesError) {
    const def = acct.TaxType;
    const defRate = (rates || []).find((r) => r.TaxType === def);
    const data = { accountDefaultTaxType: def ?? null, name: defRate?.Name ?? null, effectiveRate: defRate?.EffectiveRate ?? null };
    const aLabel = `Account ${accountCode} default tax treatment`;
    if (def === ZERO_GST_TAX_TYPE) {
      add({ id: 'accountTax', label: aLabel, status: 'pass', detail: `Account ${accountCode} defaults to "${defRate?.Name || ZERO_GST_TAX_TYPE}" — the correct no-GST treatment, matching what invoices send.`, data });
    } else if (!def) {
      add({ id: 'accountTax', label: aLabel, status: 'warn', detail: `Account ${accountCode} has no default tax type. Premarket invoices set ${ZERO_GST_TAX_TYPE} on every line, so they are unaffected.`, data });
    } else if (Number(defRate?.EffectiveRate) > 0) {
      add({ id: 'accountTax', label: aLabel, status: 'warn', detail: `Account ${accountCode} defaults to "${defRate?.Name || def}" (${defRate.EffectiveRate}% GST). Premarket invoices set ${ZERO_GST_TAX_TYPE} explicitly so they charge no GST, but any invoice created by hand in Xero for this account would default to GST. Consider changing the account default in Xero.`, data });
    } else {
      add({ id: 'accountTax', label: aLabel, status: 'warn', detail: `Account ${accountCode} defaults to "${defRate?.Name || def}", not BAS Excluded. Premarket invoices set ${ZERO_GST_TAX_TYPE} explicitly, so they are unaffected.`, data });
    }
  }

  // 6. HPH / office contacts: what would the invoice run do? ------------------------
  for (const oc of officeContacts) {
    const label = `Xero contact for ${oc.billingName || oc.billingEntityKey}`;
    try {
      let stored = null;
      if (oc.storedContactId) stored = await call('getContactById', oc.storedContactId);
      const byName = oc.billingName ? await call('searchContactByName', oc.billingName) : null;
      const legacy = oc.billingName ? await call('searchContactByName', disambiguatedXeroContactName(oc.billingName, oc.billingEntityKey)) : null;
      const confirmed = { abn: oc.abn, email: oc.email };

      let plan; let status = 'pass'; let detail;
      if (stored?.ContactID) {
        if (stored.ContactStatus === 'ARCHIVED') { status = 'fail'; detail = 'The remembered Xero contact is ARCHIVED — restore it in Xero before invoicing.'; plan = 'blocked: archived contact'; }
        else { detail = 'A remembered Xero contact already exists and would be used directly.'; plan = 'reuse remembered contact'; }
      } else if (!byName) {
        detail = `No Xero contact named "${oc.billingName}" exists yet. The first invoice run will create exactly one, with the legal name, ABN and accounts email.`;
        plan = 'create one contact with the legal billing name';
      } else if (byName.ContactStatus === 'ARCHIVED') {
        status = 'warn'; detail = `A contact named "${oc.billingName}" exists but is ARCHIVED.`; plan = 'archived contact would be matched — restore or rename it first';
      } else if (isSameBillingEntityContact(byName, confirmed)) {
        detail = `A contact named "${oc.billingName}" already exists with the same ABN/accounts email and would be reused.`; plan = 'reuse the existing contact';
      } else {
        status = 'warn'; detail = `A Xero contact named "${oc.billingName}" already exists but its ABN/email do not match HPH's — the run would create a SUFFIXED contact name instead, which would print on the invoice.`; plan = 'would create a suffixed contact name';
      }
      if (legacy) { status = status === 'fail' ? status : 'warn'; detail += ` A legacy suffixed contact "${legacy.Name}" also exists.`; }
      add({
        id: `contact:${oc.billingEntityKey}`, label, status, detail, plan,
        data: {
          storedContactId: oc.storedContactId || null,
          byName: byName ? pick(byName, ['ContactID', 'Name', 'ContactStatus', 'EmailAddress', 'TaxNumber']) : null,
          legacySuffixed: legacy ? pick(legacy, ['ContactID', 'Name', 'ContactStatus']) : null,
        },
      });
    } catch (err) {
      add({ id: `contact:${oc.billingEntityKey}`, label, status: 'fail', detail: `Could not check the contact: ${short(err)}` });
    }
  }
  if (officeContacts.length === 0) {
    add({ id: 'contacts', label: 'Office (HPH) Xero contact', status: 'warn', detail: 'No confirmed office billing contact was found in Premarket, so no Xero contact was checked.' });
  }

  // 7. Old Premarket diagnostic test records ---------------------------------------------------
  try {
    const testContact = await call('searchContactByName', OLD_TEST_CONTACT_NAME);
    const found = new Map();
    for (const ref of OLD_TEST_REFERENCES) {
      for (const inv of await call('listInvoicesByReference', ref)) found.set(inv.InvoiceID, inv);
    }
    if (testContact?.ContactID) {
      for (const inv of await call('listInvoicesForContact', testContact.ContactID)) found.set(inv.InvoiceID, inv);
    }
    const invoices = [...found.values()].map((i) => pick(i, ['InvoiceID', 'InvoiceNumber', 'Status', 'Reference', 'Total', 'DateString', 'Date']));
    const historical = invoices.filter((i) => HISTORICAL_STATUSES.includes(i.Status));
    const live = invoices.filter((i) => !HISTORICAL_STATUSES.includes(i.Status));
    const nonDraftLive = live.filter((i) => i.Status !== 'DRAFT');

    if (invoices.length === 0) {
      add({ id: 'leftovers', label: 'Old diagnostic test invoices', status: 'pass', detail: 'No old Premarket diagnostic test invoices were found.' });
    } else if (live.length === 0) {
      add({
        id: 'leftovers', label: 'Old diagnostic test invoices', status: 'pass',
        detail: `${historical.length} old test invoice${historical.length === 1 ? '' : 's'} exist only as historical ${[...new Set(historical.map((i) => i.Status))].join('/')} records (${historical.map((i) => i.InvoiceNumber || i.InvoiceID).join(', ')}). They were never sent or paid and post nothing to your accounts — nothing to clean up. Their invoice numbers stay used.`,
        data: { invoices, historicalOnly: true },
      });
    } else {
      add({
        id: 'leftovers', label: 'Old diagnostic test invoices', status: 'warn',
        detail: `${live.length} live old test invoice${live.length === 1 ? '' : 's'} found${nonDraftLive.length ? ` — ${nonDraftLive.length} are NOT drafts and need a closer look` : ' (all drafts)'}.${historical.length ? ` ${historical.length} more are already deleted/voided history.` : ''} These were never emailed; clean them up in Xero when convenient.`,
        data: { invoices },
        cleanup: [
          'In Xero: Business > Invoices > Draft, search the reference shown, open each test invoice and Delete it (a never-authorised draft leaves no trace).',
          'Do NOT authorise or send any of them. Premarket never does.',
        ],
      });
    }

    if (!testContact) {
      add({ id: 'testContact', label: 'Old diagnostic test contact', status: 'pass', detail: 'No old diagnostic test contact exists.' });
    } else if (testContact.ContactStatus === 'ARCHIVED') {
      add({ id: 'testContact', label: 'Old diagnostic test contact', status: 'pass', detail: 'The old diagnostic test contact is already archived.', data: pick(testContact, ['ContactID', 'Name', 'ContactStatus']) });
    } else {
      add({
        id: 'testContact', label: 'Old diagnostic test contact', status: 'info',
        detail: `Optional tidy-up: the test contact "${testContact.Name}" is still active (it is not used by billing and does not block anything).`,
        optional: true,
        data: pick(testContact, ['ContactID', 'Name', 'ContactStatus', 'EmailAddress']),
        cleanup: ['In Xero: Contacts > find the test contact > Archive it (archive rather than delete — it has invoice history).'],
      });
    }
  } catch (err) {
    add({ id: 'leftovers', label: 'Old diagnostic test records', status: 'fail', detail: `Could not search for old test records: ${short(err)}` });
  }

  const blockers = checks.filter((c) => c.status === 'fail').map((c) => `${c.label}: ${c.detail}`);
  const warnings = checks.filter((c) => c.status === 'warn').map((c) => `${c.label}: ${c.detail}`);
  const optionalTasks = checks.filter((c) => c.optional).map((c) => `${c.label}: ${c.detail}`);
  return {
    readOnly: true,
    checkedAt: now().toISOString(),
    ready: blockers.length === 0,
    blockers,
    warnings,
    optionalTasks,
    checks,
    organisation: org ? pick(org, ['Name', 'LegalName', 'IsDemoCompany']) : null,
    xeroReadFunctionsUsed: [...new Set(calls)],
  };
}
