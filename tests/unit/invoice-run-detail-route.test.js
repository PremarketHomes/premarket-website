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
          id, data: () => data, _raw: data, ref: { _col: name, id },
        }));
        const filtered = all.filter((d) => (op === '==' ? d._raw[field] === value : true));
        return { get: async () => ({ docs: filtered, empty: filtered.length === 0, size: filtered.length }) };
      },
    };
  }
  function batch() {
    const ops = [];
    return {
      set: (ref, data) => ops.push(() => { store[ref._col][ref.id] = { ...data }; }),
      update: (ref, patch) => ops.push(() => { store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch }; }),
      delete: (ref) => ops.push(() => { delete store[ref._col][ref.id]; }),
      commit: async () => { ops.forEach((op) => op()); },
    };
  }
  return { collection: col, batch, _store: store, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

const mockSendInvoice = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  sendInvoice: (...args) => mockSendInvoice(...args),
}));

function makeRequest(body) {
  const headers = new Headers({ authorization: 'Bearer t', 'Content-Type': 'application/json' });
  return new Request('http://localhost/test', { method: 'PATCH', headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
  fakeDb._seed('users', 'admin1', { superAdmin: true });
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
});

describe('PATCH .../runs/[runId] — cancel releases charges back to pending', () => {
  it('reverts every queued charge attached to the run to pending, detached', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'draft' });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', properties: [{ propertyId: 'propA' }, { propertyId: 'propB' }] });
    fakeDb._seed('propertyCharges', 'propA', { status: 'queued', runId: 'run1' });
    fakeDb._seed('propertyCharges', 'propB', { status: 'queued', runId: 'run1' });

    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await PATCH(makeRequest({ action: 'cancel' }), { params: Promise.resolve({ runId: 'run1' }) });
    expect(res.status).toBe(200);

    expect(fakeDb._store.propertyCharges.propA.status).toBe('pending');
    expect(fakeDb._store.propertyCharges.propA.runId).toBeNull();
    expect(fakeDb._store.propertyCharges.propB.status).toBe('pending');
  });
});

describe('PATCH .../runs/[runId] — removeItems releases only the removed items\' charges', () => {
  it('releases propA (removed item) but leaves propC (other item) queued', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'draft' });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', properties: [{ propertyId: 'propA' }], propertyCount: 1, totalInc: 200, subtotalEx: 181.82, gstAmount: 18.18 });
    fakeDb._seed('invoiceRunItems', 'item2', { runId: 'run1', properties: [{ propertyId: 'propC' }], propertyCount: 1, totalInc: 200, subtotalEx: 181.82, gstAmount: 18.18 });
    fakeDb._seed('propertyCharges', 'propA', { status: 'queued', runId: 'run1' });
    fakeDb._seed('propertyCharges', 'propC', { status: 'queued', runId: 'run1' });

    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await PATCH(makeRequest({ action: 'removeItems', itemIds: ['item1'] }), { params: Promise.resolve({ runId: 'run1' }) });
    expect(res.status).toBe(200);

    expect(fakeDb._store.propertyCharges.propA.status).toBe('pending');
    expect(fakeDb._store.propertyCharges.propC.status).toBe('queued'); // untouched
    expect(fakeDb._store.invoiceRunItems.item1).toBeUndefined(); // item deleted
    expect(fakeDb._store.invoiceRunItems.item2).toBeDefined();
  });
});

describe('PATCH .../runs/[runId] — removeProperties releases exactly the removed ones and recalculates by summing what remains', () => {
  it('removing one of two properties from an item halves its total and releases only that one', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'draft' });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      properties: [
        { propertyId: 'propA', address: '1 A St', subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 },
        { propertyId: 'propB', address: '2 B St', subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 },
      ],
      propertyCount: 2,
      subtotalEx: 363.64,
      gstAmount: 36.36,
      totalInc: 400,
    });
    fakeDb._seed('propertyCharges', 'propA', { status: 'queued', runId: 'run1' });
    fakeDb._seed('propertyCharges', 'propB', { status: 'queued', runId: 'run1' });

    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await PATCH(
      makeRequest({ action: 'removeProperties', itemId: 'item1', propertyIds: ['propA'] }),
      { params: Promise.resolve({ runId: 'run1' }) }
    );
    expect(res.status).toBe(200);

    expect(fakeDb._store.propertyCharges.propA.status).toBe('pending');
    expect(fakeDb._store.propertyCharges.propB.status).toBe('queued'); // untouched

    const item = fakeDb._store.invoiceRunItems.item1;
    expect(item.propertyCount).toBe(1);
    expect(item.totalInc).toBe(200);
    expect(item.properties).toHaveLength(1);
    expect(item.properties[0].propertyId).toBe('propB');
  });

  it('removing the last remaining property deletes the item entirely', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'draft' });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      properties: [{ propertyId: 'propA', address: '1 A St', subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 }],
      propertyCount: 1,
    });
    fakeDb._seed('propertyCharges', 'propA', { status: 'queued', runId: 'run1' });

    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    await PATCH(
      makeRequest({ action: 'removeProperties', itemId: 'item1', propertyIds: ['propA'] }),
      { params: Promise.resolve({ runId: 'run1' }) }
    );

    expect(fakeDb._store.invoiceRunItems.item1).toBeUndefined();
    expect(fakeDb._store.propertyCharges.propA.status).toBe('pending');
  });
});

describe('DELETE .../runs/[runId] — releases charges before removing the draft', () => {
  it('reverts queued charges to pending when a draft run is deleted', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'draft' });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', properties: [{ propertyId: 'propA' }] });
    fakeDb._seed('propertyCharges', 'propA', { status: 'queued', runId: 'run1' });

    const { DELETE } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await DELETE(makeRequest({}), { params: Promise.resolve({ runId: 'run1' }) });
    expect(res.status).toBe(200);

    expect(fakeDb._store.propertyCharges.propA.status).toBe('pending');
    expect(fakeDb._store.invoiceRuns.run1).toBeUndefined();
  });

  it('refuses to delete a non-draft run (and therefore never touches its charges)', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'sent' });
    fakeDb._seed('propertyCharges', 'propA', { status: 'invoiced', runId: 'run1' });

    const { DELETE } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await DELETE(makeRequest({}), { params: Promise.resolve({ runId: 'run1' }) });
    expect(res.status).toBe(400);
    expect(fakeDb._store.propertyCharges.propA.status).toBe('invoiced');
  });
});

describe('PATCH .../runs/[runId] — retrySend (resolving a failed email, Priority 1)', () => {
  it('retries only the email for an item that already has a real Xero invoice, never creating a new one', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'partial' });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', status: 'email_failed', xeroInvoiceId: 'inv-existing', lastEmailError: 'Xero email service unavailable' });
    mockSendInvoice.mockResolvedValue({});

    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await PATCH(makeRequest({ action: 'retrySend', itemId: 'item1' }), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('sent');
    expect(mockSendInvoice).toHaveBeenCalledWith('inv-existing');
    expect(fakeDb._store.invoiceRunItems.item1.status).toBe('sent');
    expect(fakeDb._store.invoiceRunItems.item1.lastEmailError).toBeNull();
  });

  it('refuses to retry an item that was never actually created in Xero — nothing to retry, and never a path to create one', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'failed' });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', status: 'error', lastError: 'Failed to create Xero contact' });

    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await PATCH(makeRequest({ action: 'retrySend', itemId: 'item1' }), { params: Promise.resolve({ runId: 'run1' }) });

    expect(res.status).toBe(400);
    expect(mockSendInvoice).not.toHaveBeenCalled();
  });

  it('refuses to retry an item that has already been sent', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'sent' });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', status: 'sent', xeroInvoiceId: 'inv1' });

    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await PATCH(makeRequest({ action: 'retrySend', itemId: 'item1' }), { params: Promise.resolve({ runId: 'run1' }) });

    expect(res.status).toBe(400);
    expect(mockSendInvoice).not.toHaveBeenCalled();
  });

  it('records the error and leaves the item retryable if the retry attempt itself also fails', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'partial' });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', status: 'email_failed', xeroInvoiceId: 'inv-existing', emailAttempts: 1 });
    mockSendInvoice.mockRejectedValue(new Error('Still unavailable'));

    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await PATCH(makeRequest({ action: 'retrySend', itemId: 'item1' }), { params: Promise.resolve({ runId: 'run1' }) });

    expect(res.status).toBe(500);
    expect(fakeDb._store.invoiceRunItems.item1.status).toBe('email_failed');
    expect(fakeDb._store.invoiceRunItems.item1.emailAttempts).toBe(2);
  });
});
