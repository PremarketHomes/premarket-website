import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

function makeFakeDb() {
  const store = { invoiceRunItems: {}, settings: {} };
  return {
    collection: (name) => ({
      where: (field, op, value) => {
        const docs = Object.entries(store[name] || {})
          .filter(([, data]) => (op === '==' ? data[field] === value : true))
          .map(([id, data]) => ({ id, ref: { update: async (patch) => { store[name][id] = { ...store[name][id], ...patch }; } }, data: () => data }));
        return {
          limit: () => ({ get: async () => ({ docs: docs.slice(0, 1), empty: docs.length === 0 }) }),
        };
      },
      doc: (id) => ({
        get: async () => ({
          exists: !!(store[name] && store[name][id]),
          data: () => store[name]?.[id],
        }),
        set: async (data, opts) => {
          store[name] = store[name] || {};
          store[name][id] = opts?.merge ? { ...store[name][id], ...data } : data;
        },
        delete: async () => {
          if (store[name]) delete store[name][id];
        },
      }),
    }),
    _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; },
    _store: store,
  };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
});

describe('updateInvoiceRunItem', () => {
  it('returns null and writes nothing when no item matches this Xero invoice ID', async () => {
    const { updateInvoiceRunItem } = await import('../../src/app/api/services/xeroService.js');
    const result = await updateInvoiceRunItem('inv-unknown', { Status: 'PAID' });
    expect(result).toBeNull();
  });

  it('marks paid only when Xero actually reports PAID', async () => {
    fakeDb._seed('invoiceRunItems', 'item1', { xeroInvoiceId: 'inv1', status: 'sent' });
    const { updateInvoiceRunItem } = await import('../../src/app/api/services/xeroService.js');
    await updateInvoiceRunItem('inv1', { Status: 'PAID', FullyPaidOnDate: '2026-10-01' });
    expect(fakeDb._store.invoiceRunItems.item1.status).toBe('paid');
    expect(fakeDb._store.invoiceRunItems.item1.paidAt).toBe('2026-10-01');
    expect(fakeDb._store.invoiceRunItems.item1.xeroStatus).toBe('PAID');
  });

  it('marks voided when Xero reports VOIDED — never silently treated as paid', async () => {
    fakeDb._seed('invoiceRunItems', 'item1', { xeroInvoiceId: 'inv1', status: 'sent' });
    const { updateInvoiceRunItem } = await import('../../src/app/api/services/xeroService.js');
    await updateInvoiceRunItem('inv1', { Status: 'VOIDED' });
    expect(fakeDb._store.invoiceRunItems.item1.status).toBe('voided');
    expect(fakeDb._store.invoiceRunItems.item1.paidAt).toBeUndefined();
  });

  it('for any other real status (e.g. AUTHORISED), updates xeroStatus but leaves the local status field alone', async () => {
    fakeDb._seed('invoiceRunItems', 'item1', { xeroInvoiceId: 'inv1', status: 'sent' });
    const { updateInvoiceRunItem } = await import('../../src/app/api/services/xeroService.js');
    await updateInvoiceRunItem('inv1', { Status: 'AUTHORISED' });
    expect(fakeDb._store.invoiceRunItems.item1.xeroStatus).toBe('AUTHORISED');
    expect(fakeDb._store.invoiceRunItems.item1.status).toBe('sent'); // unchanged — never assumed paid
  });
});

describe('createInvoice — tax type is never assumed', () => {
  beforeEach(() => {
    fakeDb._seed('settings', 'xeroTokens', {
      access_token: 'tok',
      refresh_token: 'refresh',
      expires_at: Date.now() + 60 * 60 * 1000,
      tenant_id: 'tenant1',
    });
  });

  it('defaults to the explicit zero-GST type BASEXCLUDED (never the placeholder NONE) when the caller passes no taxType', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Invoices: [{ InvoiceID: 'inv1' }] }),
    });
    const { createInvoice } = await import('../../src/app/api/services/xeroService.js');
    await createInvoice({ contactId: 'c1', lineItems: [{ description: 'x', quantity: 1, unitAmount: 200 }] });

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.Invoices[0].LineItems[0].TaxType).toBe('BASEXCLUDED');
  });

  it('uses OUTPUT only when explicitly passed (gstRate > 0 path)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Invoices: [{ InvoiceID: 'inv1' }] }),
    });
    const { createInvoice } = await import('../../src/app/api/services/xeroService.js');
    await createInvoice({
      contactId: 'c1',
      lineItems: [{ description: 'x', quantity: 1, unitAmount: 181.82 }],
      taxType: 'OUTPUT',
    });

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.Invoices[0].LineItems[0].TaxType).toBe('OUTPUT');
  });

  it('defaults Status to AUTHORISED when no status is passed (every real send/route.js call)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Invoices: [{ InvoiceID: 'inv1' }] }) });
    const { createInvoice } = await import('../../src/app/api/services/xeroService.js');
    await createInvoice({ contactId: 'c1', lineItems: [{ description: 'x', quantity: 1, unitAmount: 200 }] });

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body).Invoices[0].Status).toBe('AUTHORISED');
  });

  it('uses DRAFT only when explicitly passed (the Xero diagnostic path)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Invoices: [{ InvoiceID: 'inv1' }] }) });
    const { createInvoice } = await import('../../src/app/api/services/xeroService.js');
    await createInvoice({ contactId: 'c1', lineItems: [{ description: 'x', quantity: 1, unitAmount: 200 }], status: 'DRAFT' });

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body).Invoices[0].Status).toBe('DRAFT');
  });
});

describe('read-only Xero helpers — never create or modify anything', () => {
  beforeEach(() => {
    fakeDb._seed('settings', 'xeroTokens', {
      access_token: 'tok',
      refresh_token: 'refresh',
      expires_at: Date.now() + 60 * 60 * 1000,
      tenant_id: 'tenant1',
    });
  });

  it('searchContactByName does a GET, never a POST, and returns null when nothing matches', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Contacts: [] }) });
    const { searchContactByName } = await import('../../src/app/api/services/xeroService.js');
    const result = await searchContactByName('Nobody');

    expect(result).toBeNull();
    expect(global.fetch.mock.calls[0][1].method).toBe('GET');
    expect(global.fetch.mock.calls[0][1].body).toBeNull();
  });

  it('getOrganisation returns the connected org, read-only', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Organisations: [{ Name: 'Premarket Group Pty Ltd' }] }) });
    const { getOrganisation } = await import('../../src/app/api/services/xeroService.js');
    const org = await getOrganisation();

    expect(org.Name).toBe('Premarket Group Pty Ltd');
    expect(global.fetch.mock.calls[0][1].method).toBe('GET');
  });

  it('getAccountByCode returns null when the code does not exist in the chart of accounts', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Accounts: [] }) });
    const { getAccountByCode } = await import('../../src/app/api/services/xeroService.js');
    const account = await getAccountByCode('999');

    expect(account).toBeNull();
    expect(global.fetch.mock.calls[0][1].method).toBe('GET');
  });

  it('getAccountByCode returns the account when it exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Accounts: [{ Code: '200', Name: 'Sales' }] }) });
    const { getAccountByCode } = await import('../../src/app/api/services/xeroService.js');
    const account = await getAccountByCode('200');

    expect(account).toEqual({ Code: '200', Name: 'Sales' });
  });
});

describe('disconnectXero — the real disconnect, replacing the old no-op', () => {
  it('reports wasConnected: false and touches nothing when there was no connection to begin with', async () => {
    const { disconnectXero } = await import('../../src/app/api/services/xeroService.js');
    const result = await disconnectXero();
    expect(result).toEqual({ wasConnected: false, revokedAtXero: false });
  });

  it('revokes at Xero (DELETE /connections/{id}) and deletes the local tokens doc', async () => {
    fakeDb._seed('settings', 'xeroTokens', {
      access_token: 'tok', refresh_token: 'refresh', expires_at: Date.now() + 60000, tenant_id: 'tenant1',
    });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ id: 'connection-1', tenantId: 'tenant1' }]) })
      .mockResolvedValueOnce({ ok: true });

    const { disconnectXero } = await import('../../src/app/api/services/xeroService.js');
    const result = await disconnectXero();

    expect(result).toEqual({ wasConnected: true, revokedAtXero: true });
    expect(fakeDb._store.settings.xeroTokens).toBeUndefined(); // deleted
    const deleteCall = global.fetch.mock.calls[1];
    expect(deleteCall[0]).toBe('https://api.xero.com/connections/connection-1');
    expect(deleteCall[1].method).toBe('DELETE');
  });

  it('still deletes the local tokens doc even when the Xero-side revocation call fails', async () => {
    fakeDb._seed('settings', 'xeroTokens', {
      access_token: 'tok', refresh_token: 'refresh', expires_at: Date.now() + 60000, tenant_id: 'tenant1',
    });
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const { disconnectXero } = await import('../../src/app/api/services/xeroService.js');
    const result = await disconnectXero();

    expect(result).toEqual({ wasConnected: true, revokedAtXero: false });
    expect(fakeDb._store.settings.xeroTokens).toBeUndefined(); // deleted regardless
  });

  it('still deletes the local tokens doc when no matching connection is found at Xero', async () => {
    fakeDb._seed('settings', 'xeroTokens', {
      access_token: 'tok', refresh_token: 'refresh', expires_at: Date.now() + 60000, tenant_id: 'tenant1',
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ([]) });

    const { disconnectXero } = await import('../../src/app/api/services/xeroService.js');
    const result = await disconnectXero();

    expect(result.revokedAtXero).toBe(false);
    expect(fakeDb._store.settings.xeroTokens).toBeUndefined();
  });

  it('never touches propertyCharges, invoiceRuns, or settings/invoicing', async () => {
    fakeDb._seed('settings', 'xeroTokens', {
      access_token: 'tok', refresh_token: 'refresh', expires_at: Date.now() + 60000, tenant_id: 'tenant1',
    });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, billingActivatedAt: null });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ([{ id: 'connection-1', tenantId: 'tenant1' }]) });

    const { disconnectXero } = await import('../../src/app/api/services/xeroService.js');
    await disconnectXero();

    expect(fakeDb._store.propertyCharges).toBeUndefined();
    expect(fakeDb._store.invoiceRuns).toBeUndefined();
    expect(fakeDb._store.settings.invoicing).toEqual({ pricePerListing: 200, billingActivatedAt: null }); // untouched
  });
});
