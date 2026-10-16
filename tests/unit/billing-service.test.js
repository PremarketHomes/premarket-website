import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

// A small in-memory Firestore fake, scoped per test file — real enough
// to exercise recordPropertyCharge's idempotency (including .create()
// throwing ALREADY_EXISTS on a duplicate) and the batch-based charge
// status transitions, without needing the Firestore emulator (not
// available in this environment — see tests/rules/ for the same
// pre-existing constraint).
function makeFakeDb() {
  const store = {}; // collection -> { id -> data }

  function collection(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        const docId = id || `auto-${Math.random().toString(36).slice(2)}`;
        return {
          id: docId,
          async get() {
            const data = store[name][docId];
            return { exists: !!data, id: docId, data: () => data };
          },
          async create(data) {
            if (store[name][docId]) {
              const err = new Error('ALREADY_EXISTS: Document already exists');
              err.code = 6;
              throw err;
            }
            store[name][docId] = { ...data };
          },
          async set(data) {
            store[name][docId] = { ...data };
          },
          async update(patch) {
            store[name][docId] = { ...(store[name][docId] || {}), ...patch };
          },
        };
      },
      where(field, op, value) {
        const all = Object.entries(store[name]).map(([id, data]) => ({ id, data: () => data, _raw: data }));
        const filtered = all.filter((d) => {
          if (op === '==') return d._raw[field] === value;
          if (op === 'array-contains') return Array.isArray(d._raw[field]) && d._raw[field].includes(value);
          return true;
        });
        return {
          get: async () => ({ docs: filtered, empty: filtered.length === 0, size: filtered.length }),
          limit: () => ({ get: async () => ({ docs: filtered.slice(0, 1), empty: filtered.length === 0 }) }),
        };
      },
      async get() {
        const docs = Object.entries(store[name]).map(([id, data]) => ({ id, data: () => data }));
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
      set: (ref, data) => ops.push(() => { store[ref._col][ref.id] = { ...data }; }),
      update: (ref, patch) => ops.push(() => { store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch }; }),
      delete: (ref) => ops.push(() => { delete store[ref._col][ref.id]; }),
      commit: async () => { ops.forEach((op) => op()); },
    };
  }

  return { collection, batch, _store: store };
}

// doc refs created via collection(name).doc(id) above don't carry a
// _col back-reference for the batch fake to use — patch collection()
// to stamp one on, used only by batch() above.
function withColRef(db) {
  const originalCollection = db.collection;
  db.collection = (name) => {
    const c = originalCollection(name);
    const originalDoc = c.doc;
    c.doc = (id) => ({ ...originalDoc(id), _col: name });
    return c;
  };
  return db;
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

beforeEach(() => {
  fakeDb = withColRef(makeFakeDb());
  vi.clearAllMocks();
});

describe('resolveBillingEntity (pure)', () => {
  it('groups by normalised companyName when present', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const a = resolveBillingEntity({ agentUserId: 'u1', companyName: 'Harcourts Property Hub ' });
    const b = resolveBillingEntity({ agentUserId: 'u2', companyName: ' harcourts property hub' });
    expect(a.billingEntityType).toBe('agency');
    expect(a.billingEntityKey).toBe(b.billingEntityKey);
    expect(a.billingEntityName).toBe('Harcourts Property Hub');
  });

  it('treats an agent with no companyName as independent, keyed by their own uid', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const result = resolveBillingEntity({ agentUserId: 'u3', companyName: '', firstName: 'Jo', lastName: 'Lee' });
    expect(result.billingEntityType).toBe('independent');
    expect(result.billingEntityKey).toBe('agent:u3');
    expect(result.billingEntityName).toBe('Jo Lee');
  });

  it('two independent agents never share a billing entity key, even with the same name', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const a = resolveBillingEntity({ agentUserId: 'u1', firstName: 'Sam', lastName: 'Lee' });
    const b = resolveBillingEntity({ agentUserId: 'u2', firstName: 'Sam', lastName: 'Lee' });
    expect(a.billingEntityKey).not.toBe(b.billingEntityKey);
  });

  it('carries agencyBrandId through for future reference without using it as the grouping key', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const a = resolveBillingEntity({ agentUserId: 'u1', companyName: 'Acme', agencyBrandId: 'acme-brand' });
    const b = resolveBillingEntity({ agentUserId: 'u2', companyName: 'Acme' }); // no brand set
    expect(a.billingEntityKey).toBe(b.billingEntityKey); // same group despite one missing a brand
    expect(a.agencyBrandId).toBe('acme-brand');
    expect(b.agencyBrandId).toBeNull();
  });
});

describe('computeChargeAmounts (pure)', () => {
  it('derives subtotal/GST from a GST-inclusive price', async () => {
    const { computeChargeAmounts } = await import('../../src/app/api/services/billingService.js');
    const result = computeChargeAmounts(200, 0.1);
    expect(result.totalInc).toBe(200);
    expect(result.subtotalEx).toBeCloseTo(181.82, 2);
    expect(result.gstAmount).toBeCloseTo(18.18, 2);
    expect(result.subtotalEx + result.gstAmount).toBeCloseTo(result.totalInc, 5);
  });
});

describe('recordPropertyCharge', () => {
  async function setup() {
    const svc = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts Property Hub', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [] });
    return svc;
  }

  it('creates exactly one charge for a new property', async () => {
    const { recordPropertyCharge } = await setup();
    const result = await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St' });
    expect(result.created).toBe(true);
    const doc = await fakeDb.collection('propertyCharges').doc('prop1').get();
    expect(doc.exists).toBe(true);
    expect(doc.data().status).toBe('pending');
    expect(doc.data().billingEntityType).toBe('agency');
    expect(doc.data().billingEntityName).toBe('Harcourts Property Hub');
    expect(doc.data().totalInc).toBe(200);
  });

  it('is idempotent — calling it again for the same property is a safe no-op', async () => {
    const { recordPropertyCharge } = await setup();
    await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St' });
    const second = await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St' });
    expect(second.created).toBe(false);
    expect(second.reason).toBe('already-recorded');

    // Still exactly one charge document, not two.
    const all = await fakeDb.collection('propertyCharges').get();
    expect(all.docs.length).toBe(1);
  });

  it('survives a .create() race (two near-simultaneous calls) without creating two charges or throwing', async () => {
    const { recordPropertyCharge } = await setup();
    const [a, b] = await Promise.all([
      recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St' }),
      recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St' }),
    ]);
    const createdCount = [a, b].filter((r) => r.created).length;
    expect(createdCount).toBe(1);
    const all = await fakeDb.collection('propertyCharges').get();
    expect(all.docs.length).toBe(1);
  });

  it('snapshots the price/GST in force at the time it is called, not a later value', async () => {
    const { recordPropertyCharge } = await setup();
    await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St' });

    // Price changes after the charge was recorded.
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 350, gstRate: 0.1, excludeAgentIds: [] });

    const doc = await fakeDb.collection('propertyCharges').doc('prop1').get();
    expect(doc.data().pricePerListing).toBe(200);
    expect(doc.data().totalInc).toBe(200);
  });

  it('skips an agent on the exclusion list, recording no charge', async () => {
    const { recordPropertyCharge } = await setup();
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: ['agent1'] });
    const result = await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St' });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('agent-excluded');
    const doc = await fakeDb.collection('propertyCharges').doc('prop1').get();
    expect(doc.exists).toBe(false);
  });

  it('skips gracefully (no throw) when the property has no agent userId', async () => {
    const { recordPropertyCharge } = await setup();
    const result = await recordPropertyCharge({ id: 'prop1', address: '1 Test St' });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('no-agent');
  });

  it('two agents at the same company (same normalised name) group under one billing entity', async () => {
    const { recordPropertyCharge } = await setup();
    fakeDb.collection('users').doc('agent2').set({ firstName: 'Max', lastName: 'Tan', companyName: 'harcourts property hub', email: 'max@example.com' });

    await recordPropertyCharge({ id: 'propA', userId: 'agent1', address: '1 A St' });
    await recordPropertyCharge({ id: 'propB', userId: 'agent2', address: '2 B St' });

    const docA = await fakeDb.collection('propertyCharges').doc('propA').get();
    const docB = await fakeDb.collection('propertyCharges').doc('propB').get();
    expect(docA.data().billingEntityKey).toBe(docB.data().billingEntityKey);
  });
});

describe('excludeCharge / reverseCharge', () => {
  async function chargeFixture(status) {
    const svc = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('propertyCharges').doc('chargeA').set({
      propertyId: 'propA', propertyAddress: '1 A St', status, totalInc: 200,
    });
    return svc;
  }

  it('excludes a pending charge and records who/why/when — never deletes it', async () => {
    const { excludeCharge } = await chargeFixture('pending');
    const result = await excludeCharge({ chargeId: 'chargeA', adminUid: 'admin1', reason: 'Duplicate entry' });
    expect(result.status).toBe('excluded');
    const doc = await fakeDb.collection('propertyCharges').doc('chargeA').get();
    expect(doc.exists).toBe(true); // still there
    expect(doc.data().status).toBe('excluded');
    expect(doc.data().adjustment.reason).toBe('Duplicate entry');
    expect(doc.data().adjustment.adminUid).toBe('admin1');
  });

  it('refuses to exclude a charge that is not pending (e.g. already queued in a run)', async () => {
    const { excludeCharge } = await chargeFixture('queued');
    await expect(excludeCharge({ chargeId: 'chargeA', adminUid: 'admin1', reason: 'test' })).rejects.toThrow(/pending/i);
  });

  it('reverses an invoiced charge, flags requiresCreditNote, and preserves the record', async () => {
    const { reverseCharge } = await chargeFixture('invoiced');
    const result = await reverseCharge({ chargeId: 'chargeA', adminUid: 'admin1', reason: 'Vendor cancelled' });
    expect(result.status).toBe('reversed');
    expect(result.requiresCreditNote).toBe(true);
    const doc = await fakeDb.collection('propertyCharges').doc('chargeA').get();
    expect(doc.data().status).toBe('reversed');
    expect(doc.data().requiresCreditNote).toBe(true);
  });

  it('refuses to reverse a charge that has not been invoiced yet', async () => {
    const { reverseCharge } = await chargeFixture('pending');
    await expect(reverseCharge({ chargeId: 'chargeA', adminUid: 'admin1', reason: 'test' })).rejects.toThrow(/invoiced/i);
  });
});

describe('releaseCharges / markChargesInvoiced / markChargesFailed', () => {
  it('releaseCharges only touches queued charges, reverting them to pending', async () => {
    const { releaseCharges } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('propertyCharges').doc('p1').set({ status: 'queued', runId: 'run1' });
    fakeDb.collection('propertyCharges').doc('p2').set({ status: 'invoiced', runId: 'run1' });

    await releaseCharges(['p1', 'p2']);

    const d1 = await fakeDb.collection('propertyCharges').doc('p1').get();
    const d2 = await fakeDb.collection('propertyCharges').doc('p2').get();
    expect(d1.data().status).toBe('pending');
    expect(d1.data().runId).toBeNull();
    expect(d2.data().status).toBe('invoiced'); // untouched — not queued
  });

  it('markChargesInvoiced flips queued charges to invoiced', async () => {
    const { markChargesInvoiced } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('propertyCharges').doc('p1').set({ status: 'queued' });
    await markChargesInvoiced(['p1']);
    const d1 = await fakeDb.collection('propertyCharges').doc('p1').get();
    expect(d1.data().status).toBe('invoiced');
  });

  it('markChargesFailed reverts queued charges to pending for retry', async () => {
    const { markChargesFailed } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('propertyCharges').doc('p1').set({ status: 'queued', runId: 'run1' });
    await markChargesFailed(['p1']);
    const d1 = await fakeDb.collection('propertyCharges').doc('p1').get();
    expect(d1.data().status).toBe('pending');
    expect(d1.data().runId).toBeNull();
  });
});
