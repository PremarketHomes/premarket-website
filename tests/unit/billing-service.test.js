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
        function matches(raw, f, o, v) {
          if (o === '==') return raw[f] === v;
          if (o === 'array-contains') return Array.isArray(raw[f]) && raw[f].includes(v);
          return true;
        }
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
          ref: { update: async (patch) => { store[name][id] = { ...(store[name][id] || {}), ...patch }; } },
        }));
        return makeQuery(all.filter((d) => matches(d._raw, field, op, value)));
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
  it('SECURITY: companyName alone, with no verified brand, is billed as independent — never silently grouped by name text', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const a = resolveBillingEntity({ agentUserId: 'u1', companyName: 'Harcourts Property Hub ' });
    const b = resolveBillingEntity({ agentUserId: 'u2', companyName: ' harcourts property hub' });
    expect(a.billingEntityType).toBe('independent');
    expect(b.billingEntityType).toBe('independent');
    // Different agents, different keys — this is the exact fix: two
    // unrelated accounts sharing a company name string must never be
    // folded into one billing identity.
    expect(a.billingEntityKey).not.toBe(b.billingEntityKey);
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

  it('no brand at all (not even pending) never creates a shared agency key from companyName', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const a = resolveBillingEntity({ agentUserId: 'u1', companyName: 'Acme' });
    const b = resolveBillingEntity({ agentUserId: 'u2', companyName: 'Acme' });
    expect(a.billingEntityType).toBe('independent');
    expect(a.billingEntityKey).not.toBe(b.billingEntityKey);
    expect(a.agencyBrandId).toBeNull();
    expect(a.pendingAgencyName).toBeUndefined(); // no claimed brand relationship to flag at all
  });

  it('flags a claimed-but-unverified agency membership for admin visibility, without affecting the billing key or type', async () => {
    const { resolveBillingEntity } = await import('../../src/app/api/services/billingService.js');
    const result = resolveBillingEntity({ agentUserId: 'u1', companyName: 'Harcourts Property Hub', matchedBrand: null, pendingAgencyName: 'Harcourts Property Hub' });
    expect(result.billingEntityType).toBe('independent');
    expect(result.billingEntityKey).toBe('agent:u1');
    expect(result.pendingAgencyName).toBe('Harcourts Property Hub');
  });
});

describe('resolveAgencyBrand', () => {
  it('returns verified when the agent is the brand\'s own creator — no separate membership record needed', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-123').set({ name: 'Harcourts Property Hub', status: 'active', createdBy: 'agent1' });
    const result = await resolveAgencyBrand({ agencyBrandId: 'brand-123' }, 'agent1');
    expect(result.verified).toEqual({ id: 'brand-123', name: 'Harcourts Property Hub' });
    expect(result.pending).toBeNull();
  });

  it('returns verified for a non-creator with an explicit verified agencyMemberships record for that exact brand', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-123').set({ name: 'Harcourts Property Hub', status: 'active', createdBy: 'agent1' });
    fakeDb.collection('agencyMemberships').doc('agent2').set({ uid: 'agent2', agencyBrandId: 'brand-123', status: 'verified' });
    const result = await resolveAgencyBrand({ agencyBrandId: 'brand-123' }, 'agent2');
    expect(result.verified).toEqual({ id: 'brand-123', name: 'Harcourts Property Hub' });
  });

  it('SECURITY: agencyBrandId set with NO membership record at all is NOT verified — returned as pending, never usable for billing', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-123').set({ name: 'Harcourts Property Hub', status: 'active', createdBy: 'agent1' });
    const result = await resolveAgencyBrand({ agencyBrandId: 'brand-123' }, 'agent2');
    expect(result.verified).toBeNull();
    expect(result.pending).toEqual({ id: 'brand-123', name: 'Harcourts Property Hub' });
  });

  it('SECURITY: a rejected membership is not verified either', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-123').set({ name: 'Harcourts Property Hub', status: 'active', createdBy: 'agent1' });
    fakeDb.collection('agencyMemberships').doc('agent2').set({ uid: 'agent2', agencyBrandId: 'brand-123', status: 'rejected' });
    const result = await resolveAgencyBrand({ agencyBrandId: 'brand-123' }, 'agent2');
    expect(result.verified).toBeNull();
  });

  it('SECURITY: companyName matching an existing brand\'s name, with no agencyBrandId at all, is never trusted — this was the exact self-escalation path that got fixed', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-123').set({ name: 'Harcourts Property Hub', status: 'active', createdBy: 'agent1' });
    const result = await resolveAgencyBrand({ companyName: 'Harcourts Property Hub' }, 'agent2'); // no agencyBrandId
    expect(result.verified).toBeNull();
    expect(result.pending).toBeNull(); // not even flagged as pending — they never claimed anything
  });

  it('returns nothing for a dangling agencyBrandId pointing at a deleted brand', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    const result = await resolveAgencyBrand({ agencyBrandId: 'deleted-brand', companyName: 'Ray White' }, 'agent2');
    expect(result.verified).toBeNull();
    expect(result.pending).toBeNull();
  });

  it('never writes to agencyBrandId, the brand, or any membership record — purely read-only', async () => {
    const { resolveAgencyBrand } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('agencyBrands').doc('brand-123').set({ name: 'Harcourts Property Hub', status: 'active', createdBy: 'agent1' });
    const beforeBrands = JSON.stringify(fakeDb._store.agencyBrands);
    await resolveAgencyBrand({ agencyBrandId: 'brand-123' }, 'agent2');
    expect(JSON.stringify(fakeDb._store.agencyBrands)).toBe(beforeBrands);
    expect(fakeDb._store.agencyMemberships || {}).toEqual({});
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

// Fixed, safely-in-the-past activation instant used throughout this
// file's pre-existing tests (all about charge-creation mechanics, not
// the go-live cutoff itself) so a property "created now" is billable
// by default — see the dedicated `isPropertyBillable` / billing
// go-live describe blocks below for the cutoff behaviour itself.
const BILLING_ACTIVATED = new Date('2020-01-01');

describe('recordPropertyCharge', () => {
  async function setup() {
    const svc = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts Property Hub', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: BILLING_ACTIVATED });
    return svc;
  }

  it('creates exactly one charge for a new property — billed independently, since agent1 has a companyName but no verified brand', async () => {
    const { recordPropertyCharge } = await setup();
    const result = await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St', createdAt: new Date() });
    expect(result.created).toBe(true);
    const doc = await fakeDb.collection('propertyCharges').doc('prop1').get();
    expect(doc.exists).toBe(true);
    expect(doc.data().status).toBe('pending');
    expect(doc.data().billingEntityType).toBe('independent');
    expect(doc.data().billingEntityName).toBe('Jo Lee');
    expect(doc.data().totalInc).toBe(200);
  });

  it('is idempotent — calling it again for the same property is a safe no-op', async () => {
    const { recordPropertyCharge } = await setup();
    await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St', createdAt: new Date() });
    const second = await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St', createdAt: new Date() });
    expect(second.created).toBe(false);
    expect(second.reason).toBe('already-recorded');

    // Still exactly one charge document, not two.
    const all = await fakeDb.collection('propertyCharges').get();
    expect(all.docs.length).toBe(1);
  });

  it('survives a .create() race (two near-simultaneous calls) without creating two charges or throwing', async () => {
    const { recordPropertyCharge } = await setup();
    const [a, b] = await Promise.all([
      recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St', createdAt: new Date() }),
      recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St', createdAt: new Date() }),
    ]);
    const createdCount = [a, b].filter((r) => r.created).length;
    expect(createdCount).toBe(1);
    const all = await fakeDb.collection('propertyCharges').get();
    expect(all.docs.length).toBe(1);
  });

  it('snapshots the price/GST in force at the time it is called, not a later value', async () => {
    const { recordPropertyCharge } = await setup();
    await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St', createdAt: new Date() });

    // Price changes after the charge was recorded.
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 350, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: BILLING_ACTIVATED });

    const doc = await fakeDb.collection('propertyCharges').doc('prop1').get();
    expect(doc.data().pricePerListing).toBe(200);
    expect(doc.data().totalInc).toBe(200);
  });

  it('skips an agent on the exclusion list, recording no charge', async () => {
    const { recordPropertyCharge } = await setup();
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: ['agent1'], billingActivatedAt: BILLING_ACTIVATED });
    const result = await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St', createdAt: new Date() });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('not-billable');
    const doc = await fakeDb.collection('propertyCharges').doc('prop1').get();
    expect(doc.exists).toBe(false);
  });

  it('skips gracefully (no throw) when the property has no agent userId', async () => {
    const { recordPropertyCharge } = await setup();
    const result = await recordPropertyCharge({ id: 'prop1', address: '1 Test St', createdAt: new Date() });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('no-agent');
  });

  it('SECURITY: two agents merely sharing a companyName (no verified brand) are billed SEPARATELY — never grouped by name text alone', async () => {
    const { recordPropertyCharge } = await setup();
    fakeDb.collection('users').doc('agent2').set({ firstName: 'Max', lastName: 'Tan', companyName: 'harcourts property hub', email: 'max@example.com' });

    await recordPropertyCharge({ id: 'propA', userId: 'agent1', address: '1 A St', createdAt: new Date() });
    await recordPropertyCharge({ id: 'propB', userId: 'agent2', address: '2 B St', createdAt: new Date() });

    const docA = await fakeDb.collection('propertyCharges').doc('propA').get();
    const docB = await fakeDb.collection('propertyCharges').doc('propB').get();
    expect(docA.data().billingEntityKey).not.toBe(docB.data().billingEntityKey);
    expect(docB.data().billingEntityType).toBe('independent');
  });

  it('two VERIFIED members of the same real brand correctly group under one billing entity', async () => {
    const { recordPropertyCharge } = await setup();
    fakeDb.collection('agencyBrands').doc('brand-hph').set({ name: 'Harcourts Property Hub', status: 'active', createdBy: 'agent1' });
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts Property Hub', email: 'jo@example.com', agencyBrandId: 'brand-hph' });
    fakeDb.collection('users').doc('agent2').set({ firstName: 'Max', lastName: 'Tan', companyName: 'Harcourts Property Hub', email: 'max@example.com', agencyBrandId: 'brand-hph' });
    fakeDb.collection('agencyMemberships').doc('agent2').set({ uid: 'agent2', agencyBrandId: 'brand-hph', status: 'verified', verifiedBy: 'admin1' });

    await recordPropertyCharge({ id: 'propA', userId: 'agent1', address: '1 A St', createdAt: new Date() });
    await recordPropertyCharge({ id: 'propB', userId: 'agent2', address: '2 B St', createdAt: new Date() });

    const docA = await fakeDb.collection('propertyCharges').doc('propA').get();
    const docB = await fakeDb.collection('propertyCharges').doc('propB').get();
    expect(docA.data().billingEntityKey).toBe('brand:brand-hph');
    expect(docB.data().billingEntityKey).toBe('brand:brand-hph');
  });

  it('an agent whose agencyBrandId is set but NOT yet verified is billed independently, flagged for admin review — never merged with the agency', async () => {
    const { recordPropertyCharge } = await setup();
    fakeDb.collection('agencyBrands').doc('brand-hph').set({ name: 'Harcourts Property Hub', status: 'active', createdBy: 'agent1' });
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts Property Hub', email: 'jo@example.com', agencyBrandId: 'brand-hph' });
    // agent2 has the agencyBrandId set (e.g. requested to join) but no verified membership record yet.
    fakeDb.collection('users').doc('agent2').set({ firstName: 'Max', lastName: 'Tan', companyName: 'Harcourts Property Hub', email: 'max@example.com', agencyBrandId: 'brand-hph' });

    await recordPropertyCharge({ id: 'propA', userId: 'agent1', address: '1 A St', createdAt: new Date() });
    await recordPropertyCharge({ id: 'propB', userId: 'agent2', address: '2 B St', createdAt: new Date() });

    const docA = await fakeDb.collection('propertyCharges').doc('propA').get();
    const docB = await fakeDb.collection('propertyCharges').doc('propB').get();
    expect(docA.data().billingEntityKey).toBe('brand:brand-hph');
    expect(docB.data().billingEntityKey).not.toBe('brand:brand-hph');
    expect(docB.data().billingEntityType).toBe('independent');
    expect(docB.data().pendingAgencyName).toBe('Harcourts Property Hub'); // flagged for admin resolution
  });

  describe('agency billing identity stays pinned to legacy history, never freshly re-derived from companyName (Priority 2 fix, updated for verified membership)', () => {
    it('a pre-existing legacy agency-keyed charge (predating verified membership) continues to pin an agent\'s future charges', async () => {
      const { recordPropertyCharge } = await setup();
      // Simulates a charge recorded under the OLD companyName-fallback
      // system, before verified membership existed — never
      // retroactively touched by this fix (see requirement to never
      // auto-migrate existing charges/entities).
      fakeDb.collection('propertyCharges').doc('legacyProp').set({
        agentUserId: 'agent1', propertyId: 'legacyProp',
        billingEntityType: 'agency', billingEntityKey: 'agency:harcourts property hub',
        billingEntityName: 'Harcourts Property Hub', agencyBrandId: null,
      });

      await recordPropertyCharge({ id: 'propB', userId: 'agent1', address: '2 B St', createdAt: new Date() });
      const doc = await fakeDb.collection('propertyCharges').doc('propB').get();

      expect(doc.data().billingEntityKey).toBe('agency:harcourts property hub');
      expect(doc.data().billingEntityType).toBe('agency');
    });

    it('a real, verified brand still takes priority over pinned legacy history — an agent can still legitimately upgrade — and the historical charge is never rewritten', async () => {
      const { recordPropertyCharge } = await setup();
      fakeDb.collection('propertyCharges').doc('legacyProp').set({
        agentUserId: 'agent1', propertyId: 'legacyProp',
        billingEntityType: 'agency', billingEntityKey: 'agency:harcourts property hub',
        billingEntityName: 'Harcourts Property Hub', agencyBrandId: null,
      });

      fakeDb.collection('agencyBrands').doc('brand1').set({ name: 'Harcourts Property Hub (Verified)', createdBy: 'agent1' });
      fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts Property Hub', email: 'jo@example.com', agencyBrandId: 'brand1' });

      await recordPropertyCharge({ id: 'propB', userId: 'agent1', address: '2 B St', createdAt: new Date() });
      const doc = await fakeDb.collection('propertyCharges').doc('propB').get();
      expect(doc.data().billingEntityKey).toBe('brand:brand1');
      expect(doc.data().agencyBrandId).toBe('brand1');

      // The historical (legacy) charge must never be retroactively
      // rewritten onto the new brand-based entity.
      const historicalAfter = await fakeDb.collection('propertyCharges').doc('legacyProp').get();
      expect(historicalAfter.data().billingEntityKey).toBe('agency:harcourts property hub');
      expect(historicalAfter.data().billingEntityKey).not.toBe('brand:brand1');
    });

    it('switching from one VERIFIED brand to another VERIFIED brand (a genuine agency transfer) only redirects FUTURE charges — history for both stays correct', async () => {
      const { recordPropertyCharge } = await setup();
      fakeDb.collection('agencyBrands').doc('brandOld').set({ name: 'Harcourts Property Hub', createdBy: 'agent1' });
      fakeDb.collection('agencyBrands').doc('brandNew').set({ name: 'Ray White Coastal', createdBy: 'agent9' });
      fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts Property Hub', email: 'jo@example.com', agencyBrandId: 'brandOld' });

      await recordPropertyCharge({ id: 'propOld', userId: 'agent1', address: '1 Old St', createdAt: new Date() });
      const oldChargeKeyBefore = (await fakeDb.collection('propertyCharges').doc('propOld').get()).data().billingEntityKey;
      expect(oldChargeKeyBefore).toBe('brand:brandOld');

      // Agent genuinely transfers — the NEW brand must ALSO verify them
      // (a bare agencyBrandId switch is not enough on its own, exactly
      // the point of this fix: a superAdmin confirms the transfer).
      fakeDb.collection('agencyMemberships').doc('agent1').set({ uid: 'agent1', agencyBrandId: 'brandNew', status: 'verified', verifiedBy: 'admin1' });
      fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Ray White Coastal', email: 'jo@example.com', agencyBrandId: 'brandNew' });
      await recordPropertyCharge({ id: 'propNew', userId: 'agent1', address: '2 New St', createdAt: new Date() });

      const oldChargeAfter = await fakeDb.collection('propertyCharges').doc('propOld').get();
      const newCharge = await fakeDb.collection('propertyCharges').doc('propNew').get();

      // Old charge still correctly billed to the OLD agency — untouched.
      expect(oldChargeAfter.data().billingEntityKey).toBe('brand:brandOld');
      expect(newCharge.data().billingEntityKey).toBe('brand:brandNew');
    });

    it('an admin override still takes priority over pinned history', async () => {
      const { recordPropertyCharge, mergeIntoBillingEntity } = await setup();
      await recordPropertyCharge({ id: 'propA', userId: 'agent1', address: '1 A St', createdAt: new Date() });

      await mergeIntoBillingEntity({
        agentUserIds: ['agent1'],
        targetBillingEntityKey: 'agency:some-other-entity',
        targetBillingEntityName: 'Some Other Entity',
        adminUid: 'admin1',
        reason: 'admin-confirmed duplicate',
      });

      await recordPropertyCharge({ id: 'propB', userId: 'agent1', address: '2 B St', createdAt: new Date() });
      const doc = await fakeDb.collection('propertyCharges').doc('propB').get();
      expect(doc.data().billingEntityKey).toBe('agency:some-other-entity');
    });

    it('a brand-new agent with no prior charges and no verified brand resolves fresh as independent, billed under their own name', async () => {
      const { recordPropertyCharge } = await setup();
      fakeDb.collection('users').doc('agent2').set({ firstName: 'New', lastName: 'Agent', companyName: 'Never Charged Before Realty', email: 'new@example.com' });
      await recordPropertyCharge({ id: 'propZ', userId: 'agent2', address: '1 Z St', createdAt: new Date() });
      const doc = await fakeDb.collection('propertyCharges').doc('propZ').get();
      expect(doc.data().billingEntityType).toBe('independent');
      expect(doc.data().billingEntityName).toBe('New Agent');
    });
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
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: BILLING_ACTIVATED });
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
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: BILLING_ACTIVATED });

    await mergeIntoBillingEntity({
      agentUserIds: ['agent1'],
      targetBillingEntityKey: 'agency:harcourts property hub',
      targetBillingEntityName: 'Harcourts Property Hub',
      adminUid: 'admin1',
      reason: 'Confirmed same agency',
    });

    await recordPropertyCharge({ id: 'prop1', userId: 'agent1', address: '1 Test St', createdAt: new Date() });
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

describe('isPropertyBillable (pure)', () => {
  it('is false when billing has never been activated, regardless of how recent the property is', async () => {
    const { isPropertyBillable } = await import('../../src/app/api/services/billingService.js');
    expect(isPropertyBillable(new Date(), null)).toBe(false);
    expect(isPropertyBillable(new Date(), undefined)).toBe(false);
  });

  it('is false for a property created before activation (historical)', async () => {
    const { isPropertyBillable } = await import('../../src/app/api/services/billingService.js');
    const activatedAt = new Date('2026-06-01');
    const createdAt = new Date('2026-01-01');
    expect(isPropertyBillable(createdAt, activatedAt)).toBe(false);
  });

  it('is true for a property created on or after activation', async () => {
    const { isPropertyBillable } = await import('../../src/app/api/services/billingService.js');
    const activatedAt = new Date('2026-06-01T00:00:00Z');
    expect(isPropertyBillable(new Date('2026-06-01T00:00:00Z'), activatedAt)).toBe(true);
    expect(isPropertyBillable(new Date('2026-07-01'), activatedAt)).toBe(true);
  });

  it('is false when the property has no usable createdAt at all — never guesses yes', async () => {
    const { isPropertyBillable } = await import('../../src/app/api/services/billingService.js');
    expect(isPropertyBillable(null, new Date('2020-01-01'))).toBe(false);
    expect(isPropertyBillable(undefined, new Date('2020-01-01'))).toBe(false);
  });

  it('handles a Firestore-shaped {_seconds} timestamp the same as a real Date', async () => {
    const { isPropertyBillable } = await import('../../src/app/api/services/billingService.js');
    const activatedAt = new Date('2026-06-01');
    const createdAtSeconds = { _seconds: Math.floor(new Date('2026-07-01').getTime() / 1000) };
    expect(isPropertyBillable(createdAtSeconds, activatedAt)).toBe(true);
  });
});

describe('billing go-live cutoff — every charge-creation pathway respects it', () => {
  it('recordPropertyCharge never charges a historical property, even though everything else about it is valid', async () => {
    const { recordPropertyCharge } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({
      pricePerListing: 200, gstRate: 0, excludeAgentIds: [],
      billingActivatedAt: new Date('2026-06-01'),
    });

    const result = await recordPropertyCharge({ id: 'old-prop', userId: 'agent1', address: '1 Old St', createdAt: new Date('2026-01-01') });

    expect(result.created).toBe(false);
    expect(result.reason).toBe('not-billable');
    const doc = await fakeDb.collection('propertyCharges').doc('old-prop').get();
    expect(doc.exists).toBe(false);
  });

  it('recordPropertyCharge charges a property created after activation', async () => {
    const { recordPropertyCharge } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({
      pricePerListing: 200, gstRate: 0, excludeAgentIds: [],
      billingActivatedAt: new Date('2026-06-01'),
    });

    const result = await recordPropertyCharge({ id: 'new-prop', userId: 'agent1', address: '1 New St', createdAt: new Date('2026-07-01') });

    expect(result.created).toBe(true);
    const doc = await fakeDb.collection('propertyCharges').doc('new-prop').get();
    expect(doc.exists).toBe(true);
  });

  it('billing defaults OFF: no charge is ever created while billingActivatedAt is unset, however new the property is', async () => {
    const { recordPropertyCharge } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0, excludeAgentIds: [] }); // no billingActivatedAt at all

    const result = await recordPropertyCharge({ id: 'brand-new', userId: 'agent1', address: '1 New St', createdAt: new Date() });

    expect(result.created).toBe(false);
    expect(result.reason).toBe('not-billable');
  });

  it('createPropertyAndChargeAtomically (SMS/AgentBox/Rex path) never charges while billing is off', async () => {
    const { createPropertyAndChargeAtomically } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0, excludeAgentIds: [] }); // off

    const result = await createPropertyAndChargeAtomically({ userId: 'agent1', address: '1 New St' });

    expect(result.charged).toBe(false);
    const prop = await fakeDb.collection('properties').doc(result.propertyId).get();
    const charge = await fakeDb.collection('propertyCharges').doc(result.propertyId).get();
    expect(prop.exists).toBe(true); // property still created normally
    expect(charge.exists).toBe(false);
  });

  it('createPropertyAndChargeAtomically charges normally once billing is activated (property is being created "now", which is after any past activation)', async () => {
    const { createPropertyAndChargeAtomically } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({
      pricePerListing: 200, gstRate: 0, excludeAgentIds: [],
      billingActivatedAt: new Date('2020-01-01'),
    });

    const result = await createPropertyAndChargeAtomically({ userId: 'agent1', address: '1 New St' });
    expect(result.charged).toBe(true);
  });

  it('ensureChargesForProperties (the reconciliation sweep) skips historical properties and only charges post-activation ones — the exact "don\'t backfill history" guarantee', async () => {
    const { ensureChargesForProperties } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({
      pricePerListing: 200, gstRate: 0, excludeAgentIds: [],
      billingActivatedAt: new Date('2026-06-01'),
    });

    const properties = [
      { id: 'historical-1', userId: 'agent1', address: '1 Old St', createdAt: new Date('2024-01-01') },
      { id: 'historical-2', userId: 'agent1', address: '2 Old St', createdAt: new Date('2026-05-31') }, // one day before cutoff
      { id: 'new-1', userId: 'agent1', address: '1 New St', createdAt: new Date('2026-06-02') },
    ];

    const result = await ensureChargesForProperties(properties);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
    expect((await fakeDb.collection('propertyCharges').doc('historical-1').get()).exists).toBe(false);
    expect((await fakeDb.collection('propertyCharges').doc('historical-2').get()).exists).toBe(false);
    expect((await fakeDb.collection('propertyCharges').doc('new-1').get()).exists).toBe(true);
  });

  it('reconcileMissingCharges (the hourly cron\'s own function) sweeps the whole properties collection but still only ever charges post-activation ones', async () => {
    const { reconcileMissingCharges } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('users').doc('agent1').set({ firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts', email: 'jo@example.com' });
    fakeDb.collection('settings').doc('invoicing').set({
      pricePerListing: 200, gstRate: 0, excludeAgentIds: [],
      billingActivatedAt: new Date('2026-06-01'),
    });
    fakeDb.collection('properties').doc('historical-1').set({ userId: 'agent1', address: '1 Old St', createdAt: new Date('2024-01-01') });
    fakeDb.collection('properties').doc('new-1').set({ userId: 'agent1', address: '1 New St', createdAt: new Date('2026-07-01') });

    const result = await reconcileMissingCharges();

    expect(result.created).toBe(1);
    expect((await fakeDb.collection('propertyCharges').doc('historical-1').get()).exists).toBe(false);
    expect((await fakeDb.collection('propertyCharges').doc('new-1').get()).exists).toBe(true);
  });

  it('reconcileMissingCharges never touches an existing charge\'s data, even an already-excluded/reversed one', async () => {
    const { reconcileMissingCharges } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('settings').doc('invoicing').set({
      pricePerListing: 200, gstRate: 0, excludeAgentIds: [],
      billingActivatedAt: new Date('2020-01-01'),
    });
    fakeDb.collection('properties').doc('prop1').set({ userId: 'agent1', address: '1 Test St', createdAt: new Date('2026-07-01') });
    const existingCharge = { propertyId: 'prop1', status: 'excluded', totalInc: 999, adjustment: { reason: 'test' } };
    fakeDb.collection('propertyCharges').doc('prop1').set(existingCharge);

    await reconcileMissingCharges();

    const doc = await fakeDb.collection('propertyCharges').doc('prop1').get();
    expect(doc.data()).toEqual(existingCharge); // byte-for-byte unchanged
  });
});

describe('getDueBillingEntityKeys (pure) — each agency on its own 30-day cycle', () => {
  it('is due once the OLDEST pending charge for that entity reaches 30 days old', async () => {
    const { getDueBillingEntityKeys } = await import('../../src/app/api/services/billingService.js');
    const now = new Date('2026-07-01');
    const charges = [
      { billingEntityKey: 'agency:a', createdAt: new Date('2026-06-01') }, // exactly 30 days
      { billingEntityKey: 'agency:b', createdAt: new Date('2026-06-15') }, // 16 days — not due
    ];
    expect(getDueBillingEntityKeys(charges, now)).toEqual(['agency:a']);
  });

  it('an entity with multiple charges is due based on its OLDEST one, not its newest', async () => {
    const { getDueBillingEntityKeys } = await import('../../src/app/api/services/billingService.js');
    const now = new Date('2026-07-01');
    const charges = [
      { billingEntityKey: 'agency:a', createdAt: new Date('2026-06-01') }, // 30 days — due
      { billingEntityKey: 'agency:a', createdAt: new Date('2026-06-28') }, // 3 days — but same entity
    ];
    expect(getDueBillingEntityKeys(charges, now)).toEqual(['agency:a']);
  });

  it('two different agencies become due independently, on their own cadence', async () => {
    const { getDueBillingEntityKeys } = await import('../../src/app/api/services/billingService.js');
    const now = new Date('2026-07-01');
    const charges = [
      { billingEntityKey: 'agency:a', createdAt: new Date('2026-06-01') }, // 30 days — due
      { billingEntityKey: 'agency:b', createdAt: new Date('2026-05-01') }, // 61 days — also due
      { billingEntityKey: 'agency:c', createdAt: new Date('2026-06-20') }, // 11 days — not due
    ];
    const due = getDueBillingEntityKeys(charges, now);
    expect(due.sort()).toEqual(['agency:a', 'agency:b']);
  });

  it('respects a custom cycle length', async () => {
    const { getDueBillingEntityKeys } = await import('../../src/app/api/services/billingService.js');
    const now = new Date('2026-07-01');
    const charges = [{ billingEntityKey: 'agency:a', createdAt: new Date('2026-06-25') }]; // 6 days
    expect(getDueBillingEntityKeys(charges, now, 30)).toEqual([]);
    expect(getDueBillingEntityKeys(charges, now, 5)).toEqual(['agency:a']);
  });

  it('is empty when nothing is pending', async () => {
    const { getDueBillingEntityKeys } = await import('../../src/app/api/services/billingService.js');
    expect(getDueBillingEntityKeys([], new Date())).toEqual([]);
  });

  it('ignores a charge with no usable createdAt rather than throwing', async () => {
    const { getDueBillingEntityKeys } = await import('../../src/app/api/services/billingService.js');
    const charges = [{ billingEntityKey: 'agency:a', createdAt: null }];
    expect(getDueBillingEntityKeys(charges, new Date())).toEqual([]);
  });
});

describe('resolveBillingContact / setBillingContact', () => {
  it('returns null when no contact has ever been designated', async () => {
    const { resolveBillingContact } = await import('../../src/app/api/services/billingService.js');
    expect(await resolveBillingContact('agency:harcourts')).toBeNull();
  });

  it('setBillingContact requires a valid email', async () => {
    const { setBillingContact } = await import('../../src/app/api/services/billingService.js');
    await expect(setBillingContact({ billingEntityKey: 'agency:a', name: 'Jo', email: '', adminUid: 'admin1' })).rejects.toThrow(/email/i);
    await expect(setBillingContact({ billingEntityKey: 'agency:a', name: 'Jo', email: 'not-an-email', adminUid: 'admin1' })).rejects.toThrow(/email/i);
  });

  it('setBillingContact requires a billingEntityKey', async () => {
    const { setBillingContact } = await import('../../src/app/api/services/billingService.js');
    await expect(setBillingContact({ billingEntityKey: '', name: 'Jo', email: 'jo@example.com', adminUid: 'admin1' })).rejects.toThrow(/billingEntityKey/i);
  });

  it('designates a contact, then resolveBillingContact returns it', async () => {
    const { setBillingContact, resolveBillingContact } = await import('../../src/app/api/services/billingService.js');
    await setBillingContact({ billingEntityKey: 'agency:a', name: 'Jo Lee', email: 'jo@example.com', adminUid: 'admin1' });
    const contact = await resolveBillingContact('agency:a');
    expect(contact).toEqual({ name: 'Jo Lee', email: 'jo@example.com', billingName: '' });
    expect(fakeDb._store.billingContacts['agency:a'].setBy).toBe('admin1');
    expect(fakeDb._store.billingContacts['agency:a'].status).toBe('confirmed');
  });

  it('updates any open (item-level pending) invoiceRunItems for this entity immediately', async () => {
    const { setBillingContact } = await import('../../src/app/api/services/billingService.js');
    fakeDb.collection('invoiceRunItems').doc('item1').set({ billingEntityKey: 'agency:a', status: 'pending', agentName: 'Old Name', agentEmail: 'old@example.com' });
    fakeDb.collection('invoiceRunItems').doc('item2').set({ billingEntityKey: 'agency:a', status: 'sent', agentName: 'Old Name', agentEmail: 'old@example.com' });
    fakeDb.collection('invoiceRunItems').doc('item3').set({ billingEntityKey: 'agency:b', status: 'pending', agentName: 'Unrelated', agentEmail: 'unrelated@example.com' });

    const result = await setBillingContact({ billingEntityKey: 'agency:a', name: 'New Contact', email: 'new@example.com', adminUid: 'admin1' });

    expect(result.updatedOpenItems).toBe(1);
    expect(fakeDb._store.invoiceRunItems.item1.agentEmail).toBe('new@example.com');
    expect(fakeDb._store.invoiceRunItems.item1.agentName).toBe('New Contact');
    // Already-sent item is financial history — untouched.
    expect(fakeDb._store.invoiceRunItems.item2.agentEmail).toBe('old@example.com');
    // A different agency's item is untouched.
    expect(fakeDb._store.invoiceRunItems.item3.agentEmail).toBe('unrelated@example.com');
  });
});
