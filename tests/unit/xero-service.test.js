import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

function makeFakeDb() {
  const store = { invoiceRunItems: {} };
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
