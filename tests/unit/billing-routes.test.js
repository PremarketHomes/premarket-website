import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
          async set(data) { store[name][id] = { ...data }; },
          async update(patch) { store[name][id] = { ...(store[name][id] || {}), ...patch }; },
        };
      },
      where(field, op, value) {
        const all = Object.entries(store[name]).map(([docId, data]) => ({ id: docId, data: () => data, _raw: data }));
        const filtered = all.filter((d) => (op === '==' ? d._raw[field] === value : true));
        return { get: async () => ({ docs: filtered, empty: filtered.length === 0, size: filtered.length }) };
      },
      async get() {
        const docs = Object.entries(store[name]).map(([docId, data]) => ({ id: docId, data: () => data }));
        return { docs, empty: docs.length === 0 };
      },
    };
  }
  return { collection: col, _store: store, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
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
    fakeDb._seed('properties', 'prop1', { userId: 'agent1', address: '1 Test St' });
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Lee', companyName: 'Harcourts' });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [] });

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
    fakeDb._seed('properties', 'prop1', { userId: 'agent1', address: '1 Test St' });
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Lee' });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [] });

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

  it('records a charge for a property that is missing one, and reports the count', async () => {
    fakeDb._seed('properties', 'prop1', { userId: 'agent1', address: '1 Test St' });
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Lee' });
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0.1, excludeAgentIds: [] });

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
});
