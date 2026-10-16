import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

function makeFakeDb() {
  const store = {};

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
          async set(data) { store[name][docId] = { ...data }; },
          async update(patch) { store[name][docId] = { ...(store[name][docId] || {}), ...patch }; },
        };
      },
      where(field, op, value) {
        const all = Object.entries(store[name]).map(([id, data]) => ({ id, data: () => data, _raw: data }));
        const filtered = all.filter((d) => (op === '==' ? d._raw[field] === value : true));
        return { get: async () => ({ docs: filtered, empty: filtered.length === 0, size: filtered.length }) };
      },
      async get() {
        const docs = Object.entries(store[name]).map(([id, data]) => ({ id, data: () => data }));
        return { docs, empty: docs.length === 0 };
      },
      orderBy() {
        return { limit: () => ({ get: async () => ({ docs: [], empty: true }) }) };
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

  return { collection: withCol, batch, _store: store };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
});

async function seedPendingCharge(id, overrides = {}) {
  fakeDb.collection('propertyCharges').doc(id).set({
    propertyId: id,
    propertyAddress: `${id} Test St`,
    agentUserId: 'agent1',
    agentName: 'Jo Lee',
    agentEmail: 'jo@example.com',
    billingEntityType: 'agency',
    billingEntityKey: 'agency:harcourts',
    billingEntityName: 'Harcourts',
    status: 'pending',
    subtotalEx: 181.82,
    gstAmount: 18.18,
    totalInc: 200,
    createdAt: { toDate: () => new Date('2026-10-01') },
    ...overrides,
  });
}

describe('createInvoiceRunFromPendingCharges', () => {
  it('returns null when there is nothing pending', async () => {
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(result).toBeNull();
  });

  it('bundles every pending charge into one draft run, grouped by billing entity', async () => {
    await seedPendingCharge('propA');
    await seedPendingCharge('propB');
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result.totalProperties).toBe(2);
    expect(result.totalAgencies).toBe(1);
    expect(result.totalAmountInc).toBe(400);

    const items = await fakeDb.collection('invoiceRunItems').get();
    expect(items.docs.length).toBe(1);
    expect(items.docs[0].data().propertyCount).toBe(2);
  });

  it('moves every included charge from pending to queued, attached to the new run', async () => {
    await seedPendingCharge('propA');
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    const charge = await fakeDb.collection('propertyCharges').doc('propA').get();
    expect(charge.data().status).toBe('queued');
    expect(charge.data().runId).toBe(result.runId);
  });

  it('never re-includes an already-queued/invoiced charge in a second run', async () => {
    await seedPendingCharge('propA');
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const first = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(first.totalProperties).toBe(1);

    // Nothing pending left — a second run right away must find nothing.
    const second = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(second).toBeNull();
  });

  it('groups two different agencies into two separate items', async () => {
    await seedPendingCharge('propA', { billingEntityKey: 'agency:harcourts', billingEntityName: 'Harcourts' });
    await seedPendingCharge('propB', { billingEntityKey: 'agency:ray-white', billingEntityName: 'Ray White' });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(result.totalAgencies).toBe(2);
  });

  it('sweeps for a property with no charge yet and records one before aggregating (the safety net)', async () => {
    fakeDb.collection('users').doc('agent1').set({ companyName: 'Harcourts', firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [] });
    fakeDb.collection('properties').doc('propC').set({ userId: 'agent1', address: '3 C St' });

    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result.totalProperties).toBe(1);
    const charge = await fakeDb.collection('propertyCharges').doc('propC').get();
    expect(charge.exists).toBe(true);
    expect(charge.data().status).toBe('queued'); // swept, then immediately included
  });

  it('sums GST-inclusive totals accurately across multiple properties for one agency', async () => {
    await seedPendingCharge('propA', { subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 });
    await seedPendingCharge('propB', { subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 });
    await seedPendingCharge('propC', { subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(result.totalAmountInc).toBe(600);
    expect(result.totalAmountEx).toBeCloseTo(545.46, 2);
    expect(result.totalGst).toBeCloseTo(54.54, 2);
  });
});
