import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── fake Firebase Auth ────────────────────────────────────────────────────────
const authState = { users: {}, nextUid: 1, deleted: [], updated: [], sentCodes: 0, failCode: false };
const mockVerifyIdToken = vi.fn();
const authApi = {
  verifyIdToken: (...a) => mockVerifyIdToken(...a),
  async getUserByEmail(email) {
    const u = Object.values(authState.users).find((x) => x.email === email);
    if (!u) { const e = new Error('no user'); e.code = 'auth/user-not-found'; throw e; }
    return u;
  },
  async createUser({ email, displayName }) {
    if (Object.values(authState.users).some((x) => x.email === email)) { const e = new Error('exists'); e.code = 'auth/email-already-exists'; throw e; }
    const uid = `new${authState.nextUid++}`;
    authState.users[uid] = { uid, email, displayName, disabled: false };
    return authState.users[uid];
  },
  async deleteUser(uid) { authState.deleted.push(uid); delete authState.users[uid]; },
  async updateUser(uid, patch) { authState.updated.push({ uid, patch }); Object.assign(authState.users[uid], patch); },
  async generatePasswordResetLink(email) {
    if (authState.failCode) throw new Error('mint failed');
    authState.sentCodes += 1;
    return `https://x.test/__/auth/action?oobCode=CODE${authState.sentCodes}&mode=resetPassword`;
  },
};
vi.mock('firebase-admin/auth', () => ({ getAuth: () => authApi }));

const sentEmails = [];
vi.mock('../../src/app/api/services/resendService', () => ({
  sendLeadershipInviteEmail: vi.fn(async (...args) => { sentEmails.push(args); }),
}));

// ── fake Firestore (equality where-chains, transactions) ─────────────────────
function makeFakeDb() {
  const store = {};
  const col = (name) => (store[name] = store[name] || {});
  const ref = (name, id) => ({ _name: name, id, async get() { const d = col(name)[id]; return { exists: !!d, id, data: () => d && structuredClone(d) }; },
    async set(d) { col(name)[id] = structuredClone(d); }, async update(p) { if (!col(name)[id]) throw new Error('no doc'); Object.assign(col(name)[id], structuredClone(p)); } });
  const query = (name, filters) => ({
    where: (f, op, v) => query(name, [...filters, [f, op, v]]),
    async get() { const docs = Object.entries(col(name)).filter(([, d]) => filters.every(([f, op, v]) => (op === 'array-contains' ? Array.isArray(d[f]) && d[f].includes(v) : d[f] === v))).map(([id, d]) => ({ id, data: () => structuredClone(d) })); return { docs, empty: !docs.length, size: docs.length }; },
  });
  return {
    _store: store,
    _seed(name, id, data) { col(name)[id] = data; },
    collection: (name) => ({ doc: (id) => ref(name, id), ...query(name, []) , get: query(name, []).get }),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: (r) => r.get(),
        set: (r, d) => writes.push(() => r.set(d)),
        update: (r, p) => writes.push(() => r.update(p)),
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  };
}
let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => fakeDb[p] }) }));

const NOW = new Date('2026-11-04T03:00:00Z');
const req = (url, { method = 'POST', token = 't', body } = {}) =>
  new Request(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const as = (uid, email) => mockVerifyIdToken.mockResolvedValue({ uid, email: email ?? authState.users[uid]?.email ?? null });

function seed() {
  fakeDb = makeFakeDb();
  Object.assign(authState, { users: {}, nextUid: 1, deleted: [], updated: [], sentCodes: 0, failCode: false });
  sentEmails.length = 0;
  fakeDb._seed('officeAdminInfo', 'hph', { name: 'Harcourts Property Hub', status: 'active', officeAdminUids: ['hphAdmin'], leadershipUids: [] });
  fakeDb._seed('officeAdminInfo', 'other', { name: 'Other Office', status: 'active', leadershipUids: [] });
  fakeDb._seed('officeAdminInfo', 'dead', { name: 'Dead Office', status: 'disabled' });
  const user = (uid, email, data) => { authState.users[uid] = { uid, email, disabled: false }; fakeDb._seed('users', uid, { email, ...data }); };
  user('root', 'root@x.test', { firstName: 'Root', superAdmin: true });
  user('hphAdmin', 'hannah@x.test', { firstName: 'Hannah', officeId: 'hph', isOfficeAdmin: true, isAgent: true });
  user('agentA', 'agenta@x.test', { firstName: 'Ann', lastName: 'Agent', officeId: 'hph', isAgent: true });
  user('solo', 'solo@x.test', { firstName: 'Solo', roles: ['agent'], isAgent: true, pro: true });
  user('buyer', 'buyer@x.test', { firstName: 'Bea', roles: ['buyer'], isBuyer: true });
  user('inOther', 'inother@x.test', { firstName: 'Olly', officeId: 'other', isAgent: true });
  user('someLeader', 'someleader@x.test', { firstName: 'Lee', roles: ['leadership'] });
  fakeDb._seed('officeAdminInfo', 'other', { name: 'Other Office', status: 'active', leadershipUids: ['someLeader'] });
  authState.users.nodoc = { uid: 'nodoc', email: 'nodoc@x.test', disabled: false };
}

beforeEach(() => { seed(); vi.clearAllMocks(); delete process.env.VERCEL_ENV; });
afterEach(() => { delete process.env.VERCEL_ENV; });

const svc = () => import('../../src/app/api/services/leadershipInviteService');
const invite = async (over = {}) => (await svc()).createLeadershipInvite(fakeDb, authApi,
  { officeId: 'hph', email: 'David@HPH.test', firstName: 'David', lastName: 'Manby', actorUid: 'root', ...over }, NOW);

describe('POST /api/admin/leadership/invitations (superAdmin only)', () => {
  const call = async (uid, body, opts) => {
    if (uid) as(uid);
    const { POST } = await import('../../src/app/api/admin/leadership/invitations/route.js');
    return POST(req('http://localhost/api/admin/leadership/invitations', { body, ...opts }));
  };
  const BODY = { officeId: 'hph', email: 'david@hph.test', firstName: 'David', lastName: 'Manby' };

  it('rejects unauthenticated callers (401) and every non-superAdmin (403): agents, office admins, leaders, buyers', async () => {
    expect((await call(null, BODY, { token: null })).status).toBe(401);
    for (const uid of ['hphAdmin', 'agentA', 'solo', 'buyer', 'someLeader']) {
      const res = await call(uid, BODY);
      expect(res.status).toBe(403);
    }
    expect(fakeDb._store.leadershipInvites).toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  it('a superAdmin can invite; the token is emailed but never returned or stored in clear', async () => {
    const res = await call('root', BODY);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body).toEqual({ inviteId: expect.any(String), mode: 'new', emailSent: true });
    expect(JSON.stringify(body)).not.toMatch(/token|leadership-invite/i);
    expect(sentEmails).toHaveLength(1);
    const [to, first, officeName, link, opts] = sentEmails[0];
    expect([to, first, officeName, opts]).toEqual(['david@hph.test', 'David', 'Harcourts Property Hub', { existing: false }]);
    const token = new URL(link).searchParams.get('t');
    expect(token.length).toBeGreaterThan(30);
    const stored = JSON.stringify(fakeDb._store.leadershipInvites);
    expect(stored).not.toContain(token); // only the hash is stored
    expect(Object.keys(fakeDb._store.leadershipInvites)[0]).toBe((await svc()).hashToken(token));
    // an invitation creates no account and grants nothing
    expect(Object.values(authState.users).some((u) => u.email === 'david@hph.test')).toBe(false);
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toEqual([]);
  });

  it('validates input and the office', async () => {
    expect((await call('root', { ...BODY, email: 'not-an-email' })).status).toBe(400);
    expect((await call('root', { ...BODY, firstName: '  ' })).status).toBe(400);
    expect((await call('root', { ...BODY, officeId: 'nope' })).status).toBe(404);
    expect((await call('root', { ...BODY, officeId: 'dead' })).status).toBe(409);
    expect((await call('root', { ...BODY, officeId: undefined })).status).toBe(400);
  });

  it('is refused on Preview deployments (shared production data), without sending anything', async () => {
    process.env.VERCEL_ENV = 'preview';
    const res = await call('root', BODY);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Preview/);
    expect(fakeDb._store.leadershipInvites).toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  it('still reports success when the email provider fails, without leaking the link', async () => {
    const { sendLeadershipInviteEmail } = await import('../../src/app/api/services/resendService');
    sendLeadershipInviteEmail.mockRejectedValueOnce(new Error('resend down'));
    const body = await (await call('root', BODY)).json();
    expect(body.emailSent).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/leadership-invite|token/i);
  });
});

describe('existing accounts are never overwritten', () => {
  it.each([
    ['an agent with no office', 'solo@x.test', 'agent'],
    ['an office member', 'agenta@x.test', 'agent'],
    ['a buyer', 'buyer@x.test', 'buyer only'],
  ])('%s needs explicit approval before an invitation is created', async (_n, email, roles) => {
    await expect(invite({ email })).rejects.toMatchObject({ status: 409, extra: { existing: { email, roles } } });
    expect(fakeDb._store.leadershipInvites).toBeUndefined();
  });

  it('with approval it creates an "existing" invitation and still changes nothing about the account', async () => {
    const before = JSON.stringify([fakeDb._store.users.solo, authState.users.solo]);
    const inv = await invite({ email: 'solo@x.test', approveExisting: true });
    expect(inv.mode).toBe('existing');
    expect(JSON.stringify([fakeDb._store.users.solo, authState.users.solo])).toBe(before);
    expect(authState.updated).toEqual([]);
  });

  it('refuses an account in another office, a disabled one, one with no profile, and one already a leader', async () => {
    await expect(invite({ email: 'inother@x.test', approveExisting: true })).rejects.toThrow(/different office/);
    authState.users.solo.disabled = true;
    await expect(invite({ email: 'solo@x.test', approveExisting: true })).rejects.toThrow(/disabled/);
    await expect(invite({ email: 'nodoc@x.test', approveExisting: true })).rejects.toThrow(/no Premarket profile/);
    fakeDb._seed('officeAdminInfo', 'hph', { name: 'HPH', status: 'active', leadershipUids: ['agentA'] });
    await expect(invite({ email: 'agenta@x.test', approveExisting: true })).rejects.toThrow(/already has leadership access/);
  });

  it('acceptance requires the invited person to be signed in as themselves; a different user does not burn the token', async () => {
    const inv = await invite({ email: 'solo@x.test', approveExisting: true });
    const { acceptExistingAccountInvite, hashToken } = await svc();
    await expect(acceptExistingAccountInvite(fakeDb, inv.token, { uid: 'agentA', email: 'agenta@x.test' }, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(acceptExistingAccountInvite(fakeDb, inv.token, { uid: null, email: null }, NOW)).rejects.toMatchObject({ status: 403 });
    expect(fakeDb._store.leadershipInvites[hashToken(inv.token)].status).toBe('pending');
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toEqual([]);

    const before = JSON.stringify([fakeDb._store.users.solo, authState.users.solo]);
    await acceptExistingAccountInvite(fakeDb, inv.token, { uid: 'solo', email: 'solo@x.test' }, NOW);
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toEqual(['solo']);
    expect(JSON.stringify([fakeDb._store.users.solo, authState.users.solo])).toBe(before); // role, profile, office untouched
    expect(fakeDb._store.users.solo.officeId).toBeUndefined();
  });

  it('the accept route needs a signed-in session and the token only works as the invited email', async () => {
    const inv = await invite({ email: 'solo@x.test', approveExisting: true });
    const { POST } = await import('../../src/app/api/leadership-activation/accept/route.js');
    const url = 'http://localhost/api/leadership-activation/accept';
    expect((await POST(req(url, { token: null, body: { token: inv.token } }))).status).toBe(401);
    as('buyer'); expect((await POST(req(url, { body: { token: inv.token } }))).status).toBe(403);
    as('solo'); const ok = await POST(req(url, { body: { token: inv.token } }));
    expect(ok.status).toBe(200);
    expect((await POST(req(url, { body: { token: inv.token } }))).status).toBe(410); // single use
  });
});

describe('new-account activation', () => {
  const activate = async (token) => (await svc()).redeemNewAccountInvite(fakeDb, authApi, token, { baseUrl: 'https://premarket.homes' }, NOW);

  it('creates a leadership-only account with no office, agent role, billing or campaign fields, and grants only the invited office', async () => {
    const inv = await invite();
    const out = await activate(inv.token);
    expect(out).toEqual({ oobCode: 'CODE1', email: 'david@hph.test' });
    const uid = Object.values(authState.users).find((u) => u.email === 'david@hph.test').uid;
    const doc = fakeDb._store.users[uid];
    expect(doc).toMatchObject({ firstName: 'David', lastName: 'Manby', email: 'david@hph.test', roles: ['leadership'], createdVia: 'leadership-invite' });
    for (const forbidden of ['officeId', 'isOfficeAdmin', 'agent', 'isAgent', 'isBuyer', 'pro', 'availableCampaigns', 'companyName', 'superAdmin', 'accountStatus', 'agencyBrandId', 'billingEntity']) {
      expect(doc).not.toHaveProperty(forbidden);
    }
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toEqual([uid]);
    expect(fakeDb._store.officeAdminInfo.hph.officeAdminUids).toEqual(['hphAdmin']); // not an office admin
    expect(fakeDb._store.officeAdminInfo.other.leadershipUids).toEqual(['someLeader']); // other office untouched
  });

  it('the token is single use, including concurrent attempts', async () => {
    const inv = await invite();
    const [a, b] = await Promise.allSettled([activate(inv.token), activate(inv.token)]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    await expect(activate(inv.token)).rejects.toMatchObject({ status: 410 });
    expect(Object.values(authState.users).filter((u) => u.email === 'david@hph.test')).toHaveLength(1);
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toHaveLength(1);
  });

  it('expires after 7 days, and unknown/garbled tokens are a generic 404', async () => {
    const inv = await invite();
    const { redeemNewAccountInvite, inspectLeadershipInvite, INVITE_TTL_MS } = await svc();
    const late = new Date(NOW.getTime() + INVITE_TTL_MS + 1000);
    await expect(redeemNewAccountInvite(fakeDb, authApi, inv.token, { baseUrl: 'x' }, late)).rejects.toMatchObject({ status: 410 });
    await expect(inspectLeadershipInvite(fakeDb, inv.token, late)).rejects.toMatchObject({ status: 410 });
    const justBefore = new Date(NOW.getTime() + INVITE_TTL_MS - 1000);
    await expect(inspectLeadershipInvite(fakeDb, inv.token, justBefore)).resolves.toMatchObject({ firstName: 'David' });
    for (const bad of [undefined, '', 'short', 'x'.repeat(300), 'a'.repeat(43)]) {
      await expect(inspectLeadershipInvite(fakeDb, bad, NOW)).rejects.toMatchObject({ status: 404 });
    }
    expect(Object.values(authState.users).some((u) => u.email === 'david@hph.test')).toBe(false);
  });

  it('inspecting a link changes nothing (scanners and previews open links)', async () => {
    const inv = await invite();
    const before = JSON.stringify(fakeDb._store);
    const { inspectLeadershipInvite } = await svc();
    expect(await inspectLeadershipInvite(fakeDb, inv.token, NOW)).toEqual({ firstName: 'David', email: 'david@hph.test', officeName: 'Harcourts Property Hub', mode: 'new' });
    expect(JSON.stringify(fakeDb._store)).toBe(before);
    expect(Object.keys(authState.users).some((u) => u.startsWith('new'))).toBe(false);
  });

  it('a newer invitation replaces the older one for the same person and office', async () => {
    const first = await invite();
    const second = await invite();
    await expect(activate(first.token)).rejects.toMatchObject({ status: 410 });
    await expect(activate(second.token)).resolves.toMatchObject({ oobCode: expect.any(String) });
  });

  it('a revoked invitation cannot be used', async () => {
    const inv = await invite();
    const { revokeInvite } = await svc();
    await revokeInvite(fakeDb, { officeId: 'hph', inviteId: inv.inviteId, actorUid: 'root' }, NOW);
    await expect(activate(inv.token)).rejects.toMatchObject({ status: 410 });
    expect(Object.values(authState.users).some((u) => u.email === 'david@hph.test')).toBe(false);
  });

  it('cannot reach another office: the office is fixed by the invitation, not by the request', async () => {
    const inv = await invite({ officeId: 'hph' });
    await activate(inv.token);
    expect(fakeDb._store.officeAdminInfo.other.leadershipUids).toEqual(['someLeader']);
    const { POST } = await import('../../src/app/api/leadership-activation/route.js');
    const inv2 = await invite({ email: 'trevor@hph.test', firstName: 'Trevor', lastName: 'T' });
    const res = await POST(req('http://localhost/api/leadership-activation', { token: null, body: { token: inv2.token, intent: 'continue', officeId: 'other', uid: 'agentA' } }));
    expect(res.status).toBe(200);
    expect(fakeDb._store.officeAdminInfo.other.leadershipUids).toEqual(['someLeader']);
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toHaveLength(2);
    expect(fakeDb._store.users.agentA.roles).toBeUndefined(); // no one else's account was touched
  });

  it('if the office is disabled after inviting, activation fails and leaves no stray account', async () => {
    const inv = await invite();
    fakeDb._seed('officeAdminInfo', 'hph', { name: 'HPH', status: 'disabled', leadershipUids: [] });
    await expect(activate(inv.token)).rejects.toMatchObject({ status: 404 });
    expect(Object.values(authState.users).some((u) => u.email === 'david@hph.test')).toBe(false);
  });

  it('if an account for the email appeared since inviting, it refuses and changes nothing', async () => {
    const inv = await invite();
    authState.users.late = { uid: 'late', email: 'david@hph.test', disabled: false };
    await expect(activate(inv.token)).rejects.toMatchObject({ status: 409 });
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toEqual([]);
  });

  it('if the password code cannot be minted, access exists and the person is told to use password reset', async () => {
    authState.failCode = true;
    const out = await activate((await invite()).token);
    expect(out).toEqual({ needsPasswordReset: true, email: 'david@hph.test' });
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toHaveLength(1);
  });

  it('is refused on Preview deployments', async () => {
    const inv = await invite();
    process.env.VERCEL_ENV = 'preview';
    await expect(activate(inv.token)).rejects.toMatchObject({ status: 403 });
    expect(Object.values(authState.users).some((u) => u.email === 'david@hph.test')).toBe(false);
  });
});

describe('role separation and landing', () => {
  it('leadership-only accounts land on the Hub; agents, buyers and mixed accounts do not', async () => {
    const { isLeadershipOnly, defaultDashboardFor } = await import('../../src/app/utils/roles');
    expect(defaultDashboardFor({ roles: ['leadership'] })).toBe('/dashboard/leadership');
    expect(defaultDashboardFor({ roles: ['leadership', 'agent'] })).toBe('/dashboard');
    expect(defaultDashboardFor({ roles: ['leadership'], isBuyer: true })).toBe('/buyer-dashboard');
    expect(defaultDashboardFor({ roles: ['agent'] })).toBe('/dashboard');
    expect(defaultDashboardFor({ roles: ['buyer'] })).toBe('/buyer-dashboard');
    expect(defaultDashboardFor({})).toBe('/dashboard');
    expect(isLeadershipOnly({ roles: ['leadership'] })).toBe(true);
    expect(isLeadershipOnly({ roles: ['leadership'], isAgent: true })).toBe(false);
    expect(isLeadershipOnly(null)).toBe(false);
  });

  it('a leadership-only account is never counted in the Hub rankings, adoption or attention lists, even if linked to the office', async () => {
    const { buildLeadershipData } = await import('../../src/app/api/services/leadershipMetrics');
    const members = [
      { uid: 'ann', firstName: 'Ann', accountStatus: 'active', isAgent: true },
      { uid: 'lead', firstName: 'David', roles: ['leadership'], officeId: 'hph' },
    ];
    const data = buildLeadershipData({ members, properties: [], opinions: [], now: NOW });
    expect(data.agents.map((a) => a.uid)).toEqual(['ann']);
    expect(data.leaderboard.all.map((r) => r.uid)).toEqual(['ann']);
    expect(data.overview.agentsTotal).toBe(1);
    expect(JSON.stringify(data.attention)).not.toContain('lead');
  });

  it('after activation the new leader passes the Hub check, and an ordinary agent still does not', async () => {
    const out = await (await svc()).redeemNewAccountInvite(fakeDb, authApi, (await invite()).token, { baseUrl: 'x' }, NOW);
    expect(out.oobCode).toBeTruthy();
    const uid = Object.values(authState.users).find((u) => u.email === 'david@hph.test').uid;
    const { requireLeadership } = await import('../../src/app/api/services/leadershipService');
    await expect(requireLeadership(fakeDb, uid)).resolves.toMatchObject({ officeId: 'hph' });
    await expect(requireLeadership(fakeDb, 'agentA')).rejects.toMatchObject({ status: 403 });
    expect(fakeDb._store.users[uid].officeId).toBeUndefined(); // so office billing and the roster never see them
  });
});

describe('revocation', () => {
  const grant = async (email = 'david@hph.test') => {
    const out = await (await svc()).redeemNewAccountInvite(fakeDb, authApi, (await invite({ email })).token, { baseUrl: 'x' }, NOW);
    return Object.values(authState.users).find((u) => u.email === out.email).uid;
  };
  const call = async (uid, body) => {
    as(uid);
    const { POST } = await import('../../src/app/api/admin/leadership/revoke/route.js');
    return POST(req('http://localhost/api/admin/leadership/revoke', { body }));
  };

  it('only a superAdmin can revoke; others are refused and nothing changes', async () => {
    const uid = await grant();
    for (const who of ['hphAdmin', 'agentA', 'someLeader', uid]) expect((await call(who, { officeId: 'hph', uid })).status).toBe(403);
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toEqual([uid]);
  });

  it('removes access immediately: the Hub check then denies, and only that office is affected', async () => {
    const uid = await grant();
    const { requireLeadership } = await import('../../src/app/api/services/leadershipService');
    await expect(requireLeadership(fakeDb, uid)).resolves.toBeTruthy();
    const res = await call('root', { officeId: 'hph', uid });
    expect(await res.json()).toEqual({ revoked: true, disabledAccount: false });
    await expect(requireLeadership(fakeDb, uid)).rejects.toMatchObject({ status: 403 });
    expect(fakeDb._store.officeAdminInfo.other.leadershipUids).toEqual(['someLeader']);
    expect(authState.updated).toEqual([]); // the login is left alone by default
  });

  it('cannot revoke someone else\'s office access by naming the wrong office, and unknown people are 404', async () => {
    const uid = await grant();
    expect((await call('root', { officeId: 'other', uid })).status).toBe(404);
    expect((await call('root', { officeId: 'hph', uid: 'ghost' })).status).toBe(404);
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toEqual([uid]);
  });

  it('can also disable the sign-in of a leadership-only account', async () => {
    const uid = await grant();
    const body = await (await call('root', { officeId: 'hph', uid, disableAccount: true })).json();
    expect(body).toEqual({ revoked: true, disabledAccount: true });
    expect(authState.updated).toEqual([{ uid, patch: { disabled: true } }]);
  });

  it('refuses to disable a real agent or office member, but still removes their leadership access', async () => {
    fakeDb._seed('officeAdminInfo', 'hph', { name: 'HPH', status: 'active', leadershipUids: ['solo', 'agentA'] });
    for (const uid of ['solo', 'agentA']) {
      const res = await call('root', { officeId: 'hph', uid, disableAccount: true });
      expect(res.status).toBe(409);
      expect((await res.json()).accessRemoved).toBe(true);
    }
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toEqual([]);
    expect(authState.updated).toEqual([]);
    expect(authState.users.solo.disabled).toBe(false);
  });

  it('cancels that person\'s pending invitations to the office', async () => {
    const uid = await grant();
    const pending = await invite({ email: 'david@hph.test', approveExisting: true }).catch(() => null);
    // (an existing leader can't be re-invited; seed a pending invite for them directly)
    fakeDb._seed('leadershipInvites', 'h1', { inviteId: 'i1', officeId: 'hph', email: 'david@hph.test', status: 'pending', expiresAtMs: NOW.getTime() + 1e6, firstName: 'D', lastName: '' });
    expect(pending).toBeNull();
    await call('root', { officeId: 'hph', uid });
    expect(fakeDb._store.leadershipInvites.h1.status).toBe('revoked');
  });

  it('revoking is refused on Preview deployments', async () => {
    const uid = await grant();
    process.env.VERCEL_ENV = 'preview';
    expect((await call('root', { officeId: 'hph', uid })).status).toBe(403);
    expect(fakeDb._store.officeAdminInfo.hph.leadershipUids).toEqual([uid]);
  });

  it('every grant, invite and revoke is written to the audit log without any token', async () => {
    const uid = await grant();
    await call('root', { officeId: 'hph', uid });
    const log = Object.values(fakeDb._store.leadershipAudit).map((e) => e.type);
    expect(log).toEqual(expect.arrayContaining(['invite-created', 'invite-accepted', 'leadership-revoked']));
    expect(JSON.stringify(fakeDb._store.leadershipAudit)).not.toMatch(/token/i);
  });
});

describe('GET /api/admin/leadership', () => {
  it('superAdmin only; lists offices, leaders and invitations but never tokens or hashes', async () => {
    const inv = await invite();
    const { GET } = await import('../../src/app/api/admin/leadership/route.js');
    as('hphAdmin'); expect((await GET(req('http://localhost/x', { method: 'GET' }))).status).toBe(403);
    as('someLeader'); expect((await GET(req('http://localhost/x', { method: 'GET' }))).status).toBe(403);
    as('root');
    const res = await GET(req('http://localhost/x', { method: 'GET' }));
    const body = await res.json();
    const hph = body.offices.find((o) => o.id === 'hph');
    expect(hph.invites[0]).toMatchObject({ email: 'david@hph.test', status: 'pending', mode: 'new' });
    expect(body.offices.find((o) => o.id === 'other').leaders[0]).toMatchObject({ uid: 'someLeader', leadershipOnly: true });
    const text = JSON.stringify(body);
    expect(text).not.toContain(inv.token);
    expect(text).not.toContain((await svc()).hashToken(inv.token));
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });
});

describe('static guarantees', () => {
  const read = (f) => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('the invitation service never touches officeId, billing, invoicing, Xero, roles of existing users or superAdmin', () => {
    const src = read('src/app/api/services/leadershipInviteService.js');
    expect(src).not.toMatch(/billing|invoice|xero|officeAdminUids|isOfficeAdmin|setCustomUserClaims|updateUser\([^)]*(password|email|roles)/i);
    expect(src).not.toMatch(/users'\)\.doc\([^)]*\)\.(update|set)/); // user documents are only written inside the activation transaction
    expect(src).not.toMatch(/officeId:\s*invite\.officeId[^}]*roles/);
  });
  it('the public activation routes never accept an office id or uid from the client', () => {
    for (const f of ['src/app/api/leadership-activation/route.js', 'src/app/api/leadership-activation/accept/route.js']) {
      const src = read(f);
      expect(src).not.toMatch(/\{[^}]*\b(officeId|uid)\b[^}]*\}\s*=\s*await request\.json/);
    }
  });
  it('admin routes all call verifyAdmin first', () => {
    for (const f of ['route.js', 'invitations/route.js', 'invitations/revoke/route.js', 'revoke/route.js']) {
      const src = read(`src/app/api/admin/leadership/${f}`);
      expect(src).toMatch(/verifyAdmin/);
      expect(src.indexOf('verifyAdmin(request)')).toBeLessThan(src.indexOf('await request.json') === -1 ? Infinity : src.indexOf('await request.json'));
    }
  });
});
