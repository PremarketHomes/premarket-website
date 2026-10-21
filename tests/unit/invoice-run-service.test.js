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

  it('holds back a charge flagged pendingAgencyName (unresolved agency membership) — never bundled, never billed independently', async () => {
    await seedPendingCharge('propHeld', {
      billingEntityType: 'independent', billingEntityKey: 'agent:agentUnverified',
      agentUserId: 'agentUnverified', pendingAgencyName: 'Harcourts Property Hub',
    });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result).toBeNull(); // the only pending charge was held — nothing runnable
    const charge = await fakeDb.collection('propertyCharges').doc('propHeld').get();
    expect(charge.data().status).toBe('pending'); // untouched — still awaiting admin resolution, not lost
  });

  it('holds back an unresolved-membership charge while still bundling OTHER genuinely independent/agency charges normally', async () => {
    await seedPendingCharge('propA'); // normal agency charge
    await seedPendingCharge('propHeld', {
      billingEntityType: 'independent', billingEntityKey: 'agent:agentUnverified',
      agentUserId: 'agentUnverified', pendingAgencyName: 'Some Agency',
    });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result.totalProperties).toBe(1); // only propA
    const heldCharge = await fakeDb.collection('propertyCharges').doc('propHeld').get();
    expect(heldCharge.data().status).toBe('pending');
    expect(heldCharge.data().runId).toBeUndefined();
  });

  it('a genuine independent agent (no pendingAgencyName at all) is billed normally — unaffected by the membership-hold logic', async () => {
    await seedPendingCharge('propSolo', {
      billingEntityType: 'independent', billingEntityKey: 'agent:soloAgent', agentUserId: 'soloAgent',
    });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result.totalProperties).toBe(1);
    const charge = await fakeDb.collection('propertyCharges').doc('propSolo').get();
    expect(charge.data().status).toBe('queued'); // bundled and billed, exactly like today
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
    // No companyName here deliberately — this test is purely about the
    // sweep mechanism itself, not agency resolution; a companyName
    // with no confirmed/verified entity would now correctly hold the
    // charge back from the run (see the pendingAgencyName tests above),
    // which would defeat what THIS test is checking.
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: new Date('2020-01-01') });
    fakeDb.collection('properties').doc('propC').set({ userId: 'agent1', address: '3 C St', createdAt: new Date() });

    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result.totalProperties).toBe(1);
    const charge = await fakeDb.collection('propertyCharges').doc('propC').get();
    expect(charge.exists).toBe(true);
    expect(charge.data().status).toBe('queued'); // swept, then immediately included
  });

  it('the pre-run sweep never backfills a historical property into this (or any) run', async () => {
    fakeDb.collection('users').doc('agent1').set({ companyName: 'Harcourts', firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: new Date('2026-06-01') });
    fakeDb.collection('properties').doc('historical').set({ userId: 'agent1', address: '1 Old St', createdAt: new Date('2024-01-01') });

    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result).toBeNull(); // nothing pending — the historical property was correctly never charged
    const charge = await fakeDb.collection('propertyCharges').doc('historical').get();
    expect(charge.exists).toBe(false);
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

  describe('onlyEntityKeys — the 30-day-per-agency cron filter', () => {
    it('bundles only the given entities, leaving every other agency\'s charges untouched at pending', async () => {
      await seedPendingCharge('propA', { billingEntityKey: 'agency:due', billingEntityName: 'Due Agency' });
      await seedPendingCharge('propB', { billingEntityKey: 'agency:not-due', billingEntityName: 'Not Due Agency' });
      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

      const result = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: ['agency:due'] });

      expect(result.totalProperties).toBe(1);
      expect(result.totalAgencies).toBe(1);

      const chargeA = await fakeDb.collection('propertyCharges').doc('propA').get();
      const chargeB = await fakeDb.collection('propertyCharges').doc('propB').get();
      expect(chargeA.data().status).toBe('queued');
      expect(chargeB.data().status).toBe('pending'); // left alone — not due yet
    });

    it('returns null (no run created) when none of the given entities have anything pending', async () => {
      await seedPendingCharge('propA', { billingEntityKey: 'agency:not-due' });
      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

      const result = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: ['agency:due'] });
      expect(result).toBeNull();
      const charge = await fakeDb.collection('propertyCharges').doc('propA').get();
      expect(charge.data().status).toBe('pending'); // never touched
    });

    it('a retry (same due set, called again) never double-bundles — the second call finds nothing left pending for that entity', async () => {
      await seedPendingCharge('propA', { billingEntityKey: 'agency:due' });
      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

      const first = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: ['agency:due'] });
      expect(first.totalProperties).toBe(1);

      const second = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: ['agency:due'] });
      expect(second).toBeNull();
    });
  });

  describe('designated billing contact override', () => {
    it('uses the designated billing contact instead of the charge\'s own agent, when one has been set', async () => {
      await seedPendingCharge('propA', { billingEntityKey: 'agency:a', agentName: 'Jo (whoever created the first charge)', agentEmail: 'jo@example.com' });
      fakeDb.collection('billingContacts').doc('agency:a').set({ billingEntityKey: 'agency:a', status: 'confirmed', name: 'Accounts Payable', email: 'accounts@agency-a.example.com' });

      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
      await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

      const items = await fakeDb.collection('invoiceRunItems').get();
      expect(items.docs[0].data().agentName).toBe('Accounts Payable');
      expect(items.docs[0].data().agentEmail).toBe('accounts@agency-a.example.com');
    });

    it('falls back to the triggering agent\'s own name/email when no contact has been designated', async () => {
      await seedPendingCharge('propA', { billingEntityKey: 'agency:a', agentName: 'Jo Lee', agentEmail: 'jo@example.com' });

      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
      await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

      const items = await fakeDb.collection('invoiceRunItems').get();
      expect(items.docs[0].data().agentName).toBe('Jo Lee');
      expect(items.docs[0].data().agentEmail).toBe('jo@example.com');
    });
  });
});
