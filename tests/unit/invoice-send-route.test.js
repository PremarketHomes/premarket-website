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
  // Mirrors real Firestore transaction semantics closely enough for
  // send/route.js's own use: tx.get reads current store state, every
  // write inside the callback is deferred until the callback resolves
  // (and thrown away entirely if it throws) — exactly what the
  // approved -> sending claim at the top of that route relies on.
  async function runTransaction(updateFn) {
    const pendingWrites = [];
    const tx = {
      get: async (ref) => {
        const data = store[ref._col]?.[ref.id];
        return { exists: !!data, id: ref.id, data: () => data };
      },
      update: (ref, patch) => pendingWrites.push(() => {
        store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch };
      }),
    };
    const result = await updateFn(tx);
    pendingWrites.forEach((write) => write());
    return result;
  }

  return { collection: col, runTransaction, _store: store, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

const mockFindOrCreateContact = vi.fn();
const mockCreateInvoice = vi.fn();
const mockSendInvoice = vi.fn();
const mockIsXeroConnected = vi.fn();
const mockFindInvoiceByReference = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  findOrCreateContact: (...args) => mockFindOrCreateContact(...args),
  createInvoice: (...args) => mockCreateInvoice(...args),
  sendInvoice: (...args) => mockSendInvoice(...args),
  isXeroConnected: (...args) => mockIsXeroConnected(...args),
  findInvoiceByReference: (...args) => mockFindInvoiceByReference(...args),
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
  mockFindInvoiceByReference.mockResolvedValue(null); // no pre-existing invoice found, by default
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

describe('POST .../send — Xero contact name-collision fix', () => {
  it('two different independent agents who happen to share a personal name get two DIFFERENT, disambiguated Xero contact names', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'itemA', {
      runId: 'run1', agencyName: 'Jo Lee', agentName: 'Jo Lee', agentEmail: 'jo.a@example.com',
      billingEntityType: 'independent', billingEntityKey: 'agent:uidAAAAAAAA',
      properties: [{ propertyId: 'pA', address: '1 A St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    fakeDb._seed('invoiceRunItems', 'itemB', {
      runId: 'run1', agencyName: 'Jo Lee', agentName: 'Jo Lee', agentEmail: 'jo.b@example.com',
      billingEntityType: 'independent', billingEntityKey: 'agent:uidBBBBBBBB',
      properties: [{ propertyId: 'pB', address: '2 B St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(mockFindOrCreateContact).toHaveBeenCalledTimes(2);
    const name1 = mockFindOrCreateContact.mock.calls[0][0].name;
    const name2 = mockFindOrCreateContact.mock.calls[1][0].name;
    expect(name1).not.toBe(name2); // never collide, even with identical display names
    expect(name1).toContain('Jo Lee');
    expect(name2).toContain('Jo Lee');
  });

  it('two agents at the SAME real company still share one Xero contact name — consolidation is intentional, not a collision', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', agencyName: 'Harcourts Property Hub', agentName: 'Jo Lee', agentEmail: 'jo@example.com',
      billingEntityType: 'agency', billingEntityKey: 'agency:harcourts property hub',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(mockFindOrCreateContact).toHaveBeenCalledWith(expect.objectContaining({ name: 'Harcourts Property Hub' }));
  });

  it('an item with no billingEntityType at all (older data shape) still works unchanged, using the plain agency name', async () => {
    seedSingleItemRun();
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(mockFindOrCreateContact).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme Agency' }));
  });
});

function seedSingleItemRun(overrides = {}) {
  fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
  fakeDb._seed('invoiceRunItems', 'item1', {
    runId: 'run1',
    agencyName: 'Acme Agency',
    agentName: 'Jo Bloggs',
    agentEmail: 'jo@example.com',
    properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    ...overrides,
  });
}

describe('POST .../send — duplicate-invoice protection (Priority 1)', () => {
  it('Xero invoice created successfully, email fails: charges stay invoiced, not released, and no second invoice is created', async () => {
    seedSingleItemRun();
    mockSendInvoice.mockRejectedValue(new Error('Xero email service unavailable'));

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('failed'); // the only item failed its EMAIL step
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    // This is the actual fix: markChargesInvoiced was called (charges are
    // invoiced), and markChargesFailed was NEVER called for this item —
    // a failed email must never release charges back to pending.
    expect(mockMarkChargesInvoiced).toHaveBeenCalledWith(['p1']);
    expect(mockMarkChargesFailed).not.toHaveBeenCalled();

    const item = (await fakeDb.collection('invoiceRunItems').doc('item1').get()).data();
    expect(item.status).toBe('email_failed');
    expect(item.xeroInvoiceId).toBe('inv1'); // the real invoice ID is recorded
    expect(item.lastEmailError).toMatch(/unavailable/);
  });

  it('retrying a run whose item already has a stored xeroInvoiceId never calls createInvoice again — only retries the email', async () => {
    seedSingleItemRun({ xeroInvoiceId: 'inv-existing', xeroInvoiceNumber: 'PM-0042', xeroStatus: 'AUTHORISED', status: 'email_failed' });
    // Approve again to re-trigger send (simulating an admin retry of a 'failed'/'partial' run moved back to approved — the point under test is what happens to an item that already has an invoice ID).
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('sent');
    expect(mockCreateInvoice).not.toHaveBeenCalled(); // never re-created
    expect(mockFindOrCreateContact).not.toHaveBeenCalled(); // never even looked up a contact again
    expect(mockSendInvoice).toHaveBeenCalledWith('inv-existing'); // retried against the EXISTING invoice
  });

  it('creation itself failing (e.g. a true timeout with no response at all) still safely releases charges for retry', async () => {
    seedSingleItemRun();
    mockCreateInvoice.mockRejectedValue(new Error('Xero request timed out'));

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('failed');
    expect(mockMarkChargesFailed).toHaveBeenCalledWith(['p1']);
    expect(mockMarkChargesInvoiced).not.toHaveBeenCalled();

    const item = (await fakeDb.collection('invoiceRunItems').doc('item1').get()).data();
    expect(item.status).toBe('error');
    expect(item.xeroInvoiceId).toBeUndefined();
  });

  it('attaches a stable, deterministic Idempotency-Key to the createInvoice call, so a blind retry after a timeout is safe at the Xero API level', async () => {
    seedSingleItemRun();
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    const key1 = mockCreateInvoice.mock.calls[0][0].idempotencyKey;
    expect(key1).toBeTruthy();

    // A second, independent send attempt for the SAME item (simulating
    // a retried request after the first one's response was lost) must
    // produce the exact same key.
    mockCreateInvoice.mockClear();
    fakeDb.collection('invoiceRunItems').doc('item1').update({ status: 'pending', xeroInvoiceId: undefined });
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const key2 = mockCreateInvoice.mock.calls[0][0].idempotencyKey;

    expect(key2).toBe(key1);
  });

  it('the exact ambiguous-timeout scenario: Xero actually created the invoice, our connection timed out before we found out — a retry reconciles instead of duplicating', async () => {
    seedSingleItemRun();

    // Attempt 1: the create call itself throws (simulating a true
    // network timeout — this process never received ANY response, so
    // it genuinely cannot tell whether Xero processed the request).
    mockFindInvoiceByReference.mockResolvedValueOnce(null); // nothing to find yet, this is the very first attempt
    mockCreateInvoice.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const first = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect((await first.json()).status).toBe('failed');
    expect(mockMarkChargesFailed).toHaveBeenCalledWith(['p1']); // safely released, since we don't yet know an invoice exists

    // Unbeknownst to Premarket, Xero actually DID create the invoice
    // during attempt 1 — simulate that by having the reconciliation
    // check find it on the retry.
    mockCreateInvoice.mockClear();
    mockMarkChargesFailed.mockClear();
    mockFindInvoiceByReference.mockResolvedValueOnce({ InvoiceID: 'inv-created-during-timeout', InvoiceNumber: 'PM-0007', Status: 'AUTHORISED' });
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });

    const second = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const secondBody = await second.json();

    expect(secondBody.status).toBe('sent');
    expect(mockCreateInvoice).not.toHaveBeenCalled(); // reconciliation found it first — never created a second one
    expect(mockSendInvoice).toHaveBeenCalledWith('inv-created-during-timeout');

    const item = (await fakeDb.collection('invoiceRunItems').doc('item1').get()).data();
    expect(item.xeroInvoiceId).toBe('inv-created-during-timeout');
  });

  it('checks for an existing invoice by reference before ever calling createInvoice, for any item with no stored invoice ID yet', async () => {
    seedSingleItemRun();
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(mockFindInvoiceByReference).toHaveBeenCalledTimes(1);
    const referenceChecked = mockFindInvoiceByReference.mock.calls[0][0];
    expect(referenceChecked).toContain('Acme Agency');

    // createInvoice must have been called strictly after the check,
    // not concurrently with or before it — order matters here, since
    // the whole point is to decide based on the check's result.
    const checkOrder = mockFindInvoiceByReference.mock.invocationCallOrder[0];
    const createOrder = mockCreateInvoice.mock.invocationCallOrder[0];
    expect(checkOrder).toBeLessThan(createOrder);
  });

  it('refuses a second concurrent send on the same run — the atomic approved -> sending claim prevents it', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'sending', periodStart: new Date('2026-10-01') }); // already claimed by "another" request
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', agencyName: 'Acme Agency', agentName: 'Jo Bloggs', agentEmail: 'jo@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(res.status).toBe(400);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('never bypasses admin approval — a draft run cannot be sent at all', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'draft', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', agencyName: 'Acme Agency', agentName: 'Jo Bloggs', agentEmail: 'jo@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(res.status).toBe(400);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });
});
