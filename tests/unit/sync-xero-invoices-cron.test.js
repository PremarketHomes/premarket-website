import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

const mockIsXeroConnected = vi.fn();
const mockBatchGetInvoiceStatuses = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  isXeroConnected: (...args) => mockIsXeroConnected(...args),
  batchGetInvoiceStatuses: (...args) => mockBatchGetInvoiceStatuses(...args),
}));

function makeFakeDb() {
  const store = {};
  function col(name) {
    store[name] = store[name] || {};
    return {
      where(field, op, value) {
        const all = Object.entries(store[name]).map(([id, data]) => ({
          id,
          data: () => data,
          _raw: data,
          ref: { update: async (patch) => { store[name][id] = { ...(store[name][id] || {}), ...patch }; } },
        }));
        const filtered = all.filter((d) => (op === '==' ? d._raw[field] === value : true));
        return { get: async () => ({ docs: filtered, empty: filtered.length === 0, size: filtered.length }) };
      },
    };
  }
  return { collection: col, _store: store, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

function makeGetRequest(authHeader) {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method: 'GET', headers });
}

describe('GET /api/cron/sync-xero-invoices', () => {
  const originalSecret = process.env.CRON_SECRET;
  beforeEach(() => {
    fakeDb = makeFakeDb();
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });
  afterEach(() => { process.env.CRON_SECRET = originalSecret; });

  it('401s without the correct CRON_SECRET bearer token', async () => {
    const { GET } = await import('../../src/app/api/cron/sync-xero-invoices/route.js');
    const res = await GET(makeGetRequest('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('skips when Xero is not connected, rather than erroring', async () => {
    mockIsXeroConnected.mockResolvedValue(false);
    const { GET } = await import('../../src/app/api/cron/sync-xero-invoices/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.skipped).toBe(true);
    expect(mockBatchGetInvoiceStatuses).not.toHaveBeenCalled();
  });

  it('updates every outstanding sent invoice to its real Xero status — PAID, VOIDED, and otherwise', async () => {
    mockIsXeroConnected.mockResolvedValue(true);
    fakeDb._seed('invoiceRunItems', 'item1', { status: 'sent', xeroInvoiceId: 'inv1' });
    fakeDb._seed('invoiceRunItems', 'item2', { status: 'sent', xeroInvoiceId: 'inv2' });
    fakeDb._seed('invoiceRunItems', 'item3', { status: 'sent', xeroInvoiceId: 'inv3' });
    mockBatchGetInvoiceStatuses.mockResolvedValue([
      { InvoiceID: 'inv1', Status: 'PAID', FullyPaidOnDate: '2026-10-01' },
      { InvoiceID: 'inv2', Status: 'VOIDED' },
      { InvoiceID: 'inv3', Status: 'AUTHORISED' },
    ]);

    const { GET } = await import('../../src/app/api/cron/sync-xero-invoices/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.synced).toBe(3);
    expect(data.paidCount).toBe(1);
    expect(fakeDb._store.invoiceRunItems.item1.status).toBe('paid');
    expect(fakeDb._store.invoiceRunItems.item1.paidAt).toBe('2026-10-01');
    expect(fakeDb._store.invoiceRunItems.item2.status).toBe('voided');
    // "AUTHORISED" is neither paid nor voided — local status field is left alone, never assumed paid.
    expect(fakeDb._store.invoiceRunItems.item3.status).toBe('sent');
    expect(fakeDb._store.invoiceRunItems.item3.xeroStatus).toBe('AUTHORISED');
  });

  it('never touches an item that is not currently status "sent" (already resolved, or never sent)', async () => {
    mockIsXeroConnected.mockResolvedValue(true);
    fakeDb._seed('invoiceRunItems', 'already-paid', { status: 'paid', xeroInvoiceId: 'inv1' });
    fakeDb._seed('invoiceRunItems', 'never-sent', { status: 'pending' });

    const { GET } = await import('../../src/app/api/cron/sync-xero-invoices/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();

    expect(data.synced).toBe(0);
    expect(mockBatchGetInvoiceStatuses).not.toHaveBeenCalled();
  });

  it('is safe to run twice in a row (retry-safe) — re-syncing an already-paid invoice is a no-op', async () => {
    mockIsXeroConnected.mockResolvedValue(true);
    fakeDb._seed('invoiceRunItems', 'item1', { status: 'sent', xeroInvoiceId: 'inv1' });
    mockBatchGetInvoiceStatuses.mockResolvedValue([{ InvoiceID: 'inv1', Status: 'PAID', FullyPaidOnDate: '2026-10-01' }]);

    const { GET } = await import('../../src/app/api/cron/sync-xero-invoices/route.js');
    await GET(makeGetRequest('Bearer test-secret'));
    expect(fakeDb._store.invoiceRunItems.item1.status).toBe('paid');

    // Second run: the item is no longer 'sent' (it's 'paid'), so the query simply won't pick it up again.
    const res2 = await GET(makeGetRequest('Bearer test-secret'));
    const data2 = await res2.json();
    expect(data2.synced).toBe(0);
  });
});
