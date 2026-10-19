import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A single, cohesive end-to-end test of the whole invoicing workflow,
 * written to directly demonstrate the production-readiness checklist
 * requested before deploying this branch: one agency's multiple
 * campaigns consolidate into one itemised invoice; different agencies
 * become due independently on their own 30-day clock; the designated
 * billing contact overrides the fallback agent; the $200 charge is
 * sent to Xero as genuinely GST-free (TaxType, not just a $0 display
 * in our own UI); the manual approve-then-send gate is enforced, not
 * bypassable; retrying send or sync cannot create a duplicate invoice
 * or a duplicate charge.
 *
 * Only the actual external boundary — the Xero HTTP API itself — is
 * mocked (via the xeroService module, the same boundary every other
 * xero-*.test.js file in this suite mocks). Every other layer
 * (billingService, invoiceRunService, the admin run/send/sync routes)
 * runs for real against an in-memory Firestore fake. No real network
 * call to Xero is possible from this test — there is no Xero
 * credential available in this environment at all — which is the
 * actual guarantee behind "no invoice can be sent to a real customer
 * during testing," not merely an assertion about intent.
 */

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const mockIsXeroConnected = vi.fn();
const mockFindOrCreateContact = vi.fn();
const mockCreateInvoice = vi.fn();
const mockSendInvoice = vi.fn();
const mockBatchGetInvoiceStatuses = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  isXeroConnected: (...args) => mockIsXeroConnected(...args),
  findOrCreateContact: (...args) => mockFindOrCreateContact(...args),
  createInvoice: (...args) => mockCreateInvoice(...args),
  sendInvoice: (...args) => mockSendInvoice(...args),
  batchGetInvoiceStatuses: (...args) => mockBatchGetInvoiceStatuses(...args),
}));

function makeFakeDb() {
  const store = {};

  function matches(raw, field, op, value) {
    if (op === '==') return raw[field] === value;
    if (op === 'array-contains') return Array.isArray(raw[field]) && raw[field].includes(value);
    return true;
  }

  function withCol(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        const docId = id || `auto-${Math.random().toString(36).slice(2)}`;
        return {
          id: docId,
          _col: name,
          async get() {
            const data = store[name][docId];
            return { exists: !!data, id: docId, data: () => data };
          },
          async create(data) {
            if (store[name][docId]) {
              const err = new Error('ALREADY_EXISTS');
              err.code = 6;
              throw err;
            }
            store[name][docId] = { ...data };
          },
          async set(data, opts) {
            store[name][docId] = opts?.merge ? { ...(store[name][docId] || {}), ...data } : { ...data };
          },
          async update(patch) { store[name][docId] = { ...(store[name][docId] || {}), ...patch }; },
          async delete() { delete store[name][docId]; },
        };
      },
      where(field, op, value) {
        function makeQuery(docs) {
          return {
            where: (f2, o2, v2) => makeQuery(docs.filter((d) => matches(d._raw, f2, o2, v2))),
            get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
            limit: () => ({ get: async () => ({ docs: docs.slice(0, 1), empty: docs.length === 0 }) }),
          };
        }
        const all = Object.entries(store[name]).map(([id, data]) => ({
          id,
          data: () => data,
          _raw: data,
          ref: {
            _col: name,
            id,
            update: async (patch) => { store[name][id] = { ...(store[name][id] || {}), ...patch }; },
            delete: async () => { delete store[name][id]; },
          },
        }));
        return makeQuery(all.filter((d) => matches(d._raw, field, op, value)));
      },
      async get() {
        const docs = Object.entries(store[name]).map(([id, data]) => ({
          id,
          data: () => data,
          ref: { _col: name, id, update: async (patch) => { store[name][id] = { ...(store[name][id] || {}), ...patch }; } },
        }));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
      orderBy() {
        return { limit: () => ({ get: async () => ({ docs: [], empty: true }) }) };
      },
    };
  }

  function batch() {
    const ops = [];
    return {
      set: (ref, data) => ops.push(() => { store[ref._col] = store[ref._col] || {}; store[ref._col][ref.id] = { ...data }; }),
      update: (ref, patch) => ops.push(() => { store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch }; }),
      delete: (ref) => ops.push(() => { delete store[ref._col][ref.id]; }),
      commit: async () => { ops.forEach((op) => op()); },
    };
  }

  return { collection: withCol, batch, _store: store, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function makeAuthedRequest({ body, method = 'POST' } = {}) {
  const headers = new Headers({ authorization: 'Bearer t' });
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    return new Request('http://localhost/test', { method, headers, body: JSON.stringify(body) });
  }
  return new Request('http://localhost/test', { method, headers });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
  fakeDb._seed('users', 'admin1', { superAdmin: true });
  fakeDb._seed('settings', 'invoicing', {
    pricePerListing: 200,
    gstRate: 0, // not GST registered
    excludeAgentIds: [],
    billingActivatedAt: new Date('2020-01-01'),
  });
  fakeDb._seed('users', 'agentA', { firstName: 'Jo', lastName: 'Lee', email: 'jo@agency-a.example.com' });
  fakeDb._seed('users', 'agentB', { firstName: 'Max', lastName: 'Tan', email: 'max@agency-b.example.com' });
});

describe('Invoicing end-to-end — safe, fully mocked at the Xero HTTP boundary only', () => {
  it('runs the complete workflow: itemised consolidation, independent 30-day due dates, designated contact, GST-free, approval gate, send, sync, and retry-safety', async () => {
    // --- Setup: Agency A has 3 campaigns all 31 days old (due). Agency B has 1 campaign created today (not due). ---
    fakeDb._seed('propertyCharges', 'propA1', {
      propertyId: 'propA1', propertyAddress: '1 First St', agentUserId: 'agentA', agentName: 'Jo Lee', agentEmail: 'jo@agency-a.example.com',
      billingEntityType: 'agency', billingEntityKey: 'agency:a', billingEntityName: 'Agency A',
      status: 'pending', subtotalEx: 200, gstAmount: 0, totalInc: 200, createdAt: daysAgo(31),
    });
    fakeDb._seed('propertyCharges', 'propA2', {
      propertyId: 'propA2', propertyAddress: '2 Second St', agentUserId: 'agentA', agentName: 'Jo Lee', agentEmail: 'jo@agency-a.example.com',
      billingEntityType: 'agency', billingEntityKey: 'agency:a', billingEntityName: 'Agency A',
      status: 'pending', subtotalEx: 200, gstAmount: 0, totalInc: 200, createdAt: daysAgo(31),
    });
    fakeDb._seed('propertyCharges', 'propA3', {
      propertyId: 'propA3', propertyAddress: '3 Third St', agentUserId: 'agentA', agentName: 'Jo Lee', agentEmail: 'jo@agency-a.example.com',
      billingEntityType: 'agency', billingEntityKey: 'agency:a', billingEntityName: 'Agency A',
      status: 'pending', subtotalEx: 200, gstAmount: 0, totalInc: 200, createdAt: daysAgo(31),
    });
    fakeDb._seed('propertyCharges', 'propB1', {
      propertyId: 'propB1', propertyAddress: '1 Other Rd', agentUserId: 'agentB', agentName: 'Max Tan', agentEmail: 'max@agency-b.example.com',
      billingEntityType: 'agency', billingEntityKey: 'agency:b', billingEntityName: 'Agency B',
      status: 'pending', subtotalEx: 200, gstAmount: 0, totalInc: 200, createdAt: daysAgo(0),
    });

    const { getDueBillingEntityKeys, setBillingContact } = await import('../../src/app/api/services/billingService.js');
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    // --- Step 3: different agencies become due independently ---
    const allPending = Object.values(fakeDb._store.propertyCharges);
    const dueKeys = getDueBillingEntityKeys(allPending, new Date());
    expect(dueKeys).toEqual(['agency:a']); // Agency B's single 0-day-old charge is correctly NOT due yet

    // --- Step 4: designated billing contact overrides the fallback agent ---
    await setBillingContact({ billingEntityKey: 'agency:a', name: 'Accounts Payable', email: 'accounts@agency-a.example.com', adminUid: 'admin1' });

    // --- Create the draft run for only the due agency (the cron's own filter) ---
    const runResult = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: dueKeys });
    expect(runResult).not.toBeNull();
    expect(runResult.totalAgencies).toBe(1); // Agency B never touched
    expect(runResult.totalProperties).toBe(3);

    const runId = runResult.runId;
    const itemsSnap = await fakeDb.collection('invoiceRunItems').where('runId', '==', runId).get();
    expect(itemsSnap.docs.length).toBe(1); // ONE consolidated item for Agency A
    const item = itemsSnap.docs[0].data();

    // --- Step 2: itemised — each property present individually ---
    expect(item.propertyCount).toBe(3);
    expect(item.properties.map((p) => p.address).sort()).toEqual(['1 First St', '2 Second St', '3 Third St']);
    expect(item.totalInc).toBe(600);

    // --- Step 4 (continued): the item uses the designated contact, not the fallback agent ---
    expect(item.agentEmail).toBe('accounts@agency-a.example.com');
    expect(item.agentName).toBe('Accounts Payable');

    // --- Agency B's charge is completely untouched throughout ---
    const chargeB = await fakeDb.collection('propertyCharges').doc('propB1').get();
    expect(chargeB.data().status).toBe('pending');

    // --- Step 7/8: cannot send before approval — the gate is enforced, not optional ---
    mockIsXeroConnected.mockResolvedValue(true);
    const { POST: sendPOST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const prematureSend = await sendPOST(makeAuthedRequest(), { params: Promise.resolve({ runId }) });
    expect(prematureSend.status).toBe(400);
    expect(mockCreateInvoice).not.toHaveBeenCalled(); // Xero was never touched

    // --- Approve (the one and only way past the gate) ---
    const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const approveRes = await PATCH(makeAuthedRequest({ body: { action: 'approve' } }), { params: Promise.resolve({ runId }) });
    expect((await approveRes.json()).status).toBe('approved');

    // --- Step 6/9: send — mocked Xero call, verified GST-free (TaxType, not just $0 display) and itemised ---
    mockFindOrCreateContact.mockResolvedValue({ ContactID: 'xero-contact-1' });
    mockCreateInvoice.mockResolvedValue({ InvoiceID: 'xero-inv-1', InvoiceNumber: 'PM-1', Status: 'AUTHORISED' });
    mockSendInvoice.mockResolvedValue({});

    const sendRes = await sendPOST(makeAuthedRequest(), { params: Promise.resolve({ runId }) });
    const sendData = await sendRes.json();
    expect(sendRes.status).toBe(200);
    expect(sendData.sent).toBe(1);
    expect(sendData.failed).toBe(0);

    // Who it was actually sent to — the designated contact, confirmed at the real Xero-call boundary.
    expect(mockFindOrCreateContact).toHaveBeenCalledTimes(1);
    expect(mockFindOrCreateContact.mock.calls[0][0].email).toBe('accounts@agency-a.example.com');

    // GST-free in the actual Xero payload, not merely displayed as $0 in our own UI.
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const invoiceCall = mockCreateInvoice.mock.calls[0][0];
    expect(invoiceCall.lineItems).toHaveLength(3); // itemised — one line per property
    expect(invoiceCall.lineItems.every((li) => li.taxType === 'NONE')).toBe(true);
    expect(invoiceCall.lineItems.every((li) => li.unitAmount === 200)).toBe(true);

    // Every property charge actually invoiced — not just queued.
    for (const propId of ['propA1', 'propA2', 'propA3']) {
      const charge = await fakeDb.collection('propertyCharges').doc(propId).get();
      expect(charge.data().status).toBe('invoiced');
    }

    // --- Step 7: retry-safety — calling send again cannot create a second invoice ---
    const retrySend = await sendPOST(makeAuthedRequest(), { params: Promise.resolve({ runId }) });
    expect(retrySend.status).toBe(400); // run is 'sent', no longer 'approved' — the gate blocks the retry outright
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1); // still exactly one invoice ever created

    // --- Step 6: status sync (mocked Xero "PAID") ---
    mockBatchGetInvoiceStatuses.mockResolvedValue([{ InvoiceID: 'xero-inv-1', Status: 'PAID', FullyPaidOnDate: '2026-11-01' }]);
    const { POST: syncPOST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/sync/route.js');
    const syncRes = await syncPOST(makeAuthedRequest(), { params: Promise.resolve({ runId }) });
    const syncData = await syncRes.json();
    expect(syncData.paidCount).toBe(1);

    const syncedItem = (await fakeDb.collection('invoiceRunItems').where('runId', '==', runId).get()).docs[0].data();
    expect(syncedItem.status).toBe('paid');
    expect(syncedItem.paidAt).toBe('2026-11-01');

    // --- Retrying sync is idempotent — no duplicate writes, same end state ---
    const syncRes2 = await syncPOST(makeAuthedRequest(), { params: Promise.resolve({ runId }) });
    const syncData2 = await syncRes2.json();
    expect(syncData2.paidCount).toBe(1);
    expect(mockBatchGetInvoiceStatuses).toHaveBeenCalledTimes(2); // ran twice, caused no duplicate side effects

    // --- Step 7 (the other half): a later cron pass can never re-invoice what's already invoiced ---
    const laterPending = Object.values(fakeDb._store.propertyCharges).filter((c) => c.status === 'pending');
    const laterDueKeys = getDueBillingEntityKeys(laterPending, new Date());
    const secondRun = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: laterDueKeys.length ? laterDueKeys : ['agency:a'] });
    expect(secondRun).toBeNull(); // nothing left pending for Agency A — already invoiced, never duplicated
  });
});
