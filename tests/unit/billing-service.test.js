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

  // Mirrors real Firestore transaction semantics closely enough for
  // this file's purposes: every write inside the callback is deferred
  // until the callback itself resolves, and nothing is committed to
  // `store` at all if it throws — exactly what
  // createPropertyAndChargeAtomically relies on (property + charge
  // both land, or neither does).
  async function runTransaction(updateFn) {
    const pendingWrites = [];
    const tx = {
      get: async (ref) => {
        const data = store[ref._col]?.[ref.id];
        return { exists: !!data, id: ref.id, data: () => data };
      },
      set: (ref, data) => pendingWrites.push(() => {
        store[ref._col] = store[ref._col] || {};
        store[ref._col][ref.id] = { ...data };
      }),
      update: (ref, patch) => pendingWrites.push(() => {
        store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch };
      }),
    };
    const result = await updateFn(tx);
    pendingWrites.forEach((write) => write());
    return result;
  }

  return { collection, batch, runTransaction, _store: store };
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

  it('a matched brand takes priority over companyName, keying by the stable brand id', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const result = resolveBillingEntity({
      agentUserId: 'u1',
      companyName: 'Harcourts Prop Hub', // deliberately NOT the same string as the brand name
      matchedBrand: { id: 'brand-123', name: 'Harcourts Property Hub' },
    });
    expect(result.billingEntityType).toBe('agency');
    expect(result.billingEntityKey).toBe('brand:brand-123');
    expect(result.billingEntityName).toBe('Harcourts Property Hub');
    expect(result.agencyBrandId).toBe('brand-123');
  });

  it('two agents with a matched brand consolidate even though their companyName strings genuinely differ', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const a = resolveBillingEntity({ agentUserId: 'u1', companyName: 'HPH', matchedBrand: { id: 'brand-123', name: 'Harcourts Property Hub' } });
    const b = resolveBillingEntity({ agentUserId: 'u2', companyName: 'Harcourts Property Hub Pty Ltd', matchedBrand: { id: 'brand-123', name: 'Harcourts Property Hub' } });
    expect(a.billingEntityKey).toBe(b.billingEntityKey);
  });

  it('falls back to normalised companyName when no brand matches', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const a = resolveBillingEntity({ agentUserId: 'u1', companyName: 'Acme' });
    const b = resolveBillingEntity({ agentUserId: 'u2', companyName: 'Acme' });
    expect(a.billingEntityKey).toBe(b.billingEntityKey);
    expect(a.agencyBrandId).toBeNull();
  });
});

describe('resolveAgencyBrand', () => {
  it('returns the brand pointed to by agencyBrandId when it exists', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-123').set({ name: 'Harcourts Property Hub', status: 'active' });
    const result = await resolveAgencyBrand({ agencyBrandId: 'brand-123', companyName: 'something else entirely' });
    expect(result).toEqual({ id: 'brand-123', name: 'Harcourts Property Hub' });
  });

  it('falls back to an exact companyName match when agencyBrandId is not set', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-123').set({ name: 'Harcourts Property Hub', status: 'active' });
    const result = await resolveAgencyBrand({ companyName: 'harcourts property hub ' }); // no agencyBrandId, differs only by case/whitespace
    expect(result).toEqual({ id: 'brand-123', name: 'Harcourts Property Hub' });
  });

  it('falls through to companyName matching if agencyBrandId points at a brand that no longer exists', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-456').set({ name: 'Ray White', status: 'active' });
    const result = await resolveAgencyBrand({ agencyBrandId: 'deleted-brand', companyName: 'Ray White' });
    expect(result).toEqual({ id: 'brand-456', name: 'Ray White' });
  });

  it('returns null when neither agencyBrandId nor companyName matches any brand', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    const result = await resolveAgencyBrand({ companyName: 'Some Agency With No Brand' });
    expect(result).toBeNull();
  });

  it('never writes to agencyBrandId or the brand itself — purely read-only', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-123').set({ name: 'Harcourts Property Hub', status: 'active' });
    const before = JSON.stringify(fakeDb._store.agencyBrands);
    await resolveAgencyBrand({ companyName: 'Harcourts Property Hub' });
    expect(JSON.stringify(fakeDb._store.agencyBrands)).toBe(before);
    expect(fakeDb._store.users || {}).toEqual({});
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

  it('charges $0 GST at gstRate 0 (Premarket is not GST registered)', async () => {
    const { computeChargeAmounts } = await import('../../src/app/api/services/billingService.js');
    const result = computeChargeAmounts(200, 0);
    expect(result.totalInc).toBe(200);
    expect(result.subtotalEx).toBe(200);
    expect(result.gstAmount).toBe(0);
  });
});

describe('DEFAULT_GST_RATE', () => {
  it('defaults to 0 — not GST registered — so a missing settings doc never charges GST', async () => {
    const { DEFAULT_GST_RATE } = await import('../../src/app/api/services/billingService.js');
    expect(DEFAULT_GST_RATE).toBe(0);
  });

  it('getInvoicingSettings falls back to gstRate 0 when settings/invoicing has no doc', async () => {
    const { getInvoicingSettings } = await import('../../src/app/api/services/billingService.js');
    const settings = await getInvoicingSettings();
    expect(settings.gstRate).toBe(0);
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

describe('createPropertyAndChargeAtomically', () => {
  async function setup() {
    const svc = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts Property Hub', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [] });
    return svc;
  }

  it('creates both the property and its charge together', async () => {
    const { createPropertyAndChargeAtomically } = await setup();
    const result = await createPropertyAndChargeAtomically({ userId: 'agent1', address: '1 Test St' });

    expect(result.charged).toBe(true);
    const prop = await fakeDb.collection('properties').doc(result.propertyId).get();
    const charge = await fakeDb.collection('propertyCharges').doc(result.propertyId).get();
    expect(prop.exists).toBe(true);
    expect(charge.exists).toBe(true);
    expect(charge.data().propertyId).toBe(result.propertyId);
    expect(charge.data().status).toBe('pending');
  });

  it('rolls back the property too if the transaction throws partway through (atomicity, not just "best effort")', async () => {
    const { createPropertyAndChargeAtomically } = await setup();

    // Force the transaction itself to fail after both writes are
    // queued but before anything commits, by making runTransaction's
    // updateFn throw — simulates e.g. a Firestore contention error.
    const originalRunTransaction = fakeDb.runTransaction;
    fakeDb.runTransaction = async (updateFn) => {
      const tx = { set: () => {}, get: async () => ({ exists: false }) };
      await updateFn(tx); // queued writes are discarded — tx.set above is a no-op stub
      throw new Error('Simulated transaction failure');
    };

    await expect(createPropertyAndChargeAtomically({ userId: 'agent1', address: '1 Test St' })).rejects.toThrow('Simulated transaction failure');

    // Nothing committed at all — not a property with no charge, not
    // a charge with no property. Either both exist or neither does.
    const allProps = await fakeDb.collection('properties').get();
    const allCharges = await fakeDb.collection('propertyCharges').get();
    expect(allProps.docs.length).toBe(0);
    expect(allCharges.docs.length).toBe(0);

    fakeDb.runTransaction = originalRunTransaction;
  });

  it('creates the property without a charge when skipCharge is true (demo-mode imports)', async () => {
    const { createPropertyAndChargeAtomically } = await setup();
    const result = await createPropertyAndChargeAtomically({ userId: 'agent1', address: '1 Test St' }, { skipCharge: true });

    expect(result.charged).toBe(false);
    const prop = await fakeDb.collection('properties').doc(result.propertyId).get();
    const charge = await fakeDb.collection('propertyCharges').doc(result.propertyId).get();
    expect(prop.exists).toBe(true);
    expect(charge.exists).toBe(false);
  });

  it('creates the property without a charge when there is no agent userId at all, without throwing', async () => {
    const { createPropertyAndChargeAtomically } = await setup();
    const result = await createPropertyAndChargeAtomically({ address: '1 Test St' });

    expect(result.charged).toBe(false);
    const prop = await fakeDb.collection('properties').doc(result.propertyId).get();
    expect(prop.exists).toBe(true);
  });

  it('never needs an idempotency check — the property id is always freshly generated, so there is nothing to race against', async () => {
    const { createPropertyAndChargeAtomically } = await setup();
    const a = await createPropertyAndChargeAtomically({ userId: 'agent1', address: '1 A St' });
    const b = await createPropertyAndChargeAtomically({ userId: 'agent1', address: '2 B St' });
    expect(a.propertyId).not.toBe(b.propertyId);
    const all = await fakeDb.collection('propertyCharges').get();
    expect(all.docs.length).toBe(2);
  });
});

describe('namesLikelySameAgency (pure)', () => {
  it('flags one name as a likely duplicate when it is wholly contained in the other', async () => {
    const { namesLikelySameAgency } = await import('../../src/app/api/services/billingService.js');
    expect(namesLikelySameAgency('Harcourts', 'Harcourts Property Hub')).toBe(true);
    expect(namesLikelySameAgency('Harcourts Property Hub', 'harcourts')).toBe(true); // case-insensitive
  });

  it('flags two names sharing a distinctive first word', async () => {
    const { namesLikelySameAgency } = await import('../../src/app/api/services/billingService.js');
    expect(namesLikelySameAgency('Harcourts Prop Hub', 'Harcourts Pty Ltd')).toBe(true);
  });

  it('does not flag two genuinely unrelated names', async () => {
    const { namesLikelySameAgency } = await import('../../src/app/api/services/billingService.js');
    expect(namesLikelySameAgency('Ray White', 'LJ Hooker')).toBe(false);
  });

  it('does not flag two already-identical (normalised) names — that is not this function\'s job', async () => {
    const { namesLikelySameAgency } = await import('../../src/app/api/services/billingService.js');
    expect(namesLikelySameAgency('Harcourts Property Hub', 'harcourts property hub ')).toBe(false);
  });

  it('known limitation: an abbreviation with no shared prefix or substring is not caught', async () => {
    const { namesLikelySameAgency } = await import('../../src/app/api/services/billingService.js');
    expect(namesLikelySameAgency('HPH', 'Harcourts Property Hub')).toBe(false);
  });

  it('is false for empty/missing names rather than throwing', async () => {
    const { namesLikelySameAgency } = await import('../../src/app/api/services/billingService.js');
    expect(namesLikelySameAgency('', 'Harcourts')).toBe(false);
    expect(namesLikelySameAgency(null, undefined)).toBe(false);
  });
});

describe('resolveBillingOverride / mergeIntoBillingEntity', () => {
  it('returns null when no override exists', async () => {
    const { resolveBillingOverride } = await import('../../src/app/api/services/billingService.js');
    expect(await resolveBillingOverride('agent1')).toBeNull();
  });

  it('mergeIntoBillingEntity writes an override for every given agent, with a required reason and admin recorded', async () => {
    const { mergeIntoBillingEntity, resolveBillingOverride } = await import('../../src/app/api/services/billingService.js');
    const result = await mergeIntoBillingEntity({
      agentUserIds: ['agent1', 'agent2'],
      targetBillingEntityKey: 'agency:harcourts property hub',
      targetBillingEntityName: 'Harcourts Property Hub',
      adminUid: 'admin1',
      reason: 'Same agency, different spelling',
    });
    expect(result.merged).toBe(2);

    const override1 = await resolveBillingOverride('agent1');
    expect(override1.billingEntityKey).toBe('agency:harcourts property hub');
    expect(override1.billingEntityName).toBe('Harcourts Property Hub');

    expect(fakeDb._store.billingAgencyOverrides.agent1.setBy).toBe('admin1');
    expect(fakeDb._store.billingAgencyOverrides.agent1.reason).toBe('Same agency, different spelling');
  });

  it('rejects a merge with no agentUserIds or no target entity', async () => {
    const { mergeIntoBillingEntity } = await import('../../src/app/api/services/billingService.js');
    await expect(mergeIntoBillingEntity({ agentUserIds: [], targetBillingEntityKey: 'x', targetBillingEntityName: 'X', adminUid: 'a', reason: 'r' })).rejects.toThrow();
    await expect(mergeIntoBillingEntity({ agentUserIds: ['agent1'], targetBillingEntityKey: '', targetBillingEntityName: '', adminUid: 'a', reason: 'r' })).rejects.toThrow();
  });

  it('an override takes priority over brand/companyName resolution in an actual charge', async () => {
    const { recordPropertyCharge, mergeIntoBillingEntity } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'HPH', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [] });

    await mergeIntoBillingEntity({
      agentUserIds: ['agent1'],
      targetBillingEntityKey: 'agency:harcourts property hub',
      targetBillingEntityName: 'Harcourts Property Hub',
      adminUid: 'admin1',
      reason: 'Confirmed same agency',
    });

    await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St' });
    const charge = await fakeDb.collection('propertyCharges').doc('prop1').get();
    expect(charge.data().billingEntityKey).toBe('agency:harcourts property hub');
    expect(charge.data().billingEntityName).toBe('Harcourts Property Hub');
  });
});

describe('findPossibleDuplicateAgencies', () => {
  it('flags two agency groups with similar names as a possible duplicate pair', async () => {
    const { findPossibleDuplicateAgencies } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ roles: ['agent'], companyName: 'Harcourts', firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('users').doc('agent2').set({ roles: ['agent'], companyName: 'Harcourts Property Hub', firstName: 'Max', lastName: 'Tan' });

    const pairs = await findPossibleDuplicateAgencies();
    expect(pairs.length).toBe(1);
    const names = [pairs[0].groupA.billingEntityName, pairs[0].groupB.billingEntityName];
    expect(names).toContain('Harcourts');
    expect(names).toContain('Harcourts Property Hub');
  });

  it('does not flag agents who already consolidate via an exact companyName match', async () => {
    const { findPossibleDuplicateAgencies } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ roles: ['agent'], companyName: 'Ray White', firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('users').doc('agent2').set({ roles: ['agent'], companyName: 'ray white', firstName: 'Max', lastName: 'Tan' });

    const pairs = await findPossibleDuplicateAgencies();
    expect(pairs.length).toBe(0);
  });

  it('does not flag two genuinely unrelated agencies', async () => {
    const { findPossibleDuplicateAgencies } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ roles: ['agent'], companyName: 'Ray White', firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('users').doc('agent2').set({ roles: ['agent'], companyName: 'LJ Hooker', firstName: 'Max', lastName: 'Tan' });

    const pairs = await findPossibleDuplicateAgencies();
    expect(pairs.length).toBe(0);
  });

  it('ignores independent agents (no companyName) entirely', async () => {
    const { findPossibleDuplicateAgencies } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ roles: ['agent'], firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('users').doc('agent2').set({ roles: ['agent'], firstName: 'Max', lastName: 'Tan' });

    const pairs = await findPossibleDuplicateAgencies();
    expect(pairs.length).toBe(0);
  });

  it('a pair already merged via an admin override no longer appears as a duplicate', async () => {
    const { findPossibleDuplicateAgencies, mergeIntoBillingEntity } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ roles: ['agent'], companyName: 'Harcourts', firstName: 'Jo', lastName: 'Lee' });
    fakeDb.collection('users').doc('agent2').set({ roles: ['agent'], companyName: 'Harcourts Property Hub', firstName: 'Max', lastName: 'Tan' });

    const before = await findPossibleDuplicateAgencies();
    expect(before.length).toBe(1);

    await mergeIntoBillingEntity({
      agentUserIds: ['agent1'],
      targetBillingEntityKey: 'agency:harcourts property hub',
      targetBillingEntityName: 'Harcourts Property Hub',
      adminUid: 'admin1',
      reason: 'Confirmed duplicate',
    });

    const after = await findPossibleDuplicateAgencies();
    expect(after.length).toBe(0);
  });
});
