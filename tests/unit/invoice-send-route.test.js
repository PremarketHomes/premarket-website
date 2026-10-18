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
  it('passes taxType NONE and the full $200 as the unit amount when the run has gstRate 0', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', gstRate: 0, periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Acme Agency',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      pricePerListing: 200,
      properties: [{ propertyId: 'p1', address: '1 Test St' }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.taxType).toBe('NONE');
    expect(call.lineItems[0].unitAmount).toBe(200);
  });

  it('passes taxType OUTPUT and backs out the ex-GST amount when gstRate is explicitly 0.1', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', gstRate: 0.1, periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Acme Agency',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      pricePerListing: 200,
      properties: [{ propertyId: 'p1', address: '1 Test St' }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.taxType).toBe('OUTPUT');
    expect(call.lineItems[0].unitAmount).toBeCloseTo(181.82, 2);
  });

  it('a falsy-but-explicit gstRate of 0 is never resurrected into a 10% default (the `?? 0`, not `|| 0.1`, regression)', async () => {
    // gstRate: 0 is a legitimate, deliberate "not GST registered" value —
    // `runData.gstRate || 0.1` would wrongly treat it as unset and fall
    // back to 10%. Confirms the fix stays fixed.
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', gstRate: 0, periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Acme Agency',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      pricePerListing: 200,
      properties: [{ propertyId: 'p1', address: '1 Test St' }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems[0].unitAmount).toBe(200); // not 181.82
    expect(call.taxType).toBe('NONE'); // not 'OUTPUT'
  });
});
