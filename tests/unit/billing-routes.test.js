import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

const mockDisconnectXero = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  disconnectXero: (...args) => mockDisconnectXero(...args),
}));

function makeFakeDb() {
  const store = {};
  function col(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        return {
          id,
          _col: name,
          async get() {
            const data = store[name][id];
            return { exists: !!data, id, data: () => data };
          },
          async create(data) {
            if (store[name][id]) {
              const err = new Error('ALREADY_EXISTS');
              err.code = 6;
              throw err;
            }
            store[name][id] = { ...data };
          },
          async set(data, opts) {
            store[name][id] = opts?.merge ? { ...(store[name][id] || {}), ...data } : { ...data };
          },
          async update(patch) { store[name][id] = { ...(store[name][id] || {}), ...patch }; },
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
          };
        }
        const all = Object.entries(store[name]).map(([docId, data]) => ({
          id: docId,
          data: () => data,
          _raw: data,
          ref: { update: async (patch) => { store[name][docId] = { ...(store[name][docId] || {}), ...patch }; } },
        }));
        return makeQuery(all.filter((d) => matches(d._raw, field, op, value)));
      },
      async get() {
        const docs = Object.entries(store[name]).map(([docId, data]) => ({ id: docId, data: () => data }));
        return { docs, empty: docs.length === 0 };
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
      set: (ref, data) => pendingWrites.push(() => {
        store[ref._col] = store[ref._col] || {};
        store[ref._col][ref.id] = { ...data };
      }),
    };
    const result = await updateFn(tx);
    pendingWrites.forEach((write) => write());
    return result;
  }

  return { collection: col, batch, runTransaction, _store: store, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

function makeRequest({ body, authHeader, method = 'POST' } = {}) {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    return new Request('http://localhost/test', { method, headers, body: JSON.stringify(body) });
  }
  return new Request('http://localhost/test', { method, headers });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
});

describe('POST /api/properties/[id]/record-charge', () => {
  it('401s with no auth header', async () => {
    const { POST } = await import('../../src/app/api/properties/[id]/record-charge/route.js');
    const res = await POST(makeRequest({ body: {} }), { params: Promise.resolve({ id: 'prop1' }) });
    expect(res.status).toBe(401);
  });

  it('404s when the property does not exist', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    const { POST } = await import('../../src/app/api/properties/[id]/record-charge/route.js');
    const res = await POST(makeRequest({ body: {}, authHeader: 'Bearer t' }), { params: Promise.resolve({ id: 'prop1' }) });
    expect(res.status).toBe(404);
  });

  it('403s when the requester is neither the property owner nor a superAdmin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'intruder' });
    fakeDb._seed('properties', 'prop1', { userId: 'agent1', address: '1 Test St' });
    fakeDb._seed('users', 'intruder', { superAdmin: false });
    const { POST } = await import('../../src/app/api/properties/[id]/record-charge/route.js');
    const res = await POST(makeRequest({ body: {}, authHeader: 'Bearer t' }), { params: Promise.resolve({ id: 'prop1' }) });
    expect(res.status).toBe(403);
  });

  it('succeeds for the property owner and records a charge', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('properties', 'prop1', { userId: 'agent1', address: '1 Test St', createdAt: new Date() });
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts' });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: new Date('2020-01-01') });

    const { POST } = await import('../../src/app/api/properties/[id]/record-charge/route.js');
    const res = await POST(makeRequest({ body: {}, authHeader: 'Bearer t' }), { params: Promise.resolve({ id: 'prop1' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.created).toBe(true);
    expect(fakeDb._store.propertyCharges.prop1.status).toBe('pending');
  });

  it('succeeds for a superAdmin acting on someone else\'s property', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('properties', 'prop1', { userId: 'agent1', address: '1 Test St' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Lee' });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [] });

    const { POST } = await import('../../src/app/api/properties/[id]/record-charge/route.js');
    const res = await POST(makeRequest({ body: {}, authHeader: 'Bearer t' }), { params: Promise.resolve({ id: 'prop1' }) });
    expect(res.status).toBe(200);
  });

  it('is idempotent at the HTTP level too — a second call reports created: false', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('properties', 'prop1', { userId: 'agent1', address: '1 Test St', createdAt: new Date() });
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Lee' });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: new Date('2020-01-01') });

    const { POST } = await import('../../src/app/api/properties/[id]/record-charge/route.js');
    await POST(makeRequest({ body: {}, authHeader: 'Bearer t' }), { params: Promise.resolve({ id: 'prop1' }) });
    const res2 = await POST(makeRequest({ body: {}, authHeader: 'Bearer t' }), { params: Promise.resolve({ id: 'prop1' }) });
    const data2 = await res2.json();
    expect(data2.created).toBe(false);
  });
});

describe('POST /api/admin/invoicing/charges/[chargeId]', () => {
  it('401s with no auth header', async () => {
    const { POST } = await import('../../src/app/api/admin/invoicing/charges/[chargeId]/route.js');
    const res = await POST(makeRequest({ body: { action: 'exclude', reason: 'x' } }), { params: Promise.resolve({ chargeId: 'c1' }) });
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    const { POST } = await import('../../src/app/api/admin/invoicing/charges/[chargeId]/route.js');
    const res = await POST(makeRequest({ body: { action: 'exclude', reason: 'x' }, authHeader: 'Bearer t' }), { params: Promise.resolve({ chargeId: 'c1' }) });
    expect(res.status).toBe(403);
  });

  it('400s when no reason is given', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    const { POST } = await import('../../src/app/api/admin/invoicing/charges/[chargeId]/route.js');
    const res = await POST(makeRequest({ body: { action: 'exclude' }, authHeader: 'Bearer t' }), { params: Promise.resolve({ chargeId: 'c1' }) });
    expect(res.status).toBe(400);
  });

  it('400s on an unknown action', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    const { POST } = await import('../../src/app/api/admin/invoicing/charges/[chargeId]/route.js');
    const res = await POST(makeRequest({ body: { action: 'delete', reason: 'x' }, authHeader: 'Bearer t' }), { params: Promise.resolve({ chargeId: 'c1' }) });
    expect(res.status).toBe(400);
  });

  it('excludes a pending charge for an admin, with the reason recorded', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('propertyCharges', 'c1', { status: 'pending', totalInc: 200 });

    const { POST } = await import('../../src/app/api/admin/invoicing/charges/[chargeId]/route.js');
    const res = await POST(makeRequest({ body: { action: 'exclude', reason: 'Accidental duplicate' }, authHeader: 'Bearer t' }), { params: Promise.resolve({ chargeId: 'c1' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('excluded');
    expect(fakeDb._store.propertyCharges.c1.adjustment.reason).toBe('Accidental duplicate');
    expect(fakeDb._store.propertyCharges.c1.adjustment.adminUid).toBe('admin1');
  });

  it('surfaces a clear error (not a 500) when trying to exclude a non-pending charge', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('propertyCharges', 'c1', { status: 'invoiced', totalInc: 200 });

    const { POST } = await import('../../src/app/api/admin/invoicing/charges/[chargeId]/route.js');
    const res = await POST(makeRequest({ body: { action: 'exclude', reason: 'test' }, authHeader: 'Bearer t' }), { params: Promise.resolve({ chargeId: 'c1' }) });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/pending/i);
    // Never silently deleted or left ambiguous — still invoiced.
    expect(fakeDb._store.propertyCharges.c1.status).toBe('invoiced');
  });

  it('reverses an invoiced charge and flags requiresCreditNote', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('propertyCharges', 'c1', { status: 'invoiced', totalInc: 200 });

    const { POST } = await import('../../src/app/api/admin/invoicing/charges/[chargeId]/route.js');
    const res = await POST(makeRequest({ body: { action: 'reverse', reason: 'Vendor pulled out' }, authHeader: 'Bearer t' }), { params: Promise.resolve({ chargeId: 'c1' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.requiresCreditNote).toBe(true);
    expect(fakeDb._store.propertyCharges.c1.status).toBe('reversed');
  });
});

describe('GET /api/cron/reconcile-property-charges', () => {
  const originalSecret = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = 'test-secret'; });
  afterEach(() => { process.env.CRON_SECRET = originalSecret; });

  function makeGetRequest(authHeader) {
    const headers = new Headers();
    if (authHeader) headers.set('authorization', authHeader);
    return new Request('http://localhost/test', { method: 'GET', headers });
  }

  it('401s without the correct CRON_SECRET bearer token', async () => {
    const { GET } = await import('../../src/app/api/cron/reconcile-property-charges/route.js');
    const res = await GET(makeGetRequest('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('401s with no Authorization header at all (the real Vercel-cron-without-CRON_SECRET-configured scenario)', async () => {
    const { GET } = await import('../../src/app/api/cron/reconcile-property-charges/route.js');
    const res = await GET(makeGetRequest(null));
    expect(res.status).toBe(401);
  });

  it('fails closed when CRON_SECRET itself is unset — even a literal "Bearer undefined" header is rejected', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import('../../src/app/api/cron/reconcile-property-charges/route.js');
    const res = await GET(makeGetRequest('Bearer undefined'));
    expect(res.status).toBe(401);
  });

  it('records a charge for a property that is missing one, and reports the count', async () => {
    fakeDb._seed('properties', 'prop1', { userId: 'agent1', address: '1 Test St', createdAt: new Date() });
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Lee' });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [], billingActivatedAt: new Date('2020-01-01') });

    const { GET } = await import('../../src/app/api/cron/reconcile-property-charges/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.created).toBe(1);
    expect(fakeDb._store.propertyCharges.prop1.status).toBe('pending');
  });

  it('is a safe no-op (never a duplicate) when every property already has a charge', async () => {
    fakeDb._seed('properties', 'prop1', { userId: 'agent1', address: '1 Test St' });
    fakeDb._seed('propertyCharges', 'prop1', { status: 'pending' });

    const { GET } = await import('../../src/app/api/cron/reconcile-property-charges/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.created).toBe(0);
    expect(data.skipped).toBe(1);
  });

  it('never backfills a historical property that predates billing activation — the exact production-readiness concern this cron raised', async () => {
    fakeDb._seed('properties', 'historical', { userId: 'agent1', address: '1 Old St', createdAt: new Date('2024-01-01') });
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Lee' });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0, excludeAgentIds: [], billingActivatedAt: new Date('2026-06-01') });

    const { GET } = await import('../../src/app/api/cron/reconcile-property-charges/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.created).toBe(0);
    expect(fakeDb._store.propertyCharges.historical).toBeUndefined();
  });

  it('never creates any charge at all while billing is not yet activated, even for a brand new property', async () => {
    fakeDb._seed('properties', 'brand-new', { userId: 'agent1', address: '1 New St', createdAt: new Date() });
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Lee' });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0, excludeAgentIds: [] }); // billingActivatedAt unset — off

    const { GET } = await import('../../src/app/api/cron/reconcile-property-charges/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();

    expect(data.created).toBe(0);
    expect(fakeDb._store.propertyCharges['brand-new']).toBeUndefined();
  });
});

describe('POST /api/admin/invoicing/activate-billing', () => {
  it('401s with no auth header', async () => {
    const { POST } = await import('../../src/app/api/admin/invoicing/activate-billing/route.js');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    const { POST } = await import('../../src/app/api/admin/invoicing/activate-billing/route.js');
    const res = await POST(makeRequest({ authHeader: 'Bearer t' }));
    expect(res.status).toBe(403);
  });

  it('activates billing for the first time, setting billingActivatedAt', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0, excludeAgentIds: [] });

    const { POST } = await import('../../src/app/api/admin/invoicing/activate-billing/route.js');
    const res = await POST(makeRequest({ authHeader: 'Bearer t' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.alreadyActive).toBe(false);
    expect(fakeDb._store.settings.invoicing.billingActivatedAt).toBe('TIMESTAMP');
  });

  it('never overwrites an already-set activation timestamp — one-way, idempotent', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0, excludeAgentIds: [], billingActivatedAt: 'ALREADY-SET' });

    const { POST } = await import('../../src/app/api/admin/invoicing/activate-billing/route.js');
    const res = await POST(makeRequest({ authHeader: 'Bearer t' }));
    const data = await res.json();

    expect(data.alreadyActive).toBe(true);
    expect(fakeDb._store.settings.invoicing.billingActivatedAt).toBe('ALREADY-SET'); // unchanged
  });

  it('activating preserves every other existing setting — a merge, not an overwrite', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0, excludeAgentIds: ['agentX'], invoicePrefix: 'PM-' });

    const { POST } = await import('../../src/app/api/admin/invoicing/activate-billing/route.js');
    await POST(makeRequest({ authHeader: 'Bearer t' }));

    expect(fakeDb._store.settings.invoicing.pricePerListing).toBe(200);
    expect(fakeDb._store.settings.invoicing.excludeAgentIds).toEqual(['agentX']);
    expect(fakeDb._store.settings.invoicing.invoicePrefix).toBe('PM-');
  });
});

describe('POST /api/admin/invoicing/billing-contacts', () => {
  it('401s with no auth header', async () => {
    const { POST } = await import('../../src/app/api/admin/invoicing/billing-contacts/route.js');
    const res = await POST(makeRequest({ body: { billingEntityKey: 'agency:a', email: 'a@example.com' } }));
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    const { POST } = await import('../../src/app/api/admin/invoicing/billing-contacts/route.js');
    const res = await POST(makeRequest({ body: { billingEntityKey: 'agency:a', email: 'a@example.com' }, authHeader: 'Bearer t' }));
    expect(res.status).toBe(403);
  });

  it('400s on a missing/invalid email', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    const { POST } = await import('../../src/app/api/admin/invoicing/billing-contacts/route.js');
    const res = await POST(makeRequest({ body: { billingEntityKey: 'agency:a', email: 'not-an-email' }, authHeader: 'Bearer t' }));
    expect(res.status).toBe(400);
  });

  it('designates a billing contact for an admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    const { POST } = await import('../../src/app/api/admin/invoicing/billing-contacts/route.js');
    const res = await POST(makeRequest({
      body: { billingEntityKey: 'agency:a', name: 'Accounts Payable', email: 'accounts@agency-a.example.com' },
      authHeader: 'Bearer t',
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(fakeDb._store.billingContacts['agency:a'].email).toBe('accounts@agency-a.example.com');
    expect(fakeDb._store.billingContacts['agency:a'].setBy).toBe('admin1');
  });

  it('immediately updates a still-open invoiceRunItem for the same entity', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('invoiceRunItems', 'item1', { billingEntityKey: 'agency:a', status: 'pending', agentName: 'Old', agentEmail: 'old@example.com' });

    const { POST } = await import('../../src/app/api/admin/invoicing/billing-contacts/route.js');
    await POST(makeRequest({
      body: { billingEntityKey: 'agency:a', name: 'New Contact', email: 'new@example.com' },
      authHeader: 'Bearer t',
    }));

    expect(fakeDb._store.invoiceRunItems.item1.agentEmail).toBe('new@example.com');
    expect(fakeDb._store.invoiceRunItems.item1.agentName).toBe('New Contact');
  });
});

describe('POST /api/admin/invoicing/disconnect-xero', () => {
  it('401s with no auth header', async () => {
    const { POST } = await import('../../src/app/api/admin/invoicing/disconnect-xero/route.js');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
    expect(mockDisconnectXero).not.toHaveBeenCalled();
  });

  it('403s for a non-admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    const { POST } = await import('../../src/app/api/admin/invoicing/disconnect-xero/route.js');
    const res = await POST(makeRequest({ authHeader: 'Bearer t' }));
    expect(res.status).toBe(403);
    expect(mockDisconnectXero).not.toHaveBeenCalled();
  });

  it('disconnects for an admin and reports whether Xero-side revocation succeeded', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    mockDisconnectXero.mockResolvedValue({ wasConnected: true, revokedAtXero: true });

    const { POST } = await import('../../src/app/api/admin/invoicing/disconnect-xero/route.js');
    const res = await POST(makeRequest({ authHeader: 'Bearer t' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.wasConnected).toBe(true);
    expect(data.revokedAtXero).toBe(true);
    expect(mockDisconnectXero).toHaveBeenCalledTimes(1);
  });

  it('500s with a clear error if disconnectXero itself throws, rather than silently reporting success', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    mockDisconnectXero.mockRejectedValue(new Error('boom'));

    const { POST } = await import('../../src/app/api/admin/invoicing/disconnect-xero/route.js');
    const res = await POST(makeRequest({ authHeader: 'Bearer t' }));
    expect(res.status).toBe(500);
  });
});
