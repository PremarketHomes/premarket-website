import { describe, it, expect, vi, beforeEach } from 'vitest';

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
          async set(data) { store[name][id] = { ...data }; },
          async update(patch) {
            store[name][id] = { ...(store[name][id] || {}), ...patch };
          },
        };
      },
      where(field, op, value) {
        function matches(raw, f, o, v) {
          if (o === '==') return raw[f] === v;
          if (o === '!=') return raw[f] !== v && raw[f] !== undefined;
          return true;
        }
        function makeQuery(docs) {
          return {
            where: (f2, o2, v2) => makeQuery(docs.filter((d) => matches(d._raw, f2, o2, v2))),
            get: async () => ({ docs, empty: docs.length === 0 }),
          };
        }
        const all = Object.entries(store[name]).map(([id, data]) => ({ id, data: () => data, _raw: data }));
        return makeQuery(all.filter((d) => matches(d._raw, field, op, value)));
      },
      async get() {
        const docs = Object.entries(store[name]).map(([id, data]) => ({ id, data: () => data }));
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

function makeGetRequest(authHeader) {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method: 'GET', headers });
}

function makePostRequest(body, authHeader) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method: 'POST', headers, body: JSON.stringify(body || {}) });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
});

describe('GET /api/admin/agency-memberships', () => {
  it('401s with no auth, 403s for a non-admin', async () => {
    const { GET } = await import('../../src/app/api/admin/agency-memberships/route.js');
    expect((await GET(makeGetRequest())).status).toBe(401);

    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    expect((await GET(makeGetRequest('Bearer t'))).status).toBe(403);
  });

  it('lists a pending request AND a legacy link — branding only, no billing/charge data attached', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('agencyBrands', 'brand-x', { name: 'Agency X', createdBy: 'creatorUid' });
    fakeDb._seed('agencyMemberships', 'requester1', { uid: 'requester1', agencyBrandId: 'brand-x', status: 'pending', requestedCompanyName: 'Agency X' });
    fakeDb._seed('users', 'requester1', { companyName: 'Agency X', agencyBrandId: 'brand-x' });
    fakeDb._seed('users', 'legacyAgent', { companyName: 'Agency X', agencyBrandId: 'brand-x' }); // no membership record at all

    const { GET } = await import('../../src/app/api/admin/agency-memberships/route.js');
    const res = await GET(makeGetRequest('Bearer t'));
    const data = await res.json();

    expect(res.status).toBe(200);
    const uids = data.pending.map((p) => p.uid);
    expect(uids).toContain('requester1');
    expect(uids).toContain('legacyAgent');
    expect(data.pending.find((p) => p.uid === 'requester1').heldChargeCount).toBeUndefined();
    expect(data.pending.find((p) => p.uid === 'legacyAgent').source).toBe('legacy');
  });
});

describe('POST /api/admin/agency-memberships/approve', () => {
  it('401s with no auth, 403s for a non-admin', async () => {
    const { POST } = await import('../../src/app/api/admin/agency-memberships/approve/route.js');
    expect((await POST(makePostRequest({ uid: 'agent1' }))).status).toBe(401);

    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    expect((await POST(makePostRequest({ uid: 'agent1' }, 'Bearer t'))).status).toBe(403);
  });

  it('a non-admin cannot approve their OWN pending membership by calling this route directly', async () => {
    // Even if an unverified agent discovered this endpoint and tried
    // calling it on themselves, verifyAdmin rejects them before the
    // body is even read.
    mockVerifyIdToken.mockResolvedValue({ uid: 'unverifiedAgent' });
    fakeDb._seed('users', 'unverifiedAgent', { superAdmin: false, agencyBrandId: 'brand-x' });
    fakeDb._seed('agencyMemberships', 'unverifiedAgent', { uid: 'unverifiedAgent', agencyBrandId: 'brand-x', status: 'pending' });

    const { POST } = await import('../../src/app/api/admin/agency-memberships/approve/route.js');
    const res = await POST(makePostRequest({ uid: 'unverifiedAgent' }, 'Bearer t'));

    expect(res.status).toBe(403);
    expect(fakeDb._store.agencyMemberships.unverifiedAgent.status).toBe('pending'); // unchanged
  });

  it('a real superAdmin approves a pending request successfully', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('agencyBrands', 'brand-x', { name: 'Agency X', createdBy: 'creatorUid' });
    fakeDb._seed('agencyMemberships', 'agent2', { uid: 'agent2', agencyBrandId: 'brand-x', status: 'pending' });

    const { POST } = await import('../../src/app/api/admin/agency-memberships/approve/route.js');
    const res = await POST(makePostRequest({ uid: 'agent2' }, 'Bearer t'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('verified');
    expect(fakeDb._store.agencyMemberships.agent2.status).toBe('verified');
    expect(fakeDb._store.agencyMemberships.agent2.verifiedBy).toBe('admin1');
  });

  it('a superAdmin approves a legacy link (no membership doc at all) by falling back to the user\'s agencyBrandId', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('agencyBrands', 'brand-x', { name: 'Agency X', createdBy: 'creatorUid' });
    fakeDb._seed('users', 'legacyAgent', { agencyBrandId: 'brand-x' });

    const { POST } = await import('../../src/app/api/admin/agency-memberships/approve/route.js');
    const res = await POST(makePostRequest({ uid: 'legacyAgent' }, 'Bearer t'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.agencyBrandId).toBe('brand-x');
    expect(fakeDb._store.agencyMemberships.legacyAgent.status).toBe('verified');
  });

  it('400s when there is nothing to approve at all', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('users', 'noLinkAgent', {});

    const { POST } = await import('../../src/app/api/admin/agency-memberships/approve/route.js');
    const res = await POST(makePostRequest({ uid: 'noLinkAgent' }, 'Bearer t'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/agency-memberships/reject', () => {
  it('401s with no auth, 403s for a non-admin', async () => {
    const { POST } = await import('../../src/app/api/admin/agency-memberships/reject/route.js');
    expect((await POST(makePostRequest({ uid: 'agent1' }))).status).toBe(401);

    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    expect((await POST(makePostRequest({ uid: 'agent1' }, 'Bearer t'))).status).toBe(403);
  });

  it('a non-admin cannot reject (or otherwise mutate) another account\'s membership by calling this route directly', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agentX' });
    fakeDb._seed('users', 'agentX', { superAdmin: false });
    fakeDb._seed('users', 'victim', { agencyBrandId: 'brand-x' });
    fakeDb._seed('agencyMemberships', 'victim', { uid: 'victim', agencyBrandId: 'brand-x', status: 'pending' });

    const { POST } = await import('../../src/app/api/admin/agency-memberships/reject/route.js');
    const res = await POST(makePostRequest({ uid: 'victim' }, 'Bearer t'));

    expect(res.status).toBe(403);
    expect(fakeDb._store.agencyMemberships.victim.status).toBe('pending');
    expect(fakeDb._store.users.victim.agencyBrandId).toBe('brand-x');
  });

  it('a real superAdmin rejects a request and clears the account\'s agencyBrandId', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('users', 'agent2', { agencyBrandId: 'brand-x' });
    fakeDb._seed('agencyMemberships', 'agent2', { uid: 'agent2', agencyBrandId: 'brand-x', status: 'pending' });

    const { POST } = await import('../../src/app/api/admin/agency-memberships/reject/route.js');
    const res = await POST(makePostRequest({ uid: 'agent2', reason: 'Not a real colleague' }, 'Bearer t'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('rejected');
    expect(fakeDb._store.agencyMemberships.agent2.status).toBe('rejected');
    expect(fakeDb._store.agencyMemberships.agent2.rejectionReason).toBe('Not a real colleague');
    expect(fakeDb._store.users.agent2.agencyBrandId).toBeNull();
  });

  it('never touches the brand itself, the creator\'s membership, or any other account', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('agencyBrands', 'brand-x', { name: 'Agency X', createdBy: 'creatorUid' });
    fakeDb._seed('agencyMemberships', 'creatorUid', { uid: 'creatorUid', agencyBrandId: 'brand-x', status: 'verified' });
    fakeDb._seed('users', 'creatorUid', { agencyBrandId: 'brand-x' });
    fakeDb._seed('users', 'agent2', { agencyBrandId: 'brand-x' });
    fakeDb._seed('agencyMemberships', 'agent2', { uid: 'agent2', agencyBrandId: 'brand-x', status: 'pending' });

    const { POST } = await import('../../src/app/api/admin/agency-memberships/reject/route.js');
    await POST(makePostRequest({ uid: 'agent2' }, 'Bearer t'));

    expect(fakeDb._store.agencyBrands['brand-x']).toBeDefined();
    expect(fakeDb._store.agencyMemberships.creatorUid.status).toBe('verified');
    expect(fakeDb._store.users.creatorUid.agencyBrandId).toBe('brand-x');
  });
});
