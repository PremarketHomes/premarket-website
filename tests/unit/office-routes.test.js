import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
const state = { users: {}, offices: {}, officeAdminInfo: {}, officeImports: {}, officeAgentContacts: {}, officeInvites: {}, officeJoinRequests: [] };
const authState = { users: new Map() };
let autoIdCounter = 0;

function makeQuery(name, filters) {
  return {
    where: (field, op, value) =>
      makeQuery(name, [...filters, (data) => (op === '==' ? data[field] === value : true)]),
    get: vi.fn().mockImplementation(async () => {
      const docs = Object.entries(state[name])
        .filter(([, data]) => filters.every((f) => f(data)))
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs };
    }),
  };
}

function makeCollection(name) {
  if (name === 'officeJoinRequests') {
    return { add: vi.fn().mockImplementation(async (data) => { state.officeJoinRequests.push(data); return { id: 'req-1' }; }) };
  }
  return {
    doc: (id) => {
      const realId = id || `${name}-auto-${++autoIdCounter}`;
      return {
        id: realId,
        get: vi.fn().mockImplementation(async () => (
          state[name][realId] ? { exists: true, id: realId, data: () => state[name][realId] } : { exists: false }
        )),
        set: vi.fn().mockImplementation(async (data) => { state[name][realId] = data; }),
        create: vi.fn().mockImplementation(async (data) => {
          if (state[name][realId]) {
            const err = new Error('ALREADY_EXISTS: Document already exists');
            err.code = 6;
            throw err;
          }
          state[name][realId] = { ...data };
        }),
        update: vi.fn().mockImplementation(async (patch) => {
          state[name][realId] = { ...(state[name][realId] || {}) };
          for (const [key, value] of Object.entries(patch)) {
            if (value === 'DELETE_SENTINEL') delete state[name][realId][key];
            else if (value && value.__arrayRemove) {
              state[name][realId][key] = (state[name][realId][key] || []).filter((v) => v !== value.__arrayRemove);
            } else state[name][realId][key] = value;
          }
        }),
      };
    },
    where: (field, op, value) =>
      makeQuery(name, [(data) => (op === '==' ? data[field] === value : true)]),
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (!['users', 'offices', 'officeAdminInfo', 'officeImports', 'officeAgentContacts', 'officeInvites', 'officeJoinRequests', 'agencyBrands'].includes(name)) {
        throw new Error(`Unexpected collection in test: ${name}`);
      }
      if (!state[name] && name === 'agencyBrands') state.agencyBrands = {};
      return makeCollection(name);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'TIMESTAMP',
    delete: () => 'DELETE_SENTINEL',
    arrayRemove: (v) => ({ __arrayRemove: v }),
  },
}));

const sentEmails = [];
vi.mock('../../src/app/api/services/resendService', () => ({
  sendOfficeInviteEmail: vi.fn().mockImplementation(async (email) => { sentEmails.push({ type: 'activation', email }); }),
  sendOfficeJoinInviteEmail: vi.fn().mockImplementation(async (email) => { sentEmails.push({ type: 'join-invite', email }); }),
}));

const createUserMock = vi.fn();
const getUserByEmailMock = vi.fn();
const getUsersMock = vi.fn();
const generatePasswordResetLinkMock = vi.fn();
const updateUserMock = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: mockVerifyIdToken,
    createUser: createUserMock,
    getUserByEmail: getUserByEmailMock,
    getUsers: getUsersMock,
    generatePasswordResetLink: generatePasswordResetLinkMock,
    updateUser: updateUserMock,
  }),
}));

/** Seeds an office split across its two real documents — see
 * officeService.js's own split between the public `offices` doc
 * (agencyBrandId only) and the server-only `officeAdminInfo` doc
 * (name/officeAdminUids/status/etc). */
function seedOffice(id, { name, officeAdminUids, agencyBrandId = null, status = 'active' }) {
  state.offices[id] = { agencyBrandId };
  state.officeAdminInfo[id] = { name, officeAdminUids, status, createdBy: officeAdminUids[0] };
}

function makeRequest(body, authHeader, method = 'POST') {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method, headers, body: method !== 'GET' ? JSON.stringify(body) : undefined });
}

function setupValidAuth(uid = 'admin1') {
  mockVerifyIdToken.mockResolvedValue({ uid, email: 'admin@example.com' });
}

function resetAll() {
  state.users = {};
  state.offices = {};
  state.officeImports = {};
  state.officeAgentContacts = {};
  state.officeInvites = {};
  state.officeJoinRequests = [];
  state.agencyBrands = {};
  authState.users = new Map();
  sentEmails.length = 0;
  autoIdCounter = 0;

  createUserMock.mockReset().mockImplementation(async ({ email }) => {
    const uid = `auth-${++autoIdCounter}`;
    authState.users.set(email.toLowerCase(), { uid, email });
    return { uid };
  });
  getUserByEmailMock.mockReset().mockImplementation(async (email) => {
    const found = authState.users.get(email.toLowerCase());
    if (!found) { const err = new Error('User not found'); err.code = 'auth/user-not-found'; throw err; }
    return found;
  });
  getUsersMock.mockReset().mockImplementation(async (identifiers) => ({
    users: identifiers.map((i) => authState.users.get(String(i.email || '').toLowerCase())).filter(Boolean),
    notFound: [],
  }));
  generatePasswordResetLinkMock.mockReset().mockResolvedValue('https://premarket.homes/__/auth/action?token=abc');
}

describe('POST /api/offices', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('returns 401 without auth', async () => {
    const { POST } = await import('../../src/app/api/offices/route');
    const res = await POST(makeRequest({ name: 'X' }));
    expect(res.status).toBe(401);
  });

  it('creates an office and makes the caller its administrator', async () => {
    setupValidAuth('admin1');
    state.users.admin1 = {};
    const { POST } = await import('../../src/app/api/offices/route');
    const res = await POST(makeRequest({ name: 'Harcourts Property Hub' }, 'Bearer valid'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('created');
    expect(state.users.admin1.isOfficeAdmin).toBe(true);
  });

  it('SECURITY: a colliding office name never grants membership of the existing office', async () => {
    setupValidAuth('admin1');
    state.users.admin1 = {};
    const { POST } = await import('../../src/app/api/offices/route');
    await POST(makeRequest({ name: 'Harcourts Property Hub' }, 'Bearer valid'));

    setupValidAuth('admin2');
    state.users.admin2 = {};
    const res2 = await POST(makeRequest({ name: 'Harcourts Property Hub' }, 'Bearer valid'));
    const body2 = await res2.json();
    expect(body2.status).toBe('exists');
    expect(state.users.admin2.officeId).toBeUndefined();
  });
});

describe('GET /api/offices/mine', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('returns 401 without auth', async () => {
    const { GET } = await import('../../src/app/api/offices/mine/route');
    const res = await GET(makeRequest(undefined, undefined, 'GET'));
    expect(res.status).toBe(401);
  });

  it('returns office: null for an agent with no office', async () => {
    setupValidAuth('agent1');
    state.users.agent1 = {};
    const { GET } = await import('../../src/app/api/offices/mine/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'));
    const body = await res.json();
    expect(body.office).toBeNull();
  });
});

describe('GET/POST /api/offices/[officeId]/agents', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('SECURITY: a non-administrator cannot list this office\'s agents', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    setupValidAuth('rando');
    const { GET } = await import('../../src/app/api/offices/[officeId]/agents/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'), { params: Promise.resolve({ officeId: 'office1' }) });
    expect(res.status).toBe(403);
  });

  it('SECURITY: an admin of a DIFFERENT office cannot list this one\'s agents', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    seedOffice('office2', { name: 'Y', officeAdminUids: ['admin2'] });
    setupValidAuth('admin2');
    const { GET } = await import('../../src/app/api/offices/[officeId]/agents/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'), { params: Promise.resolve({ officeId: 'office1' }) });
    expect(res.status).toBe(403);
  });

  it('an administrator can list their own office\'s agents with counts', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.admin1 = { officeId: 'office1', accountStatus: 'active', isOfficeAdmin: true };
    state.users.agent2 = { officeId: 'office1', accountStatus: 'invited' };
    setupValidAuth('admin1');
    const { GET } = await import('../../src/app/api/offices/[officeId]/agents/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'), { params: Promise.resolve({ officeId: 'office1' }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.stats.total).toBe(2);
  });

  it('adds a single new agent — creates an Auth user with no password', async () => {
    seedOffice('office1', { name: 'Harcourts Property Hub', officeAdminUids: ['admin1'] });
    setupValidAuth('admin1');
    const { POST } = await import('../../src/app/api/offices/[officeId]/agents/route');
    const res = await POST(
      makeRequest({ name: 'Jane Smith', email: 'jane@x.com', phone: '0412345678' }, 'Bearer valid'),
      { params: Promise.resolve({ officeId: 'office1' }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.outcome).toBe('created');
    expect(createUserMock.mock.calls[0][0].password).toBeUndefined();
  });

  it('SECURITY: a non-admin cannot add an agent', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    setupValidAuth('intruder');
    const { POST } = await import('../../src/app/api/offices/[officeId]/agents/route');
    const res = await POST(
      makeRequest({ name: 'Jane', email: 'jane@x.com', phone: '0412345678' }, 'Bearer valid'),
      { params: Promise.resolve({ officeId: 'office1' }) }
    );
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/offices/[officeId]/agents/[uid]', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('removes an agent without touching unrelated fields', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.agent1 = { officeId: 'office1', companyName: 'X' };
    setupValidAuth('admin1');
    const { DELETE } = await import('../../src/app/api/offices/[officeId]/agents/[uid]/route');
    const res = await DELETE(makeRequest(undefined, 'Bearer valid', 'DELETE'), { params: Promise.resolve({ officeId: 'office1', uid: 'agent1' }) });
    expect(res.status).toBe(200);
    expect(state.users.agent1.officeId).toBeUndefined();
    expect(state.users.agent1.companyName).toBe('X');
  });

  it('SECURITY: cross-office removal is refused', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    seedOffice('office2', { name: 'Y', officeAdminUids: ['admin2'] });
    state.users.agent1 = { officeId: 'office2' };
    setupValidAuth('admin1');
    const { DELETE } = await import('../../src/app/api/offices/[officeId]/agents/[uid]/route');
    const res = await DELETE(makeRequest(undefined, 'Bearer valid', 'DELETE'), { params: Promise.resolve({ officeId: 'office1', uid: 'agent1' }) });
    expect(res.status).toBe(404);
    expect(state.users.agent1.officeId).toBe('office2'); // untouched
  });
});

describe('POST /api/offices/[officeId]/agents/[uid]/resend', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('SECURITY: a non-admin cannot trigger a resend', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    setupValidAuth('intruder');
    const { POST } = await import('../../src/app/api/offices/[officeId]/agents/[uid]/resend/route');
    const res = await POST(makeRequest(undefined, 'Bearer valid'), { params: Promise.resolve({ officeId: 'office1', uid: 'agent1' }) });
    expect(res.status).toBe(403);
  });

  it('resends an activation link for an invited agent', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.agent1 = { officeId: 'office1', accountStatus: 'invited', email: 'a@x.com', firstName: 'Jo' };
    setupValidAuth('admin1');
    const { POST } = await import('../../src/app/api/offices/[officeId]/agents/[uid]/resend/route');
    const res = await POST(makeRequest(undefined, 'Bearer valid'), { params: Promise.resolve({ officeId: 'office1', uid: 'agent1' }) });
    expect(res.status).toBe(200);
    expect(generatePasswordResetLinkMock).toHaveBeenCalled();
  });
});

describe('POST /api/offices/[officeId]/import/preview + /commit', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('previews without writing anything, then commits and creates agents', async () => {
    seedOffice('office1', { name: 'Harcourts Property Hub', officeAdminUids: ['admin1'] });
    setupValidAuth('admin1');

    const { POST: previewPOST } = await import('../../src/app/api/offices/[officeId]/import/preview/route');
    const csvText = 'Jane Smith,jane@x.com,0412345678\nJohn Doe,john@x.com,0498765432';
    const previewRes = await previewPOST(makeRequest({ csvText }, 'Bearer valid'), { params: Promise.resolve({ officeId: 'office1' }) });
    const previewBody = await previewRes.json();
    expect(previewRes.status).toBe(200);
    expect(previewBody.rows).toHaveLength(2);
    expect(createUserMock).not.toHaveBeenCalled(); // preview writes nothing

    const { POST: commitPOST } = await import('../../src/app/api/offices/[officeId]/import/commit/route');
    const commitRes = await commitPOST(
      makeRequest({ importId: previewBody.importId }, 'Bearer valid'),
      { params: Promise.resolve({ officeId: 'office1' }) }
    );
    const commitBody = await commitRes.json();
    expect(commitRes.status).toBe(200);
    expect(commitBody.summary.created).toBe(2);
    expect(createUserMock).toHaveBeenCalledTimes(2);
  });

  it('SECURITY: a non-admin cannot preview or commit an import for this office', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    setupValidAuth('intruder');
    const { POST: previewPOST } = await import('../../src/app/api/offices/[officeId]/import/preview/route');
    const res = await previewPOST(makeRequest({ csvText: 'a,b@x.com,0412345678' }, 'Bearer valid'), { params: Promise.resolve({ officeId: 'office1' }) });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/offices/[officeId]/branding', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('sets the OFFICE\'s agencyBrandId, never the admin\'s own', async () => {
    seedOffice('office1', { name: 'Harcourts Property Hub', officeAdminUids: ['admin1'] });
    state.users.admin1 = { officeId: 'office1', isOfficeAdmin: true };
    setupValidAuth('admin1');
    const { POST } = await import('../../src/app/api/offices/[officeId]/branding/route');
    const res = await POST(makeRequest({ primary: '#011d47' }, 'Bearer valid'), { params: Promise.resolve({ officeId: 'office1' }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(state.offices.office1.agencyBrandId).toBe(body.brandId);
    expect(state.users.admin1.agencyBrandId).toBeUndefined();
  });

  it('SECURITY: a non-admin cannot set the office\'s branding', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    setupValidAuth('intruder');
    const { POST } = await import('../../src/app/api/offices/[officeId]/branding/route');
    const res = await POST(makeRequest({ primary: '#011d47' }, 'Bearer valid'), { params: Promise.resolve({ officeId: 'office1' }) });
    expect(res.status).toBe(403);
  });
});

describe('GET/POST /api/office-invites/[token]', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('GET is public and returns limited invite info', async () => {
    state.officeInvites.tok1 = { officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com', status: 'pending' };
    const { GET } = await import('../../src/app/api/office-invites/[token]/route');
    const res = await GET(makeRequest(undefined, undefined, 'GET'), { params: Promise.resolve({ token: 'tok1' }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.invite.officeName).toBe('X');
  });

  it('SECURITY: POST accept rejects a uid that does not match the invite target', async () => {
    state.officeInvites.tok1 = { officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com', status: 'pending' };
    setupValidAuth('intruder');
    const { POST } = await import('../../src/app/api/office-invites/[token]/route');
    const res = await POST(makeRequest(undefined, 'Bearer valid'), { params: Promise.resolve({ token: 'tok1' }) });
    expect(res.status).toBe(403);
    expect(state.users.intruder).toBeUndefined();
  });

  it('accepts for the matching uid and sets officeId', async () => {
    state.officeInvites.tok1 = { officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com', status: 'pending' };
    state.users.agentX = {};
    setupValidAuth('agentX');
    const { POST } = await import('../../src/app/api/office-invites/[token]/route');
    const res = await POST(makeRequest(undefined, 'Bearer valid'), { params: Promise.resolve({ token: 'tok1' }) });
    expect(res.status).toBe(200);
    expect(state.users.agentX.officeId).toBe('office1');
  });

  it('REVOCATION: rejects acceptance of a revoked invite with 410', async () => {
    state.officeInvites.tok1 = { officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com', status: 'revoked' };
    state.users.agentX = {};
    setupValidAuth('agentX');
    const { POST } = await import('../../src/app/api/office-invites/[token]/route');
    const res = await POST(makeRequest(undefined, 'Bearer valid'), { params: Promise.resolve({ token: 'tok1' }) });
    expect(res.status).toBe(410);
    expect(state.users.agentX.officeId).toBeUndefined();
  });

  it('EXPIRY: GET reports an old pending invite as expired', async () => {
    state.officeInvites.tok1 = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com',
      status: 'pending', createdAt: { toMillis: () => Date.now() - 8 * 24 * 60 * 60 * 1000 },
    };
    const { GET } = await import('../../src/app/api/office-invites/[token]/route');
    const res = await GET(makeRequest(undefined, undefined, 'GET'), { params: Promise.resolve({ token: 'tok1' }) });
    const body = await res.json();
    expect(body.invite.expired).toBe(true);
  });
});

describe('DELETE /api/offices/[officeId]/agents/[uid] — revocation behavior', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('REVOCATION: disables the Firebase Auth account of a never-activated agent on removal', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.agent1 = { officeId: 'office1', accountStatus: 'invited' };
    setupValidAuth('admin1');
    const { DELETE } = await import('../../src/app/api/offices/[officeId]/agents/[uid]/route');
    const res = await DELETE(makeRequest(undefined, 'Bearer valid', 'DELETE'), { params: Promise.resolve({ officeId: 'office1', uid: 'agent1' }) });
    expect(res.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith('agent1', { disabled: true });
  });

  it('REVOCATION: revokes a pending existing-account invite via the same DELETE route', async () => {
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.officeInvites.office1_agent2 = { officeId: 'office1', targetUid: 'agent2', status: 'pending' };
    setupValidAuth('admin1');
    const { DELETE } = await import('../../src/app/api/offices/[officeId]/agents/[uid]/route');
    const res = await DELETE(makeRequest(undefined, 'Bearer valid', 'DELETE'), { params: Promise.resolve({ officeId: 'office1', uid: 'agent2' }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.revokedInvite).toBe(true);
    expect(state.officeInvites.office1_agent2.status).toBe('revoked');
  });
});

describe('POST /api/offices/activate', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('returns 401 without auth', async () => {
    const { POST } = await import('../../src/app/api/offices/activate/route');
    const res = await POST(makeRequest(undefined, undefined));
    expect(res.status).toBe(401);
  });

  it('flips an invited office account to active', async () => {
    state.users.agent1 = { accountStatus: 'invited' };
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/offices/activate/route');
    const res = await POST(makeRequest(undefined, 'Bearer valid'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.activated).toBe(true);
    expect(state.users.agent1.accountStatus).toBe('active');
  });

  it('is a safe no-op for an ordinary individual agent', async () => {
    state.users.agent1 = { firstName: 'Jo' };
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/offices/activate/route');
    const res = await POST(makeRequest(undefined, 'Bearer valid'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.activated).toBe(false);
  });
});
