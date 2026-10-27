import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import {
  runXeroReadinessCheck,
  ALLOWED_XERO_READERS,
  OLD_TEST_CONTACT_NAME,
  OLD_TEST_REFERENCES,
} from '../../src/app/api/services/xeroReadinessCheck';

const LEGAL = 'Results Realty (QLD) Pty Ltd ATF Results Realty Trust trading as Harcourts Property Hub';
const HPH_KEY = 'office:ioxigzf4hcRtowqL4C94';
const hph = (over = {}) => ({ billingEntityKey: HPH_KEY, billingName: LEGAL, abn: '68 677 191 726', email: 'Chris@propertyhubgc.com.au', storedContactId: null, ...over });

// A fake, read-only Xero. Anything not configured returns the "healthy, clean org" answer.
function makeXero(over = {}) {
  return {
    getOrganisation: vi.fn(async () => ({ Name: 'Premarket Group Pty Ltd', LegalName: 'Premarket Group Pty Ltd', IsDemoCompany: false, OrganisationType: 'COMPANY', CountryCode: 'AU', BaseCurrency: 'AUD', OrganisationStatus: 'ACTIVE', PaysTax: false, SalesTaxBasis: 'NONE', SalesTaxPeriod: 'QUARTERLY1', DefaultSalesTax: 'Tax Exclusive' })),
    getAccountByCode: vi.fn(async (code) => ({ Code: code, Name: 'Sales', Type: 'REVENUE', Class: 'REVENUE', Status: 'ACTIVE', TaxType: 'BASEXCLUDED' })),
    getTaxRates: vi.fn(async () => [
      { Name: 'GST on Income', TaxType: 'OUTPUT', Status: 'ACTIVE', EffectiveRate: 10, CanApplyToRevenue: true },
      { Name: 'BAS Excluded', TaxType: 'BASEXCLUDED', Status: 'ACTIVE', EffectiveRate: 0, CanApplyToRevenue: true },
      { Name: 'GST Free Income', TaxType: 'EXEMPTOUTPUT', Status: 'ACTIVE', EffectiveRate: 0, CanApplyToRevenue: true },
    ]),
    searchContactByName: vi.fn(async () => null),
    getContactById: vi.fn(async () => null),
    listInvoicesByReference: vi.fn(async () => []),
    listInvoicesForContact: vi.fn(async () => []),
    ...over,
  };
}
const byId = (r, id) => r.checks.find((c) => c.id === id);
const run = (xero, extra = {}) => runXeroReadinessCheck({ xero, accountCode: '200', officeContacts: [hph()], now: () => new Date('2026-11-01T00:00:00Z'), ...extra });

describe('Xero readiness check: a clean, ready organisation', () => {
  it('passes every check, reports ready with no blockers, and says it is read-only', async () => {
    const r = await run(makeXero());
    expect(r.readOnly).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.checkedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(byId(r, 'organisation')).toMatchObject({ status: 'pass' });
    expect(byId(r, 'organisation').detail).toMatch(/Premarket Group Pty Ltd/);
    expect(byId(r, 'account')).toMatchObject({ status: 'pass' });
    expect(byId(r, 'taxType')).toMatchObject({ status: 'pass' });
    expect(byId(r, 'accountTax')).toMatchObject({ status: 'pass' });
    expect(byId(r, 'gstRegistration')).toMatchObject({ status: 'pass' });
    expect(byId(r, `contact:${HPH_KEY}`)).toMatchObject({ status: 'pass', plan: 'create one contact with the legal billing name' });
    expect(byId(r, 'leftovers')).toMatchObject({ status: 'pass' });
    expect(byId(r, 'testContact')).toMatchObject({ status: 'pass' });
  });

  it('reports which read functions it used (transparency), and only read functions', async () => {
    const r = await run(makeXero());
    expect(r.xeroReadFunctionsUsed.sort()).toEqual([
      'getAccountByCode', 'getOrganisation', 'getTaxRates', 'listInvoicesByReference', 'searchContactByName',
    ].sort());
    for (const fn of r.xeroReadFunctionsUsed) expect(ALLOWED_XERO_READERS).toContain(fn);
  });

  it('checks the configured account code, not a hard-coded one', async () => {
    const xero = makeXero();
    await runXeroReadinessCheck({ xero, accountCode: '260', officeContacts: [] });
    expect(xero.getAccountByCode).toHaveBeenCalledWith('260');
  });

  it('never leaks tokens or secrets in its result', async () => {
    const r = await run(makeXero());
    expect(JSON.stringify(r)).not.toMatch(/access_token|refresh_token|client_secret|Bearer/i);
  });
});

describe('connection and organisation identity', () => {
  it('FAILS when connected to the Xero DEMO company', async () => {
    const r = await run(makeXero({ getOrganisation: vi.fn(async () => ({ Name: 'Demo Company (AU)', IsDemoCompany: true })) }));
    expect(byId(r, 'organisation')).toMatchObject({ status: 'fail' });
    expect(byId(r, 'organisation').detail).toMatch(/DEMO/);
    expect(r.ready).toBe(false);
  });
  it('FAILS with a clear message when Xero cannot be reached (and still runs the other checks)', async () => {
    const r = await run(makeXero({ getOrganisation: vi.fn(async () => { throw new Error('Xero API GET /Organisation failed (401): unauthorized'); }) }));
    expect(byId(r, 'organisation')).toMatchObject({ status: 'fail' });
    expect(byId(r, 'organisation').detail).toMatch(/Could not reach Xero/);
    expect(byId(r, 'account')).toBeTruthy();
    expect(byId(r, 'taxType')).toBeTruthy();
    expect(r.ready).toBe(false);
  });
  it('FAILS when Xero returns no organisation', async () => {
    const r = await run(makeXero({ getOrganisation: vi.fn(async () => null) }));
    expect(byId(r, 'organisation').status).toBe('fail');
  });
});

describe('revenue account code', () => {
  it('FAILS when the code does not exist', async () => {
    const r = await run(makeXero({ getAccountByCode: vi.fn(async () => null) }));
    expect(byId(r, 'account')).toMatchObject({ status: 'fail' });
    expect(byId(r, 'account').detail).toMatch(/No account with code 200/);
    expect(r.ready).toBe(false);
  });
  it('FAILS when the account is archived', async () => {
    const r = await run(makeXero({ getAccountByCode: vi.fn(async () => ({ Code: '200', Name: 'Sales', Type: 'REVENUE', Class: 'REVENUE', Status: 'ARCHIVED' })) }));
    expect(byId(r, 'account')).toMatchObject({ status: 'fail' });
    expect(byId(r, 'account').detail).toMatch(/not active/);
  });
  it('FAILS when the account is not a revenue account (e.g. an expense)', async () => {
    const r = await run(makeXero({ getAccountByCode: vi.fn(async () => ({ Code: '200', Name: 'Rent', Type: 'EXPENSE', Class: 'EXPENSE', Status: 'ACTIVE' })) }));
    expect(byId(r, 'account')).toMatchObject({ status: 'fail' });
    expect(byId(r, 'account').detail).toMatch(/not a revenue account/);
  });
  it.each(['REVENUE', 'SALES', 'OTHERINCOME'])('accepts an active %s account', async (Type) => {
    const r = await run(makeXero({ getAccountByCode: vi.fn(async () => ({ Code: '200', Name: 'X', Type, Class: 'EQUITY', Status: 'ACTIVE' })) }));
    expect(byId(r, 'account').status).toBe('pass');
  });
  it('reports an error from Xero as a failure, not a crash', async () => {
    const r = await run(makeXero({ getAccountByCode: vi.fn(async () => { throw new Error('Xero API GET /Accounts failed (403)'); }) }));
    expect(byId(r, 'account').status).toBe('fail');
    expect(byId(r, 'account').detail).toMatch(/403/);
  });
});

describe('tax type BASEXCLUDED (BAS Excluded, no GST)', () => {
  const rates = (...r) => vi.fn(async () => r);
  const BAS = { Name: 'BAS Excluded', TaxType: 'BASEXCLUDED', Status: 'ACTIVE', EffectiveRate: 0, CanApplyToRevenue: true };

  it('REGRESSION: a real Australian org has NO "NONE" rate, and that is fine — BAS Excluded is what is verified', async () => {
    const r = await run(makeXero({ getTaxRates: rates({ Name: 'GST on Income', TaxType: 'OUTPUT', Status: 'ACTIVE', EffectiveRate: 10, CanApplyToRevenue: true }, BAS) }));
    expect(byId(r, 'taxType').status).toBe('pass');
    expect(r.ready).toBe(true);
    expect(r.checks.some((c) => /NONE/.test(c.label))).toBe(false);
  });
  it('FAILS when BAS Excluded is missing', async () => {
    const r = await run(makeXero({ getTaxRates: rates({ Name: 'GST', TaxType: 'OUTPUT', Status: 'ACTIVE', EffectiveRate: 10 }) }));
    expect(byId(r, 'taxType').status).toBe('fail');
    expect(r.ready).toBe(false);
  });
  it('FAILS when BAS Excluded is not active', async () => {
    expect(byId(await run(makeXero({ getTaxRates: rates({ ...BAS, Status: 'ARCHIVED' }) })), 'taxType').status).toBe('fail');
  });
  it('FAILS when BAS Excluded cannot be applied to revenue', async () => {
    expect(byId(await run(makeXero({ getTaxRates: rates({ ...BAS, CanApplyToRevenue: false }) })), 'taxType').status).toBe('fail');
  });
  it('FAILS if the rate would actually charge GST', async () => {
    const t = byId(await run(makeXero({ getTaxRates: rates({ ...BAS, EffectiveRate: 10 }) })), 'taxType');
    expect(t.status).toBe('fail');
    expect(t.detail).toMatch(/would charge GST/);
  });
  it('passes, noting GST on Income exists but is NOT used', async () => {
    expect(byId(await run(makeXero()), 'taxType').detail).toMatch(/NOT used/);
  });
  it('a tax-rate read error fails both the tax-type and account-default checks without crashing', async () => {
    const r = await run(makeXero({ getTaxRates: vi.fn(async () => { throw new Error('Xero API GET /TaxRates failed (403)'); }) }));
    expect(byId(r, 'taxType').status).toBe('fail');
    expect(byId(r, 'accountTax')).toBeUndefined();
  });
});

describe('account default tax treatment', () => {
  const acct = (TaxType) => vi.fn(async () => ({ Code: '200', Name: 'Sales', Type: 'REVENUE', Class: 'REVENUE', Status: 'ACTIVE', ...(TaxType ? { TaxType } : {}) }));
  it('passes when account 200 defaults to BAS Excluded (the correct no-GST treatment)', async () => {
    const t = byId(await run(makeXero()), 'accountTax');
    expect(t.status).toBe('pass');
    expect(t.detail).toMatch(/correct no-GST treatment/);
  });
  it('WARNS (not blocks) when the account defaults to GST on Income — invoices set the type explicitly, but hand-made ones would charge GST', async () => {
    const r = await run(makeXero({ getAccountByCode: acct('OUTPUT') }));
    const t = byId(r, 'accountTax');
    expect(t.status).toBe('warn');
    expect(t.detail).toMatch(/10% GST/);
    expect(t.detail).toMatch(/explicitly/);
    expect(r.ready).toBe(true);
  });
  it('WARNS when the account defaults to another zero-rated type (e.g. GST Free Income)', async () => {
    const t = byId(await run(makeXero({ getAccountByCode: acct('EXEMPTOUTPUT') })), 'accountTax');
    expect(t.status).toBe('warn');
    expect(t.detail).toMatch(/not BAS Excluded/);
  });
  it('WARNS when the account has no default tax type', async () => {
    expect(byId(await run(makeXero({ getAccountByCode: acct(undefined) })), 'accountTax').status).toBe('warn');
  });
  it('is skipped (no false alarm) when the account itself could not be found', async () => {
    expect(byId(await run(makeXero({ getAccountByCode: vi.fn(async () => null) })), 'accountTax')).toBeUndefined();
  });
});

describe('GST registration as configured in Xero', () => {
  it('passes and reports the configuration when the org is NOT registered (Premarket\'s actual status)', async () => {
    const g = byId(await run(makeXero()), 'gstRegistration');
    expect(g.status).toBe('pass');
    expect(g.detail).toMatch(/NOT registered for GST/);
    expect(g.data).toMatchObject({ PaysTax: false, SalesTaxBasis: 'NONE', SalesTaxPeriod: 'QUARTERLY1' });
  });
  it('WARNS when Xero has the org set up to collect GST while invoices carry none', async () => {
    const g = byId(await run(makeXero({ getOrganisation: vi.fn(async () => ({ Name: 'Premarket Group Pty Ltd', IsDemoCompany: false, PaysTax: true, SalesTaxBasis: 'ACCRUALS', SalesTaxPeriod: 'QUARTERLY1' })) })), 'gstRegistration');
    expect(g.status).toBe('warn');
    expect(g.detail).toMatch(/accountant/);
  });
  it('WARNS when Xero does not say', async () => {
    expect(byId(await run(makeXero({ getOrganisation: vi.fn(async () => ({ Name: 'X', IsDemoCompany: false })) })), 'gstRegistration').status).toBe('warn');
  });
  it('is not reported when the organisation could not be read', async () => {
    expect(byId(await run(makeXero({ getOrganisation: vi.fn(async () => { throw new Error('down'); }) })), 'gstRegistration')).toBeUndefined();
  });
});

describe('the HPH contact: what would the invoice run do?', () => {
  it('no contact yet -> a clean first run creates exactly one, under the legal name', async () => {
    const xero = makeXero();
    const r = await run(xero);
    const c = byId(r, `contact:${HPH_KEY}`);
    expect(c.status).toBe('pass');
    expect(c.detail).toMatch(/will create exactly one/);
    expect(xero.searchContactByName).toHaveBeenCalledWith(LEGAL);
  });
  it('an existing contact for the SAME entity (ABN) would be reused', async () => {
    const r = await run(makeXero({ searchContactByName: vi.fn(async (n) => (n === LEGAL ? { ContactID: 'c1', Name: LEGAL, TaxNumber: '68677191726', ContactStatus: 'ACTIVE' } : null)) }));
    expect(byId(r, `contact:${HPH_KEY}`)).toMatchObject({ status: 'pass', plan: 'reuse the existing contact' });
  });
  it('WARNS when the name belongs to a DIFFERENT entity (a suffixed name would print on the invoice)', async () => {
    const r = await run(makeXero({ searchContactByName: vi.fn(async (n) => (n === LEGAL ? { ContactID: 'c2', Name: LEGAL, TaxNumber: '11111111111', EmailAddress: 'x@y.com' } : null)) }));
    const c = byId(r, `contact:${HPH_KEY}`);
    expect(c.status).toBe('warn');
    expect(c.plan).toBe('would create a suffixed contact name');
    expect(r.ready).toBe(true);                  // a warning, not a blocker
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('uses the remembered contact id directly when there is one', async () => {
    const xero = makeXero({ getContactById: vi.fn(async () => ({ ContactID: 'stored1', Name: LEGAL, ContactStatus: 'ACTIVE' })) });
    const r = await run(xero, { officeContacts: [hph({ storedContactId: 'stored1' })] });
    expect(xero.getContactById).toHaveBeenCalledWith('stored1');
    expect(byId(r, `contact:${HPH_KEY}`)).toMatchObject({ status: 'pass', plan: 'reuse remembered contact' });
  });
  it('FAILS when the remembered contact is archived', async () => {
    const r = await run(makeXero({ getContactById: vi.fn(async () => ({ ContactID: 's', Name: LEGAL, ContactStatus: 'ARCHIVED' })) }), { officeContacts: [hph({ storedContactId: 's' })] });
    expect(byId(r, `contact:${HPH_KEY}`).status).toBe('fail');
    expect(r.ready).toBe(false);
  });
  it('WARNS about a legacy suffixed contact such as "… (ioxigzf4)"', async () => {
    const r = await run(makeXero({ searchContactByName: vi.fn(async (n) => (n === `${LEGAL} (ioxigzf4)` ? { ContactID: 'legacy', Name: n } : null)) }));
    expect(byId(r, `contact:${HPH_KEY}`).status).toBe('warn');
    expect(byId(r, `contact:${HPH_KEY}`).detail).toMatch(/legacy suffixed contact/);
  });
  it('a lookup error becomes a failure for that contact only', async () => {
    const r = await run(makeXero({ searchContactByName: vi.fn(async (n) => { if (n === LEGAL) throw new Error('Xero API GET /Contacts failed (429)'); return null; }) }));
    expect(byId(r, `contact:${HPH_KEY}`).status).toBe('fail');
  });
  it('with no confirmed office billing contact it warns and checks no contact', async () => {
    const r = await run(makeXero(), { officeContacts: [] });
    expect(byId(r, 'contacts').status).toBe('warn');
  });
  it('checks every confirmed office contact', async () => {
    const r = await run(makeXero(), { officeContacts: [hph(), hph({ billingEntityKey: 'office:other', billingName: 'Other Realty Pty Ltd' })] });
    expect(r.checks.filter((c) => c.id.startsWith('contact:'))).toHaveLength(2);
  });
});

describe('old Premarket diagnostic test records', () => {
  const testContact = { ContactID: 'tc1', Name: OLD_TEST_CONTACT_NAME, ContactStatus: 'ACTIVE', EmailAddress: 'xero-diagnostic-test@premarket.homes' };
  const inv = (id, ref, Status, extra = {}) => ({ InvoiceID: id, InvoiceNumber: id, Status, Reference: ref, Total: 200, ...extra });
  const withTestRecords = (invoices, contact = testContact) => makeXero({
    searchContactByName: vi.fn(async (n) => (n === OLD_TEST_CONTACT_NAME ? contact : null)),
    listInvoicesByReference: vi.fn(async (ref) => invoices.filter((i) => i.Reference === ref)),
    listInvoicesForContact: vi.fn(async () => invoices),
  });

  it('looks for the old test contact and BOTH old references', async () => {
    const xero = makeXero();
    await run(xero);
    expect(xero.searchContactByName).toHaveBeenCalledWith(OLD_TEST_CONTACT_NAME);
    for (const ref of OLD_TEST_REFERENCES) expect(xero.listInvoicesByReference).toHaveBeenCalledWith(ref);
  });

  it('REGRESSION (our real Xero): two DELETED test invoices are historical records, not active leftovers; the active test contact is an OPTIONAL archive task', async () => {
    const r = await run(withTestRecords([
      inv('INV-0001', OLD_TEST_REFERENCES[0], 'DELETED', { Total: 200 }),
      inv('INV-0002', OLD_TEST_REFERENCES[1], 'DELETED', { Total: 1000 }),
    ]));
    const l = byId(r, 'leftovers');
    expect(l.status).toBe('pass');
    expect(l.detail).toMatch(/historical DELETED records/);
    expect(l.detail).toMatch(/INV-0001, INV-0002/);
    expect(l.detail).toMatch(/nothing to clean up/);
    expect(l.data.historicalOnly).toBe(true);
    expect(l.cleanup).toBeUndefined();
    const t = byId(r, 'testContact');
    expect(t.status).toBe('info');
    expect(t.optional).toBe(true);
    expect(t.detail).toMatch(/Optional tidy-up/);
    expect(t.cleanup.join(' ')).toMatch(/Archive/);
    expect(r.warnings).toEqual([]);                    // nothing here is a warning
    expect(r.optionalTasks).toHaveLength(1);
    expect(r.ready).toBe(true);
  });

  it('VOIDED invoices are historical too', async () => {
    const l = byId(await run(withTestRecords([inv('INV-9', OLD_TEST_REFERENCES[0], 'VOIDED')])), 'leftovers');
    expect(l.status).toBe('pass');
    expect(l.detail).toMatch(/VOIDED/);
  });

  it('a LIVE draft is an active leftover: warn, with cleanup steps (and no cleanup is performed)', async () => {
    const r = await run(withTestRecords([inv('d1', OLD_TEST_REFERENCES[0], 'DRAFT')]));
    const l = byId(r, 'leftovers');
    expect(l.status).toBe('warn');
    expect(l.detail).toMatch(/1 live old test invoice found \(all drafts\)/);
    expect(l.cleanup.join(' ')).toMatch(/Delete it/);
    expect(l.cleanup.join(' ')).toMatch(/Do NOT authorise or send/);
    expect(r.ready).toBe(true);                        // leftovers never block HPH billing
  });

  it('flags any live leftover that is NOT a draft (authorised/paid), and mentions the deleted history', async () => {
    const l = byId(await run(withTestRecords([
      inv('p1', OLD_TEST_REFERENCES[0], 'AUTHORISED'),
      inv('x1', OLD_TEST_REFERENCES[1], 'DELETED'),
    ])), 'leftovers');
    expect(l.status).toBe('warn');
    expect(l.detail).toMatch(/1 are NOT drafts/);
    expect(l.detail).toMatch(/1 more are already deleted\/voided history/);
  });

  it('de-duplicates an invoice found by reference AND under the contact', async () => {
    const same = inv('d1', OLD_TEST_REFERENCES[0], 'DELETED');
    const l = byId(await run(withTestRecords([same])), 'leftovers');
    expect(l.data.invoices).toHaveLength(1);
  });

  it('an ARCHIVED test contact is reported as done', async () => {
    const t = byId(await run(withTestRecords([], { ...testContact, ContactStatus: 'ARCHIVED' })), 'testContact');
    expect(t.status).toBe('pass');
    expect(t.detail).toMatch(/already archived/);
  });

  it('an active test contact with no invoices at all is still just an optional tidy-up', async () => {
    const r = await run(withTestRecords([]));
    expect(byId(r, 'leftovers').status).toBe('pass');
    expect(byId(r, 'testContact').status).toBe('info');
    expect(r.optionalTasks).toHaveLength(1);
  });

  it('no old test contact and no invoices: everything passes', async () => {
    const r = await run(makeXero());
    expect(byId(r, 'leftovers').status).toBe('pass');
    expect(byId(r, 'testContact').status).toBe('pass');
    expect(r.optionalTasks).toEqual([]);
  });

  it('an error is reported, not thrown', async () => {
    const l = byId(await run(makeXero({ listInvoicesByReference: vi.fn(async () => { throw new Error('boom'); }) })), 'leftovers');
    expect(l.status).toBe('fail');
  });
});

describe('READ-ONLY by construction', () => {
  it('REFUSES to run if any non-read Xero function is passed in', async () => {
    for (const bad of ['createInvoice', 'sendInvoice', 'findOrCreateContact', 'createContact', 'voidInvoice', 'deleteInvoice', 'makeXeroRequest']) {
      await expect(runXeroReadinessCheck({ xero: { ...makeXero(), [bad]: vi.fn() }, officeContacts: [] })).rejects.toThrow(/refuses non-read Xero functions/);
    }
  });

  it('never calls a write function even when one is (impossibly) reachable: only allow-listed readers are invoked', async () => {
    const xero = makeXero();
    await run(xero);
    const called = Object.entries(xero).filter(([, fn]) => fn.mock.calls.length > 0).map(([k]) => k);
    for (const k of called) expect(ALLOWED_XERO_READERS).toContain(k);
  });

  it('the allow-list contains reads only', () => {
    for (const fn of ALLOWED_XERO_READERS) expect(fn).toMatch(/^(get|search|list)/);
  });

  it('the module source does not import or mention any write function or HTTP write verb', () => {
    const src = fs.readFileSync('src/app/api/services/xeroReadinessCheck.js', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/import[^;]*xeroService/);
    expect(src).not.toMatch(/makeXeroRequest|createInvoice|sendInvoice|findOrCreateContact|createContact|voidInvoice|deleteInvoice|fetch\(/);
    expect(src).not.toMatch(/['"](POST|PUT|PATCH|DELETE)['"]/);
  });

  it('the new Xero service helpers are GET-only', () => {
    const svc = fs.readFileSync('src/app/api/services/xeroService.js', 'utf-8');
    for (const name of ['getTaxRates', 'listInvoicesByReference', 'listInvoicesForContact', 'getContactById']) {
      const body = svc.slice(svc.indexOf(`export async function ${name}`), svc.indexOf('\n}\n', svc.indexOf(`export async function ${name}`)));
      expect(body).toMatch(/makeXeroRequest\('GET'/);
      expect(body).not.toMatch(/makeXeroRequest\('(POST|PUT|DELETE|PATCH)'/);
    }
  });
});
