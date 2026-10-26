import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

function makeFakeDb() {
  const store = {};
  function col(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        return { async get() { return { exists: !!store[name][id], data: () => store[name][id] }; } };
      },
      where(field, op, value) {
        function getPath(obj, path) {
          return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
        }
        function matches(raw, f, o, v) {
          if (o === '==') return getPath(raw, f) === v;
          return true;
        }
        function makeQuery(docs) {
          return {
            where: (f2, o2, v2) => makeQuery(docs.filter((d) => matches(d._raw, f2, o2, v2))),
            orderBy: () => makeQuery(docs),
            limit: (n) => makeQuery(docs.slice(0, n)),
            get: async () => ({ docs, empty: docs.length === 0 }),
          };
        }
        const all = Object.entries(store[name]).map(([id, data]) => ({ id, data: () => data, _raw: data }));
        return makeQuery(all.filter((d) => matches(d._raw, field, op, value)));
      },
      orderBy() {
        const all = Object.entries(store[name]).map(([id, data]) => ({ id, data: () => data }));
        return { get: async () => ({ docs: all, empty: all.length === 0 }) };
      },
    };
  }
  return { collection: col, _store: store, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

// These tests are only about authorization on this route, never the
// real (expensive, network-calling) suburb score computation itself.
vi.mock('../../src/app/api/v1/scoreComputation.js', () => ({
  getUniqueSuburbs: vi.fn(async () => []),
  computeSuburbScores: vi.fn(async () => null),
  writeScoreToFirestore: vi.fn(async () => {}),
  clearAllMarketScores: vi.fn(async () => 0),
}));

function makeGetRequest(url, headers = {}) {
  const h = new Headers(headers);
  return new Request(url, { method: 'GET', headers: h });
}

function makePostRequest(url, body, authHeader) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
});

describe('SECURITY — GET /api/v1/contacts', () => {
  it('rejects a request with no auth at all (no x-api-key, no bearer)', async () => {
    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const res = await GET(makeGetRequest('http://localhost/api/v1/contacts'));
    expect(res.status).toBe(401);
  });

  it('an ordinary signed-in buyer with NO approved API access is rejected outright — cannot reach any contact data', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'buyer1', email: 'buyer@example.com' });
    fakeDb._seed('users', 'buyer1', { isBuyer: true, superAdmin: false }); // no apiAccess field at all

    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const res = await GET(makeGetRequest('http://localhost/api/v1/contacts', { authorization: 'Bearer t' }));
    expect(res.status).toBe(403);
  });

  it('an ordinary signed-in agent with NO approved API access is rejected outright, even with just a bearer token (the exact gap that was fixed)', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1', email: 'agent@example.com' });
    fakeDb._seed('users', 'agent1', { isAgent: true, superAdmin: false });

    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const res = await GET(makeGetRequest('http://localhost/api/v1/contacts', { authorization: 'Bearer t' }));
    expect(res.status).toBe(403);
  });

  it('an approved agent (valid x-api-key) only ever sees contacts linked to THEIR OWN account, never unrelated agents\' contacts', async () => {
    fakeDb._seed('users', 'agentA', { isAgent: true, superAdmin: false, apiAccess: { status: 'approved', apiKey: 'key-a' } });
    fakeDb._seed('contacts', 'c1', { firstName: 'Owned', lastName: 'ByA', email: 'owned@example.com', isBuyer: true, linkedAgentIds: ['agentA'] });
    fakeDb._seed('contacts', 'c2', { firstName: 'Owned', lastName: 'ByB', email: 'secret@example.com', isBuyer: true, linkedAgentIds: ['agentB'] });

    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const res = await GET(makeGetRequest('http://localhost/api/v1/contacts', { 'x-api-key': 'key-a' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(1); // scoped count, not the platform-wide total
    expect(data.contacts).toHaveLength(1);
    expect(data.contacts[0].email).toBe('owned@example.com');
    expect(data.contacts.some((c) => c.email === 'secret@example.com')).toBe(false);
  });

  it('a buyer who somehow has approved API access still gets zero contacts — they have no linkedAgentIds entries at all, never other users\' data', async () => {
    fakeDb._seed('users', 'buyer1', { isBuyer: true, superAdmin: false, apiAccess: { status: 'approved', apiKey: 'key-buyer' } });
    fakeDb._seed('contacts', 'c1', { firstName: 'Someone', email: 'someone@example.com', linkedAgentIds: ['agentA'] });

    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const res = await GET(makeGetRequest('http://localhost/api/v1/contacts', { 'x-api-key': 'key-buyer' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.contacts).toHaveLength(0);
  });

  it('a superAdmin sees everything, unrestricted — including via a plain bearer token with no apiAccess at all', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1', email: 'admin@example.com' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('contacts', 'c1', { firstName: 'A', email: 'a@example.com', linkedAgentIds: ['agentA'] });
    fakeDb._seed('contacts', 'c2', { firstName: 'B', email: 'b@example.com', linkedAgentIds: ['agentB'] });

    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const res = await GET(makeGetRequest('http://localhost/api/v1/contacts', { authorization: 'Bearer t' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(2);
  });

  it('REGRESSION: an x-api-key belonging to a superAdmin account is still scoped to its own linked contacts, never platform-wide', async () => {
    fakeDb._seed('users', 'evolveLike', { isAgent: true, superAdmin: true, apiAccess: { status: 'approved', apiKey: 'key-superadmin' } });
    fakeDb._seed('contacts', 'c1', { firstName: 'Mine', email: 'mine@example.com', linkedAgentIds: ['evolveLike'] });
    fakeDb._seed('contacts', 'c2', { firstName: 'Other', email: 'other@example.com', linkedAgentIds: ['someoneElse'] });
    fakeDb._seed('contacts', 'c3', { firstName: 'Unlinked', email: 'unlinked@example.com' });

    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const res = await GET(makeGetRequest('http://localhost/api/v1/contacts', { 'x-api-key': 'key-superadmin' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.contacts.map((c) => c.email)).toEqual(['mine@example.com']);
  });

  it('REGRESSION: a superAdmin key with zero linked contacts gets an empty list (not the platform list) — matches Evolve today', async () => {
    fakeDb._seed('users', 'evolveLike', { isAgent: true, superAdmin: true, apiAccess: { status: 'approved', apiKey: 'key-superadmin' } });
    fakeDb._seed('contacts', 'c2', { firstName: 'Other', email: 'other@example.com', linkedAgentIds: ['someoneElse'] });

    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const data = await (await GET(makeGetRequest('http://localhost/api/v1/contacts', { 'x-api-key': 'key-superadmin' }))).json();

    expect(data.total).toBe(0);
    expect(JSON.stringify(data)).not.toContain('other@example.com');
  });

  it('REGRESSION: a revoked/unapproved superAdmin key is rejected outright', async () => {
    fakeDb._seed('users', 'evolveLike', { superAdmin: true, apiAccess: { status: 'revoked', apiKey: 'key-revoked' } });
    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const res = await GET(makeGetRequest('http://localhost/api/v1/contacts', { 'x-api-key': 'key-revoked' }));
    expect(res.status).toBe(401);
  });

  it('REGRESSION: the same superAdmin signing in with a real ID token still sees everything (admin behaviour preserved)', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'evolveLike', email: 'phil@example.com' });
    fakeDb._seed('users', 'evolveLike', { isAgent: true, superAdmin: true, apiAccess: { status: 'approved', apiKey: 'key-superadmin' } });
    fakeDb._seed('contacts', 'c1', { firstName: 'A', email: 'a@example.com', linkedAgentIds: ['x'] });
    fakeDb._seed('contacts', 'c2', { firstName: 'B', email: 'b@example.com', linkedAgentIds: ['y'] });

    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const data = await (await GET(makeGetRequest('http://localhost/api/v1/contacts', { authorization: 'Bearer t' }))).json();
    expect(data.total).toBe(2);
  });

  it('an approved external integration (x-api-key, not an agent at all) is still scoped to its own linked contacts only', async () => {
    fakeDb._seed('users', 'integrationUser', { superAdmin: false, apiAccess: { status: 'approved', apiKey: 'key-int' } });
    fakeDb._seed('contacts', 'c1', { firstName: 'Mine', email: 'mine@example.com', linkedAgentIds: ['integrationUser'] });
    fakeDb._seed('contacts', 'c2', { firstName: 'NotMine', email: 'notmine@example.com', linkedAgentIds: ['someoneElse'] });

    const { GET } = await import('../../src/app/api/v1/contacts/route.js');
    const res = await GET(makeGetRequest('http://localhost/api/v1/contacts', { 'x-api-key': 'key-int' }));
    const data = await res.json();

    expect(data.contacts.map((c) => c.email)).toEqual(['mine@example.com']);
  });
});

describe('SECURITY — POST /api/admin/compute-scores', () => {
  it('rejects a request with no auth at all', async () => {
    const { POST } = await import('../../src/app/api/admin/compute-scores/route.js');
    const res = await POST(makePostRequest('http://localhost/api/admin/compute-scores', {}));
    expect(res.status).toBe(401);
  });

  it('rejects an ordinary non-admin agent, even one with approved API access (apiAccess no longer grants this)', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false, apiAccess: { status: 'approved', apiKey: 'key-a' } });

    const { POST } = await import('../../src/app/api/admin/compute-scores/route.js');
    const res = await POST(makePostRequest('http://localhost/api/admin/compute-scores', {}, 'Bearer t'));
    expect(res.status).toBe(403);
  });

  it('a genuine superAdmin can still trigger it', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });

    const { POST } = await import('../../src/app/api/admin/compute-scores/route.js');
    const res = await POST(makePostRequest('http://localhost/api/admin/compute-scores', {}, 'Bearer t'));
    expect(res.status).toBe(200);
  });
});
