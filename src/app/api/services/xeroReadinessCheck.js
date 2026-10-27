import { disambiguatedXeroContactName, isSameBillingEntityContact } from './xeroInvoiceIdentity';

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
 *   2. Does the invoice revenue account code exist, is it active and suitable?
 *   3. Is the "NONE" (no GST) tax type available for revenue lines?
 *   4. Does an HPH contact already exist, and what would the invoice run do?
 *   5. Are any old Premarket diagnostic test contacts / draft invoices still there?
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

  // 1. Connection + organisation identity ------------------------------------------------
  let org = null;
  try {
    org = await call('getOrganisation');
    if (!org?.Name) {
      add({ id: 'organisation', label: 'Connection and organisation', status: 'fail', detail: 'Xero did not return an organisation for the stored connection.' });
    } else if (org.IsDemoCompany === true) {
      add({ id: 'organisation', label: 'Connection and organisation', status: 'fail', detail: `Connected to the Xero DEMO company "${org.Name}", not a live organisation. Invoices would go nowhere real.`, data: pick(org, ['Name', 'LegalName', 'IsDemoCompany']) });
    } else {
      add({
        id: 'organisation', label: 'Connection and organisation', status: 'pass',
        detail: `Connected to "${org.Name}"${org.LegalName && org.LegalName !== org.Name ? ` (${org.LegalName})` : ''}. Confirm this is the Premarket organisation.`,
        data: pick(org, ['Name', 'LegalName', 'OrganisationType', 'CountryCode', 'BaseCurrency', 'IsDemoCompany', 'OrganisationStatus', 'PaysTax', 'TaxNumber']),
      });
    }
  } catch (err) {
    add({ id: 'organisation', label: 'Connection and organisation', status: 'fail', detail: `Could not reach Xero: ${short(err)}` });
  }

  // 2. Revenue account code ----------------------------------------------------------------
  try {
    const acct = await call('getAccountByCode', accountCode);
    if (!acct) {
      add({ id: 'account', label: `Account code ${accountCode}`, status: 'fail', detail: `No account with code ${accountCode} exists in this organisation.` });
    } else {
      const active = acct.Status === 'ACTIVE';
      const revenue = acct.Class === 'REVENUE' || REVENUE_TYPES.includes(acct.Type);
      const data = pick(acct, ['Code', 'Name', 'Type', 'Class', 'Status', 'TaxType']);
      if (active && revenue) add({ id: 'account', label: `Account code ${accountCode}`, status: 'pass', detail: `"${acct.Name}" is an active ${acct.Type || acct.Class} account.`, data });
      else add({ id: 'account', label: `Account code ${accountCode}`, status: 'fail', detail: `Account ${accountCode} "${acct.Name}" is ${active ? '' : 'not active and '}${revenue ? 'a revenue account' : `not a revenue account (type ${acct.Type}, class ${acct.Class})`} — it cannot be used for invoice lines.`, data });
    }
  } catch (err) {
    add({ id: 'account', label: `Account code ${accountCode}`, status: 'fail', detail: `Could not check the account: ${short(err)}` });
  }

  // 3. Tax type NONE --------------------------------------------------------------------------
  try {
    const rates = await call('getTaxRates');
    const none = rates.find((r) => r.TaxType === 'NONE');
    const output = rates.find((r) => r.TaxType === 'OUTPUT');
    if (!none) add({ id: 'taxType', label: 'Tax type NONE (no GST)', status: 'fail', detail: 'The "NONE" tax type was not found in this organisation.' });
    else if (none.Status && none.Status !== 'ACTIVE') add({ id: 'taxType', label: 'Tax type NONE (no GST)', status: 'fail', detail: `The "NONE" tax type exists but is ${none.Status}.`, data: pick(none, ['Name', 'TaxType', 'Status']) });
    else if (none.CanApplyToRevenue === false) add({ id: 'taxType', label: 'Tax type NONE (no GST)', status: 'fail', detail: 'The "NONE" tax type cannot be applied to revenue lines.', data: pick(none, ['Name', 'TaxType', 'Status', 'CanApplyToRevenue']) });
    else add({ id: 'taxType', label: 'Tax type NONE (no GST)', status: 'pass', detail: `"${none.Name}" is available for revenue lines (zero GST).${output ? ` For information only, "OUTPUT" (${output.Name}) is also present and is NOT used.` : ''}`, data: pick(none, ['Name', 'TaxType', 'Status', 'CanApplyToRevenue']) });
  } catch (err) {
    add({ id: 'taxType', label: 'Tax type NONE (no GST)', status: 'fail', detail: `Could not read tax rates: ${short(err)}` });
  }

  // 4. HPH / office contacts: what would the invoice run do? ------------------------
  const contactResults = [];
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
      const result = {
        id: `contact:${oc.billingEntityKey}`, label, status, detail, plan,
        data: {
          storedContactId: oc.storedContactId || null,
          byName: byName ? pick(byName, ['ContactID', 'Name', 'ContactStatus', 'EmailAddress', 'TaxNumber']) : null,
          legacySuffixed: legacy ? pick(legacy, ['ContactID', 'Name', 'ContactStatus']) : null,
        },
      };
      contactResults.push(result); add(result);
    } catch (err) {
      add({ id: `contact:${oc.billingEntityKey}`, label, status: 'fail', detail: `Could not check the contact: ${short(err)}` });
    }
  }
  if (officeContacts.length === 0) {
    add({ id: 'contacts', label: 'Office (HPH) Xero contact', status: 'warn', detail: 'No confirmed office billing contact was found in Premarket, so no Xero contact was checked.' });
  }

  // 5. Leftover Premarket diagnostic test records -------------------------------------------
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
    const nonDraft = invoices.filter((i) => i.Status !== 'DRAFT');
    if (!testContact && invoices.length === 0) {
      add({ id: 'leftovers', label: 'Old diagnostic test records', status: 'pass', detail: 'No old Premarket diagnostic test contact or invoices were found.' });
    } else {
      add({
        id: 'leftovers', label: 'Old diagnostic test records', status: 'warn',
        detail: `${testContact ? 'The old test contact exists. ' : ''}${invoices.length} test invoice${invoices.length === 1 ? '' : 's'} found${nonDraft.length ? ` — ${nonDraft.length} are NOT drafts and need a closer look` : ' (all drafts)'}. These were never emailed; clean them up in Xero when convenient.`,
        data: { testContact: testContact ? pick(testContact, ['ContactID', 'Name', 'ContactStatus', 'EmailAddress']) : null, invoices },
        cleanup: [
          'In Xero: Business > Invoices > Draft, search the reference shown, open each test invoice and Delete it (a never-authorised draft leaves no trace).',
          'Then archive the test contact (Contacts > select > Archive), or delete it if it has no transactions.',
          'Do NOT authorise or send any of them. Premarket never does.',
        ],
      });
    }
  } catch (err) {
    add({ id: 'leftovers', label: 'Old diagnostic test records', status: 'fail', detail: `Could not search for old test records: ${short(err)}` });
  }

  const blockers = checks.filter((c) => c.status === 'fail').map((c) => `${c.label}: ${c.detail}`);
  const warnings = checks.filter((c) => c.status === 'warn').map((c) => `${c.label}: ${c.detail}`);
  return {
    readOnly: true,
    checkedAt: now().toISOString(),
    ready: blockers.length === 0,
    blockers,
    warnings,
    checks,
    organisation: org ? pick(org, ['Name', 'LegalName', 'IsDemoCompany']) : null,
    xeroReadFunctionsUsed: [...new Set(calls)],
  };
}
