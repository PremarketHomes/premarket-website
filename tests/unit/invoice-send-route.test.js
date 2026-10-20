import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

function makeFakeDb() {
  const store = {};
  function col(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        const docId = id || `auto-${Math.random().toString(36).slice(2)}`;
        return {
          id: docId,
          ref: { _col: name, id: docId },
          _col: name,
          async get() {
            const data = store[name][docId];
            return { exists: !!data, id: docId, data: () => data };
          },
          async set(data) { store[name][docId] = { ...data }; },
          async update(patch) { store[name][docId] = { ...(store[name][docId] || {}), ...patch }; },
          async delete() { delete store[name][docId]; },
        };
      },
      where(field, op, value) {
        const all = Object.entries(store[name]).map(([id, data]) => ({
          id,
          data: () => data,
          _raw: data,
          ref: {
            _col: name,
            id,
            async update(patch) { store[name][id] = { ...(store[name][id] || {}), ...patch }; },
          },
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

const mockFindOrCreateContact = vi.fn();
const mockCreateInvoice = vi.fn();
const mockSendInvoice = vi.fn();
const mockIsXeroConnected = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  findOrCreateContact: (...args) => mockFindOrCreateContact(...args),
  createInvoice: (...args) => mockCreateInvoice(...args),
  sendInvoice: (...args) => mockSendInvoice(...args),
  isXeroConnected: (...args) => mockIsXeroConnected(...args),
}));

const mockMarkChargesInvoiced = vi.fn();
const mockMarkChargesFailed = vi.fn();
vi.mock('../../src/app/api/services/billingService', () => ({
  markChargesInvoiced: (...args) => mockMarkChargesInvoiced(...args),
  markChargesFailed: (...args) => mockMarkChargesFailed(...args),
}));

function makeRequest() {
  const headers = new Headers({ authorization: 'Bearer t' });
  return new Request('http://localhost/test', { method: 'POST', headers });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
  fakeDb._seed('users', 'admin1', { superAdmin: true });
  mockIsXeroConnected.mockResolvedValue(true);
  mockFindOrCreateContact.mockResolvedValue({ ContactID: 'contact1' });
  mockCreateInvoice.mockResolvedValue({ InvoiceID: 'inv1', InvoiceNumber: 'PM-1', Status: 'AUTHORISED' });
  mockSendInvoice.mockResolvedValue({});
});

describe('POST /api/admin/invoicing/runs/[runId]/send — GST', () => {
  // Fixtures here deliberately match the REAL shape
  // invoiceRunService.groupChargesByEntity actually produces: no
  // pricePerListing on the item, no gstRate on the run — only each
  // property's own already-computed subtotalEx/gstAmount, snapshotted
  // per charge. An earlier version of these tests seeded an item-level
  // pricePerListing and a run-level gstRate that groupChargesByEntity
  // never actually sets, which masked a real bug: item.pricePerListing
  // was always undefined in production, so every real unitAmount sent
  // to Xero would have been NaN. Fixed in send/route.js to derive
  // unitAmount/taxType from each property's own numbers instead.

  it('passes taxType NONE and each property\'s own ex-GST subtotal as the unit amount when not GST registered', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Acme Agency',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems[0].unitAmount).toBe(200);
    expect(call.lineItems[0].taxType).toBe('NONE');
  });

  it('passes taxType OUTPUT and that property\'s own ex-GST amount when its charge was snapshotted with GST', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Acme Agency',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems[0].taxType).toBe('OUTPUT');
    expect(call.lineItems[0].unitAmount).toBeCloseTo(181.82, 2);
  });

  it('a consolidated invoice itemises every property with ITS OWN amount and tax status, never a single run-wide value', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Acme Agency',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      properties: [
        { propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
        { propertyId: 'p2', address: '2 Test St', subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 },
      ],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems).toHaveLength(2);
    expect(call.lineItems[0]).toMatchObject({ unitAmount: 200, taxType: 'NONE' });
    expect(call.lineItems[1]).toMatchObject({ taxType: 'OUTPUT' });
    expect(call.lineItems[1].unitAmount).toBeCloseTo(181.82, 2);
  });
});
