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

  it('defaults to NONE (no GST) when the caller passes no taxType', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Invoices: [{ InvoiceID: 'inv1' }] }),
    });
    const { createInvoice } = await import('../../src/app/api/services/xeroService.js');
    await createInvoice({ contactId: 'c1', lineItems: [{ description: 'x', quantity: 1, unitAmount: 200 }] });

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.Invoices[0].LineItems[0].TaxType).toBe('NONE');
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
});
