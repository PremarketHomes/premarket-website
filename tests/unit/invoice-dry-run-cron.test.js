import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

const mockSendEmail = vi.fn();
vi.mock('../../src/app/api/services/resendService', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
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
          ref: { _col: name, id, update: async (patch) => { store[name][id] = { ...(store[name][id] || {}), ...patch }; } },
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

function makeGetRequest(authHeader) {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method: 'GET', headers });
}

describe('GET /api/cron/invoice-dry-run — per-agency 30-day cycle', () => {
  const originalSecret = process.env.CRON_SECRET;
  beforeEach(() => {
    fakeDb = makeFakeDb();
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });
  afterEach(() => { process.env.CRON_SECRET = originalSecret; });

  it('401s without the correct CRON_SECRET bearer token', async () => {
    const { GET } = await import('../../src/app/api/cron/invoice-dry-run/route.js');
    const res = await GET(makeGetRequest('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('skips entirely when cronEnabled is false', async () => {
    fakeDb._seed('settings', 'invoicing', { cronEnabled: false });
    const { GET } = await import('../../src/app/api/cron/invoice-dry-run/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();
    expect(data.skipped).toBe(true);
    expect(data.message).toMatch(/disabled/i);
  });

  it('skips with a clear message when no agency has reached its 30-day cycle yet', async () => {
    fakeDb._seed('settings', 'invoicing', { cronEnabled: true, pricePerListing: 200, gstRate: 0, excludeAgentIds: [] });
    fakeDb._seed('propertyCharges', 'prop1', {
      propertyId: 'prop1', billingEntityKey: 'agency:a', billingEntityName: 'Agency A',
      agentUserId: 'agent1', agentName: 'Jo', agentEmail: 'jo@example.com',
      status: 'pending', totalInc: 200, subtotalEx: 200, gstAmount: 0,
      createdAt: new Date(), // just created — nowhere near 30 days
    });

    const { GET } = await import('../../src/app/api/cron/invoice-dry-run/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();

    expect(data.skipped).toBe(true);
    expect(data.message).toMatch(/30-day/i);
    const charge = await fakeDb.collection('propertyCharges').doc('prop1').get();
    expect(charge.data().status).toBe('pending'); // untouched
  });

  it('creates a draft run containing only the agency whose cycle is due, leaving the other agency alone', async () => {
    fakeDb._seed('settings', 'invoicing', { cronEnabled: true, pricePerListing: 200, gstRate: 0, excludeAgentIds: [] });
    fakeDb._seed('billingContacts', 'agency:due', { status: 'confirmed', name: 'Jo', email: 'jo@example.com' });
    fakeDb._seed('billingContacts', 'agency:not-due', { status: 'confirmed', name: 'Max', email: 'max@example.com' });
    fakeDb._seed('propertyCharges', 'propA', {
      propertyId: 'propA', billingEntityKey: 'agency:due', billingEntityName: 'Due Agency',
      agentUserId: 'agent1', agentName: 'Jo', agentEmail: 'jo@example.com',
      status: 'pending', totalInc: 200, subtotalEx: 200, gstAmount: 0,
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), // 31 days old — due
    });
    fakeDb._seed('propertyCharges', 'propB', {
      propertyId: 'propB', billingEntityKey: 'agency:not-due', billingEntityName: 'Not Due Agency',
      agentUserId: 'agent2', agentName: 'Max', agentEmail: 'max@example.com',
      status: 'pending', totalInc: 200, subtotalEx: 200, gstAmount: 0,
      createdAt: new Date(), // brand new — not due
    });
    fakeDb._seed('users', 'admin1', { superAdmin: true, email: 'admin@premarket.homes' });
    mockSendEmail.mockResolvedValue({});

    const { GET } = await import('../../src/app/api/cron/invoice-dry-run/route.js');
    const res = await GET(makeGetRequest('Bearer test-secret'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.totalAgencies).toBe(1);
    expect(data.totalProperties).toBe(1);

    const chargeA = await fakeDb.collection('propertyCharges').doc('propA').get();
    const chargeB = await fakeDb.collection('propertyCharges').doc('propB').get();
    expect(chargeA.data().status).toBe('queued');
    expect(chargeB.data().status).toBe('pending'); // left for its own future cycle

    expect(mockSendEmail).toHaveBeenCalledTimes(1); // notifies the admin, never the agency
    expect(mockSendEmail.mock.calls[0][0].to).toBe('admin@premarket.homes');
  });

  it('never auto-approves or auto-sends — the created run is a draft', async () => {
    fakeDb._seed('settings', 'invoicing', { cronEnabled: true, pricePerListing: 200, gstRate: 0, excludeAgentIds: [] });
    fakeDb._seed('billingContacts', 'agency:due', { status: 'confirmed', name: 'Jo', email: 'jo@example.com' });
    fakeDb._seed('propertyCharges', 'propA', {
      propertyId: 'propA', billingEntityKey: 'agency:due', billingEntityName: 'Due Agency',
      agentUserId: 'agent1', agentName: 'Jo', agentEmail: 'jo@example.com',
      status: 'pending', totalInc: 200, subtotalEx: 200, gstAmount: 0,
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    mockSendEmail.mockResolvedValue({});

    const { GET } = await import('../../src/app/api/cron/invoice-dry-run/route.js');
    await GET(makeGetRequest('Bearer test-secret'));

    const runs = await fakeDb.collection('invoiceRuns').get();
    expect(runs.docs.length).toBe(1);
    expect(runs.docs[0].data().status).toBe('draft');
  });
});
