import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

// Real xeroService against a FAKE Xero at the HTTP level: proves, from the requests actually
// made, that the readiness check only ever READS from the Xero API.
let tokenDoc; let tokenWrites;
const fakeDb = {
  collection: () => ({
    doc: () => ({
      async get() { return { exists: !!tokenDoc, data: () => tokenDoc }; },
      async set(data) { tokenWrites.push(data); tokenDoc = { ...tokenDoc, ...data }; },
    }),
  }),
};
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => fakeDb[p] }) }));

import * as xeroService from '../../src/app/api/services/xeroService';
import { runXeroReadinessCheck } from '../../src/app/api/services/xeroReadinessCheck';

const API = 'https://api.xero.com/api.xro/2.0';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const LEGAL = 'Results Realty (QLD) Pty Ltd ATF Results Realty Trust trading as Harcourts Property Hub';
let requests;

function fakeXero(overrides = {}) {
  return vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    requests.push({ url: String(url), method, body: init.body ?? null, headers: init.headers || {} });
    const u = String(url);
    const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
    if (u === TOKEN_URL) return json({ access_token: 'NEW_ACCESS', refresh_token: 'NEW_REFRESH', expires_in: 1800 });
    if (overrides[u]) return overrides[u]();
    if (u.startsWith(`${API}/Organisation`)) return json({ Organisations: [{ Name: 'Premarket Group Pty Ltd', IsDemoCompany: false, CountryCode: 'AU' }] });
    if (u.startsWith(`${API}/Accounts`)) return json({ Accounts: [{ Code: '200', Name: 'Sales', Type: 'REVENUE', Class: 'REVENUE', Status: 'ACTIVE' }] });
    if (u.startsWith(`${API}/TaxRates`)) return json({ TaxRates: [{ Name: 'BAS Excluded', TaxType: 'NONE', Status: 'ACTIVE', CanApplyToRevenue: true }] });
    if (u.startsWith(`${API}/Contacts`)) return json({ Contacts: [] });
    if (u.startsWith(`${API}/Invoices`)) return json({ Invoices: [] });
    return json({}, 404);
  });
}

const readers = () => ({
  getOrganisation: xeroService.getOrganisation, getAccountByCode: xeroService.getAccountByCode, getTaxRates: xeroService.getTaxRates,
  searchContactByName: xeroService.searchContactByName, getContactById: xeroService.getContactById,
  listInvoicesByReference: xeroService.listInvoicesByReference, listInvoicesForContact: xeroService.listInvoicesForContact,
});
const officeContacts = [{ billingEntityKey: 'office:hph', billingName: LEGAL, abn: '68 677 191 726', email: 'a@hph.test', storedContactId: null }];

beforeEach(() => {
  requests = []; tokenWrites = [];
  tokenDoc = { access_token: 'ACCESS_OLD', refresh_token: 'REFRESH_OLD', expires_at: Date.now() + 3600_000, tenant_id: 'TENANT-1' };
  process.env.XERO_CLIENT_ID = 'cid'; process.env.XERO_CLIENT_SECRET = 'csecret';
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('readiness check on the wire (real service, fake Xero server)', () => {
  it('with a valid token: every request is a GET to the Xero API, with no body, and nothing else is contacted', async () => {
    vi.stubGlobal('fetch', fakeXero());
    const result = await runXeroReadinessCheck({ xero: readers(), accountCode: '200', officeContacts });
    expect(result.ready).toBe(true);
    expect(requests.length).toBeGreaterThan(5);
    for (const r of requests) {
      expect(r.method).toBe('GET');
      expect(r.body).toBeNull();
      expect(r.url.startsWith(API)).toBe(true);
    }
    expect(requests.some((r) => r.url === TOKEN_URL)).toBe(false);              // no refresh needed -> no token call
    expect(tokenWrites).toHaveLength(0);                                        // nothing written anywhere
  });

  it('requests exactly the read endpoints it needs, correctly encoded, with the tenant header', async () => {
    vi.stubGlobal('fetch', fakeXero());
    await runXeroReadinessCheck({ xero: readers(), accountCode: '200', officeContacts });
    const urls = requests.map((r) => decodeURIComponent(r.url.replace(API, '')));
    expect(urls).toContain('/Organisation');
    expect(urls).toContain('/Accounts?where=Code=="200"');
    expect(urls).toContain('/TaxRates');
    expect(urls).toContain(`/Contacts?where=Name=="${LEGAL}"`);
    expect(urls).toContain('/Contacts?where=Name=="PREMARKET DIAGNOSTIC TEST — DO NOT USE"');
    expect(urls).toContain('/Invoices?where=Reference=="TEST — Premarket Xero connection diagnostic — safe to delete"');
    expect(urls).toContain('/Invoices?where=Reference=="TEST ONLY — DO NOT AUTHORISE OR SEND"');
    for (const r of requests) {
      expect(r.headers['Xero-tenant-id']).toBe('TENANT-1');
      expect(r.headers.Authorization).toBe('Bearer ACCESS_OLD');
    }
    // no create/modify path is ever requested
    expect(urls.join(' ')).not.toMatch(/\/Email|\/Void|\/Payments|\/CreditNotes|\/BankTransactions/);
  });

  it('with an EXPIRED token: the only non-GET request is the normal OAuth token refresh; all Xero API calls stay GET', async () => {
    tokenDoc.expires_at = Date.now() - 1000;
    vi.stubGlobal('fetch', fakeXero());
    const result = await runXeroReadinessCheck({ xero: readers(), accountCode: '200', officeContacts });
    expect(result.ready).toBe(true);
    const nonGet = requests.filter((r) => r.method !== 'GET');
    expect(nonGet).toHaveLength(1);
    expect(nonGet[0].url).toBe(TOKEN_URL);                                      // the ordinary refresh, nothing else
    expect(requests.filter((r) => r.url.startsWith(API)).every((r) => r.method === 'GET')).toBe(true);
    // the refreshed token is stored (the one accepted side effect) and later calls use it
    expect(tokenWrites).toHaveLength(1);
    expect(requests.filter((r) => r.url.startsWith(API)).every((r) => r.headers.Authorization === 'Bearer NEW_ACCESS')).toBe(true);
  });

  it('the result never contains a token, secret or Xero credential', async () => {
    vi.stubGlobal('fetch', fakeXero());
    const text = JSON.stringify(await runXeroReadinessCheck({ xero: readers(), accountCode: '200', officeContacts }));
    expect(text).not.toMatch(/ACCESS_OLD|REFRESH_OLD|NEW_ACCESS|NEW_REFRESH|csecret|TENANT-1/);
  });

  it('finds leftover drafts through the real list helpers, still GET-only', async () => {
    const draft = { InvoiceID: 'd1', InvoiceNumber: 'INV-1', Status: 'DRAFT', Reference: 'TEST ONLY — DO NOT AUTHORISE OR SEND', Total: 200 };
    vi.stubGlobal('fetch', fakeXero({
      [`${API}/Contacts?where=${encodeURIComponent('Name=="PREMARKET DIAGNOSTIC TEST — DO NOT USE"')}`]: () => ({ ok: true, status: 200, json: async () => ({ Contacts: [{ ContactID: 'tc1', Name: 'PREMARKET DIAGNOSTIC TEST — DO NOT USE' }] }), text: async () => '' }),
      [`${API}/Invoices?ContactIDs=tc1`]: () => ({ ok: true, status: 200, json: async () => ({ Invoices: [draft] }), text: async () => '' }),
    }));
    const result = await runXeroReadinessCheck({ xero: readers(), accountCode: '200', officeContacts: [] });
    const l = result.checks.find((c) => c.id === 'leftovers');
    expect(l.status).toBe('warn');
    expect(l.data.invoices.map((i) => i.InvoiceID)).toEqual(['d1']);
    expect(requests.every((r) => r.method === 'GET' || r.url === TOKEN_URL)).toBe(true);
  });

  it('a Xero error (e.g. 401/403) becomes a failed check, not a crash or a write', async () => {
    vi.stubGlobal('fetch', fakeXero({ [`${API}/Organisation`]: () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'forbidden' }) }));
    const result = await runXeroReadinessCheck({ xero: readers(), accountCode: '200', officeContacts: [] });
    expect(result.checks.find((c) => c.id === 'organisation').status).toBe('fail');
    expect(result.ready).toBe(false);
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });

  it('getContactById treats a 404 as "no longer exists" (null) but surfaces other errors', async () => {
    vi.stubGlobal('fetch', fakeXero({ [`${API}/Contacts/gone`]: () => ({ ok: false, status: 404, json: async () => ({}), text: async () => 'not found' }), [`${API}/Contacts/broken`]: () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'oops' }) }));
    expect(await xeroService.getContactById('gone')).toBeNull();
    await expect(xeroService.getContactById('broken')).rejects.toThrow(/500/);
  });

  it('REGRESSION: contact names are URL-encoded, so a name with "&" is searched for in full (not cut off at the ampersand)', async () => {
    vi.stubGlobal('fetch', fakeXero());
    await xeroService.searchContactByName('Evolve Sales & Management');
    const u = requests.find((r) => r.url.includes('/Contacts'));
    expect(u.url).toContain('%26');                                              // the & is encoded, not a query separator
    expect(u.url).not.toMatch(/where=Name=="Evolve Sales &/);
    const where = new URL(u.url).searchParams.get('where');
    expect(where).toBe('Name=="Evolve Sales & Management"');                    // round-trips exactly
    expect([...new URL(u.url).searchParams.keys()]).toEqual(['where']);          // no stray second parameter
  });

  it.each([
    'Smith & Sons Realty Pty Ltd',
    'A+B Property #1',
    'Quote "Co" Realty',
    LEGAL,
  ])('round-trips the name exactly through the query string: %s', async (name) => {
    vi.stubGlobal('fetch', fakeXero());
    await xeroService.searchContactByName(name);
    const where = new URL(requests.find((r) => r.url.includes('/Contacts')).url).searchParams.get('where');
    expect(where).toBe(`Name=="${name.replace(/"/g, '\\"')}"`);
  });

  it('findOrCreateContact (existing-contact path) also searches with the encoded name', async () => {
    vi.stubGlobal('fetch', fakeXero({
      [`${API}/Contacts?where=${encodeURIComponent('Name=="Evolve Sales & Management"')}`]: () => ({ ok: true, status: 200, json: async () => ({ Contacts: [{ ContactID: 'existing1', Name: 'Evolve Sales & Management' }] }), text: async () => '' }),
    }));
    const c = await xeroService.findOrCreateContact({ name: 'Evolve Sales & Management', email: 'a@b.c' });
    expect(c.ContactID).toBe('existing1');                                       // found, so no duplicate is created
    expect(requests.every((r) => r.method === 'GET')).toBe(true);                // and so no POST was needed
  });
});
