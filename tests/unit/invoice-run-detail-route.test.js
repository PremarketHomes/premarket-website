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
  async function runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async (ref) => { const data = store[ref._col]?.[ref.id]; return { exists: !!data, id: ref.id, data: () => data }; },
      update: (ref, patch) => writes.push(() => { store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch }; }),
    };
    const result = await fn(tx);
    writes.forEach((w) => w());
    return result;
  }
  return { collection: col, batch, runTransaction, _store: store, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

const mockSendInvoice = vi.fn();
const mockGetInvoiceById = vi.fn();
const mockGetInvoiceHistory = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  sendInvoice: (...args) => mockSendInvoice(...args),
  getInvoiceById: (...args) => mockGetInvoiceById(...args),
  getInvoiceHistory: (...args) => mockGetInvoiceHistory(...args),
  deleteDraftInvoice: () => { throw new Error('unexpected deleteDraftInvoice'); },
}));

// What Xero holds for the invoice, by default: approved, $600, never sent.
const xeroInvoice = (over = {}) => ({
  InvoiceID: 'inv-existing', InvoiceNumber: 'INV-0003', Status: 'AUTHORISED', SentToContact: false,
  Contact: { Name: 'Results Realty (QLD) Pty Ltd' }, Total: 600, TotalTax: 0, AmountDue: 600,
  DateString: '2026-11-23T00:00:00', DueDateString: '2026-12-07T00:00:00', ...over,
});

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
  mockGetInvoiceById.mockResolvedValue(xeroInvoice());
  mockGetInvoiceHistory.mockResolvedValue([{ Changes: 'Approved', DateUTCString: '2026-11-23T04:13:25', Details: 'INV-0003 for 600.00' }]);
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

// HPH INV-0003 (23 Nov 2026): Xero accepted the email (204, empty body) but the old code failed to
// parse the empty reply, so the item was recorded as a failed email. Retry must never email twice.
describe('PATCH .../runs/[runId] — Retry Email never emails a customer twice', () => {
  const seedFailed = (over = {}) => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'failed', errors: [{ agencyName: 'Harcourts Property Hub', error: 'Unexpected end of JSON input', stage: 'email' }] });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', status: 'email_failed', xeroInvoiceId: 'inv-existing', xeroInvoiceNumber: 'INV-0003',
      lastEmailError: 'Unexpected end of JSON input', emailAttempts: 1, agencyName: 'Harcourts Property Hub', ...over,
    });
  };
  const call = async (body) => {
    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await PATCH(makeRequest(body), { params: Promise.resolve({ runId: 'run1' }) });
    return { res, body: await res.json() };
  };

  it('if Xero marks the invoice as sent: NOT emailed again; item and run recorded as sent', async () => {
    seedFailed();
    mockGetInvoiceById.mockResolvedValue(xeroInvoice({ SentToContact: true }));
    const { res, body } = await call({ action: 'retrySend', itemId: 'item1' });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'sent', alreadySent: true, runStatus: 'sent' });
    expect(mockSendInvoice).not.toHaveBeenCalled();
    expect(fakeDb._store.invoiceRunItems.item1).toMatchObject({ status: 'sent', lastEmailError: null, emailInProgressAt: null, emailAttempts: 1 });
    expect(fakeDb._store.invoiceRuns.run1).toMatchObject({ status: 'sent', errors: [], resolvedErrors: [{ agencyName: 'Harcourts Property Hub', error: 'Unexpected end of JSON input', stage: 'email' }] });
  });

  it('if Xero\'s history records an email (even without the flag): NOT emailed again', async () => {
    seedFailed();
    mockGetInvoiceHistory.mockResolvedValue([{ Changes: 'Sent', DateUTCString: '2026-11-23T04:13:29', Details: 'This invoice has been sent to Chris@propertyhubgc.com.au' }]);
    const { body } = await call({ action: 'retrySend', itemId: 'item1' });
    expect(body.alreadySent).toBe(true);
    expect(mockSendInvoice).not.toHaveBeenCalled();
  });

  it('only when Xero shows no sign of sending is it emailed — exactly once — and an empty 204 reply counts as success', async () => {
    seedFailed();
    mockSendInvoice.mockResolvedValue(null); // what sendInvoice now returns for Xero's 204 No Content
    const { body } = await call({ action: 'retrySend', itemId: 'item1' });
    expect(body).toMatchObject({ status: 'sent', runStatus: 'sent' });
    expect(mockSendInvoice).toHaveBeenCalledTimes(1);
    expect(mockSendInvoice).toHaveBeenCalledWith('inv-existing');
    expect(fakeDb._store.invoiceRunItems.item1).toMatchObject({ status: 'sent', emailAttempts: 2, emailInProgressAt: null });
  });

  it('a retry already in progress blocks a second one (a double-click cannot email twice)', async () => {
    seedFailed({ emailInProgressAt: new Date() });
    const { res } = await call({ action: 'retrySend', itemId: 'item1' });
    expect(res.status).toBe(409);
    expect(mockGetInvoiceById).not.toHaveBeenCalled();
    expect(mockSendInvoice).not.toHaveBeenCalled();
  });

  it('if Xero cannot be asked, nothing is emailed', async () => {
    seedFailed();
    mockGetInvoiceById.mockRejectedValue(new Error('Xero API GET failed (503)'));
    const { res, body } = await call({ action: 'retrySend', itemId: 'item1' });
    expect(res.status).toBe(502);
    expect(body.error).toMatch(/not emailed/);
    expect(mockSendInvoice).not.toHaveBeenCalled();
    expect(fakeDb._store.invoiceRunItems.item1.emailInProgressAt).toBeNull();
  });

  it('a voided, deleted or missing invoice is never emailed', async () => {
    for (const inv of [xeroInvoice({ Status: 'VOIDED' }), xeroInvoice({ Status: 'DELETED' }), null]) {
      seedFailed();
      mockGetInvoiceById.mockResolvedValue(inv);
      const { res } = await call({ action: 'retrySend', itemId: 'item1' });
      expect(res.status).toBe(409);
    }
    expect(mockSendInvoice).not.toHaveBeenCalled();
  });

  it('Retry Email can never create an invoice: the route has no access to invoice creation', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/app/api/admin/invoicing/runs/[runId]/route.js', 'utf-8');
    const xeroImports = src.match(/import\s*\{[^}]*\}\s*from '..\/..\/..\/..\/services\/xeroService'/)[0];
    expect(xeroImports).not.toMatch(/createInvoice|updateDraftInvoice/);
    expect(src).not.toMatch(/\b(createInvoice|updateDraftInvoice)\(/);
  });
});

describe('PATCH .../runs/[runId] — checkDelivery (read-only: what Xero says)', () => {
  const seedFailed = () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'failed', errors: [{ error: 'Unexpected end of JSON input', stage: 'email' }] });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', status: 'email_failed', xeroInvoiceId: 'inv-existing', xeroInvoiceNumber: 'INV-0003', lastEmailError: 'Unexpected end of JSON input' });
  };
  const check = async () => {
    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await PATCH(makeRequest({ action: 'checkDelivery', itemId: 'item1' }), { params: Promise.resolve({ runId: 'run1' }) });
    return { res, body: await res.json() };
  };

  it('Xero shows it was sent: reports Xero\'s record, corrects the item and run to sent, emails nothing', async () => {
    seedFailed();
    mockGetInvoiceById.mockResolvedValue(xeroInvoice({ SentToContact: true }));
    const { res, body } = await check();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ reconciled: true, runStatus: 'sent' });
    expect(body.delivery).toMatchObject({ invoiceNumber: 'INV-0003', status: 'AUTHORISED', emailed: true, total: 600, totalTax: 0, date: '2026-11-23', dueDate: '2026-12-07' });
    expect(mockSendInvoice).not.toHaveBeenCalled();
    expect(fakeDb._store.invoiceRunItems.item1.status).toBe('sent');
    expect(fakeDb._store.invoiceRuns.run1.status).toBe('sent');
  });

  it('Xero shows it was NOT sent: reports that, changes nothing, emails nothing', async () => {
    seedFailed();
    const { body } = await check();
    expect(body).toMatchObject({ reconciled: false, runStatus: 'failed' });
    expect(body.delivery.emailed).toBe(false);
    expect(mockSendInvoice).not.toHaveBeenCalled();
    expect(fakeDb._store.invoiceRunItems.item1.status).toBe('email_failed');
    expect(fakeDb._store.invoiceRuns.run1.status).toBe('failed');
  });

  it('an item with no Xero invoice cannot be checked', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'failed' });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', status: 'error' });
    const { res } = await check();
    expect(res.status).toBe(400);
    expect(mockGetInvoiceById).not.toHaveBeenCalled();
  });
});
