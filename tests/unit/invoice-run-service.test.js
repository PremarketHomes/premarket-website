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
  const agentUserId = overrides.agentUserId || 'agent1';
  fakeDb.collection('propertyCharges').doc(id).set({
    propertyId: id,
    propertyAddress: `${id} Test St`,
    agentUserId,
    agentName: 'Jo Lee',
    agentEmail: 'jo@example.com',
    billingEntityType: 'independent',
    billingEntityKey: `agent:${agentUserId}`,
    billingEntityName: 'Jo Lee',
    status: 'pending',
    subtotalEx: 181.82,
    gstAmount: 18.18,
    totalInc: 200,
    createdAt: { toDate: () => new Date('2026-10-01') },
    ...overrides,
  });
}

// Confirms the given agent's billing contact — a charge is only ever
// bundled into a run once this exists (see createInvoiceRunFromPendingCharges).
function confirmContact(billingEntityKey, { name = 'Jo Lee', email = 'jo@example.com' } = {}) {
  fakeDb.collection('billingContacts').doc(billingEntityKey).set({ billingEntityKey, status: 'confirmed', name, email });
}

describe('createInvoiceRunFromPendingCharges', () => {
  it('returns null when there is nothing pending', async () => {
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(result).toBeNull();
  });

  it('holds back a charge whose agent has no confirmed billing contact yet — never bundled, never billed', async () => {
    await seedPendingCharge('propHeld', { agentUserId: 'agentUnconfirmed' });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result).toBeNull(); // the only pending charge was held — nothing runnable
    const charge = await fakeDb.collection('propertyCharges').doc('propHeld').get();
    expect(charge.data().status).toBe('pending'); // untouched — still awaiting admin confirmation, not lost
  });

  it('holds back an unconfirmed agent\'s charge while still bundling a DIFFERENT, confirmed agent\'s charges normally', async () => {
    await seedPendingCharge('propA', { agentUserId: 'agentConfirmed' });
    confirmContact('agent:agentConfirmed');
    await seedPendingCharge('propHeld', { agentUserId: 'agentUnconfirmed' });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result.totalProperties).toBe(1); // only propA
    const heldCharge = await fakeDb.collection('propertyCharges').doc('propHeld').get();
    expect(heldCharge.data().status).toBe('pending');
    expect(heldCharge.data().runId).toBeUndefined();
  });

  it('a confirmed agent is billed normally, keyed by their own UID', async () => {
    await seedPendingCharge('propSolo', { agentUserId: 'soloAgent' });
    confirmContact('agent:soloAgent');
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result.totalProperties).toBe(1);
    const charge = await fakeDb.collection('propertyCharges').doc('propSolo').get();
    expect(charge.data().status).toBe('queued'); // bundled and billed
  });

  it('bundles every pending charge from ONE confirmed agent into one draft run item', async () => {
    confirmContact('agent:agent1');
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

  it('two agents at the SAME named agency, both confirmed, bundle into TWO separate items — never consolidated', async () => {
    confirmContact('agent:agentA', { name: 'Jo Lee', email: 'jo@example.com' });
    confirmContact('agent:agentB', { name: 'Max Tan', email: 'max@example.com' });
    await seedPendingCharge('propA', { agentUserId: 'agentA', billingEntityName: 'Jo Lee' });
    await seedPendingCharge('propB', { agentUserId: 'agentB', billingEntityName: 'Max Tan' });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result.totalAgencies).toBe(2);
    const items = await fakeDb.collection('invoiceRunItems').get();
    const keys = items.docs.map((d) => d.data().billingEntityKey).sort();
    expect(keys).toEqual(['agent:agentA', 'agent:agentB']);
  });

  it('two agents sharing the exact same billing email are still never consolidated into one item', async () => {
    confirmContact('agent:agentA', { name: 'Jo Lee', email: 'shared@example.com' });
    confirmContact('agent:agentB', { name: 'Max Tan', email: 'shared@example.com' });
    await seedPendingCharge('propA', { agentUserId: 'agentA' });
    await seedPendingCharge('propB', { agentUserId: 'agentB' });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(result.totalAgencies).toBe(2);
  });

  it('moves every included charge from pending to queued, attached to the new run', async () => {
    confirmContact('agent:agent1');
    await seedPendingCharge('propA');
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    const charge = await fakeDb.collection('propertyCharges').doc('propA').get();
    expect(charge.data().status).toBe('queued');
    expect(charge.data().runId).toBe(result.runId);
  });

  it('never re-includes an already-queued/invoiced charge in a second run', async () => {
    confirmContact('agent:agent1');
    await seedPendingCharge('propA');
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const first = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(first.totalProperties).toBe(1);

    // Nothing pending left — a second run right away must find nothing.
    const second = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(second).toBeNull();
  });

  it('sweeps for a property with no charge yet and records one before aggregating (the safety net) — still held until that agent is confirmed', async () => {
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: new Date('2020-01-01') });
    fakeDb.collection('properties').doc('propC').set({ userId: 'agent1', address: '3 C St', createdAt: new Date() });

    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    // The sweep records the charge, but agent1 has no confirmed
    // billing contact yet, so nothing is runnable this time.
    expect(result).toBeNull();
    const charge = await fakeDb.collection('propertyCharges').doc('propC').get();
    expect(charge.exists).toBe(true);
    expect(charge.data().status).toBe('pending');
  });

  it('a swept charge for an already-confirmed agent is bundled immediately, in the same run', async () => {
    confirmContact('agent:agent1');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: new Date('2020-01-01') });
    fakeDb.collection('properties').doc('propC').set({ userId: 'agent1', address: '3 C St', createdAt: new Date() });

    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

    expect(result.totalProperties).toBe(1);
    const charge = await fakeDb.collection('propertyCharges').doc('propC').get();
    expect(charge.data().status).toBe('queued');
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

  it('sums GST-inclusive totals accurately across multiple properties for one confirmed agent', async () => {
    confirmContact('agent:agent1');
    await seedPendingCharge('propA', { subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 });
    await seedPendingCharge('propB', { subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 });
    await seedPendingCharge('propC', { subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 });
    const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });
    expect(result.totalAmountInc).toBe(600);
    expect(result.totalAmountEx).toBeCloseTo(545.46, 2);
    expect(result.totalGst).toBeCloseTo(54.54, 2);
  });

  describe('onlyEntityKeys — the 30-day-per-agent cron filter', () => {
    it('bundles only the given agents, leaving every other agent\'s charges untouched at pending', async () => {
      confirmContact('agent:due');
      confirmContact('agent:not-due');
      await seedPendingCharge('propA', { agentUserId: 'due', billingEntityKey: 'agent:due' });
      await seedPendingCharge('propB', { agentUserId: 'not-due', billingEntityKey: 'agent:not-due' });
      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

      const result = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: ['agent:due'] });

      expect(result.totalProperties).toBe(1);
      expect(result.totalAgencies).toBe(1);

      const chargeA = await fakeDb.collection('propertyCharges').doc('propA').get();
      const chargeB = await fakeDb.collection('propertyCharges').doc('propB').get();
      expect(chargeA.data().status).toBe('queued');
      expect(chargeB.data().status).toBe('pending'); // left alone — not due yet
    });

    it('returns null (no run created) when none of the given agents have anything pending', async () => {
      confirmContact('agent:not-due');
      await seedPendingCharge('propA', { agentUserId: 'not-due', billingEntityKey: 'agent:not-due' });
      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

      const result = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: ['agent:due'] });
      expect(result).toBeNull();
      const charge = await fakeDb.collection('propertyCharges').doc('propA').get();
      expect(charge.data().status).toBe('pending'); // never touched
    });

    it('a retry (same due set, called again) never double-bundles — the second call finds nothing left pending for that agent', async () => {
      confirmContact('agent:due');
      await seedPendingCharge('propA', { agentUserId: 'due', billingEntityKey: 'agent:due' });
      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');

      const first = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: ['agent:due'] });
      expect(first.totalProperties).toBe(1);

      const second = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: ['agent:due'] });
      expect(second).toBeNull();
    });
  });

  describe('designated billing contact stamp', () => {
    it('stamps the confirmed contact\'s name/email onto the run item for admin preview', async () => {
      confirmContact('agent:a', { name: 'Accounts Payable', email: 'accounts@example.com' });
      await seedPendingCharge('propA', { agentUserId: 'a', billingEntityKey: 'agent:a', agentName: 'Jo (login name)', agentEmail: 'jo@example.com' });

      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
      await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

      const items = await fakeDb.collection('invoiceRunItems').get();
      expect(items.docs[0].data().agentName).toBe('Accounts Payable');
      expect(items.docs[0].data().agentEmail).toBe('accounts@example.com');
      expect(items.docs[0].data().billingContactStatus).toBe('confirmed');
    });

    it('never falls back to the agent\'s own login email/name — an unconfirmed agent is held, not bundled with a fallback', async () => {
      await seedPendingCharge('propA', { agentUserId: 'unconfirmed', billingEntityKey: 'agent:unconfirmed', agentName: 'Jo Lee', agentEmail: 'jo@example.com' });

      const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService.js');
      const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin1' });

      expect(result).toBeNull();
      const items = await fakeDb.collection('invoiceRunItems').get();
      expect(items.docs.length).toBe(0);
    });
  });
});
