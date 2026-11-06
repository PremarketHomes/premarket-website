import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const store = new Map();
let autoId = 0;
const accessed = new Set();
function docRef(path) {
  const id = path.split('/').pop();
  return {
    id, path,
    get: async () => (store.has(path) ? { exists: true, id, ref: docRef(path), data: () => store.get(path) } : { exists: false, id }),
    set: async (d) => { store.set(path, { ...d }); },
    update: async (p) => {
      const cur = { ...store.get(path) };
      for (const [k, v] of Object.entries(p)) { if (v === 'DEL') delete cur[k]; else cur[k] = v; }
      store.set(path, cur);
    },
    delete: async () => { store.delete(path); },
  };
}
function colRef(name, filters = []) {
  accessed.add(name);
  return {
    doc: (id) => docRef(`${name}/${id || `auto${++autoId}`}`),
    where: (f, op, v) => colRef(name, [...filters, [f, v]]),
    get: async () => ({
      docs: [...store.entries()].filter(([p]) => p.startsWith(`${name}/`) && p.split('/').length === 2)
        .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
        .map(([p, d]) => ({ id: p.split('/')[1], ref: docRef(p), data: () => d })),
    }),
  };
}
const authSpies = { verifyIdToken: vi.fn(), getUserByEmail: vi.fn(), createUser: vi.fn(), updateUser: vi.fn() };
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (n) => colRef(n),
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: (x) => x.get(),
        set: (r, d) => writes.push(() => r.set(d)),
        update: (r, p) => writes.push(() => r.update(p)),
        delete: (r) => writes.push(() => r.delete()),
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => authSpies }));
vi.mock('../../src/app/api/services/resendService', () => ({ sendTeamInviteEmail: vi.fn() }));
vi.mock('../../src/app/api/services/billingService', () => ({ settleChargesForAgent: vi.fn(), recordOfficeDeparture: vi.fn() }));
vi.mock('../../src/app/api/services/officeImportService', () => ({ listStagedAgents: async () => [{ uid: null, name: 'Sam Staged', email: 'sam@hph.com', status: 'staged' }] }));

import { POST as removeAgent } from '../../src/app/api/offices/[officeId]/agent-removals/route';
import { GET as directory } from '../../src/app/api/offices/[officeId]/agent-directory/route';
import { excludeRemoved } from '../../src/app/api/services/officeAgentRemovals';

const agent = (n, extra = {}) => ({ firstName: n, lastName: 'X', email: `${n.toLowerCase()}@hph.com`, agent: true, officeId: 'hph', accountStatus: 'active', ...extra });
function seed() {
  store.clear(); accessed.clear();
  store.set('offices/hph', {}); store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah'], status: 'active' });
  store.set('offices/other', {}); store.set('officeAdminInfo/other', { name: 'Other', officeAdminUids: ['otheradmin'], status: 'active' });
  store.set('users/hannah', agent('Hannah', { isOfficeAdmin: true }));
  for (const n of ['ann', 'bob', 'cat', 'dan', 'eve', 'fay']) store.set(`users/${n}`, agent(n[0].toUpperCase() + n.slice(1)));
  store.set('users/ivy', agent('Ivy', { accountStatus: 'invited' }));
  store.set('users/olly', agent('Olly', { officeId: 'other' }));
  store.set('teams/t1', { officeId: 'hph', createdBy: 'ann' }); // ann, bob, cat
  store.set('teams/t2', { officeId: 'hph', createdBy: 'dan' }); // dan, eve (two-person)
  for (const [u, t] of [['ann', 't1'], ['bob', 't1'], ['cat', 't1'], ['dan', 't2'], ['eve', 't2']]) store.set(`users/${u}`, { ...store.get(`users/${u}`), teamId: t });
  store.set('properties/live1', { userId: 'fay', archived: false });
  store.set('properties/old1', { userId: 'cat', archived: true });
  store.set('billingItems/b1', { agentUid: 'cat', amount: 100 });
  store.set('propertyCharges/c1', { agentUid: 'cat', amount: 200 });
  store.set('officeInvites/hph_ivy', { officeId: 'hph', targetUid: 'ivy', targetEmail: 'ivy@hph.com', status: 'pending' });
  store.set('officeAgents/prof1', { officeId: 'hph', linkedUid: 'cat', emailKey: 'cat@hph.com', fullName: 'Cat Pro' });
  store.set('officeImports/imp1', { officeId: 'hph', status: 'staged', rows: [{ rowIndex: 0, name: 'Sam Staged', email: 'sam@hph.com', previewStatus: 'new' }] });
}
const call = (uid, key, officeId = 'hph') => {
  authSpies.verifyIdToken.mockResolvedValue({ uid });
  const req = new Request('http://localhost/t', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
  return removeAgent(req, { params: Promise.resolve({ officeId }) });
};
const dir = async (uid = 'hannah') => {
  authSpies.verifyIdToken.mockResolvedValue({ uid });
  const r = await directory(new Request('http://localhost/t', { headers: { authorization: 'Bearer t' } }), { params: Promise.resolve({ officeId: 'hph' }) });
  return r.json();
};
const json = async (r) => ({ status: r.status, ...(await r.json()) });
beforeEach(seed);

describe('Remove Agent', () => {
  it('removes an active agent and their profile from the directory, leaves the team, and keeps every other record', async () => {
    const before = { auth: authSpies.updateUser.mock.calls.length };
    const r = await json(await call('hannah', 'p:prof1'));
    expect(r).toMatchObject({ status: 200, removed: true, leftTeam: true });
    const d = await dir();
    expect(d.agents.find((a) => a.uid === 'cat')).toBeUndefined();
    expect(store.get('users/cat').teamId).toBeUndefined();
    expect(store.get('teams/t1')).toBeDefined(); // still ann + bob
    // nothing deleted or changed elsewhere
    expect(store.get('users/cat')).toMatchObject({ officeId: 'hph', accountStatus: 'active' });
    expect(store.get('billingItems/b1')).toEqual({ agentUid: 'cat', amount: 100 });
    expect(store.get('propertyCharges/c1')).toEqual({ agentUid: 'cat', amount: 200 });
    expect(store.get('properties/old1')).toEqual({ userId: 'cat', archived: true });
    expect(store.get('officeAgents/prof1')).toBeDefined();
    expect(authSpies.updateUser.mock.calls.length).toBe(before.auth); // Auth never touched
    // audit: who and when
    const rec = [...store.entries()].find(([p]) => p.startsWith('officeAgentRemovals/'))[1];
    expect(rec).toMatchObject({ officeId: 'hph', status: 'removed', uid: 'cat', removedBy: 'hannah', removedAt: 'TS' });
    expect([...store.values()].some((v) => v.action === 'agent.remove' && v.actorUid === 'hannah')).toBe(true);
  });

  it('removes an invited, never-activated agent: hidden, pending invite revoked, Auth untouched', async () => {
    const r = await json(await call('hannah', 'u:ivy'));
    expect(r.status).toBe(200);
    expect((await dir()).agents.find((a) => a.uid === 'ivy')).toBeUndefined();
    expect(store.get('officeInvites/hph_ivy').status).toBe('revoked');
    expect(store.get('users/ivy')).toBeDefined();
    expect(authSpies.updateUser).not.toHaveBeenCalled();
  });

  it('removes a staged CSV row so it is hidden and "Send all" skips it', async () => {
    const r = await json(await call('hannah', 'e:sam@hph.com'));
    expect(r.status).toBe(200);
    const row = store.get('officeImports/imp1').rows[0];
    expect(row).toMatchObject({ commitOutcome: 'skipped' });
  });

  it('a removed agent does not reappear on later directory loads', async () => {
    await call('hannah', 'u:bob');
    expect((await dir()).agents.some((a) => a.uid === 'bob')).toBe(false);
    expect((await dir()).agents.some((a) => a.uid === 'ann')).toBe(true);
  });

  it('is refused for non-admins, other-office admins and unauthenticated callers, and changes nothing', async () => {
    for (const uid of ['ann', 'bob', 'fay', 'olly', 'otheradmin']) {
      const r = await json(await call(uid, 'u:bob'));
      expect([403, 404]).toContain(r.status);
    }
    expect([...store.keys()].some((p) => p.startsWith('officeAgentRemovals/'))).toBe(false);
    expect(store.get('users/bob').teamId).toBe('t1');
  });

  it('refuses an agent with an active campaign and explains why', async () => {
    const r = await json(await call('hannah', 'u:fay'));
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/1 active campaign/);
    expect((await dir()).agents.some((a) => a.uid === 'fay')).toBe(true);
  });

  it('refuses a team administrator, a member of a two-person team, an office administrator and yourself', async () => {
    expect((await json(await call('hannah', 'u:ann'))).error).toMatch(/administrator of/);
    expect((await json(await call('hannah', 'u:eve'))).error).toMatch(/dissolve/);
    expect((await json(await call('hannah', 'u:hannah'))).status).toBe(409);
    store.set('users/zed', agent('Zed', { isOfficeAdmin: true }));
    store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah', 'zed'], status: 'active' });
    expect((await json(await call('hannah', 'u:zed'))).error).toMatch(/office administrator/);
    expect(store.get('users/eve').teamId).toBe('t2');
    expect(store.get('teams/t1').createdBy).toBe('ann');
  });

  it('cannot reach into another office', async () => {
    expect((await json(await call('hannah', 'u:olly'))).status).toBe(404);
  });
});

describe('removed agents stay removed', () => {
  it('excludeRemoved drops users, invites, staged rows and profiles by uid, profile id or any email', () => {
    const set = { uids: new Set(['u1']), emails: new Set(['x@a.com']), profileIds: new Set(['p9']) };
    const out = excludeRemoved({
      users: [{ uid: 'u1', email: 'a@a.com' }, { uid: 'u2', email: 'X@a.com' }, { uid: 'u3', email: 'ok@a.com' }],
      invites: [{ targetUid: 'u1' }, { targetEmail: 'x@A.com' }, { targetEmail: 'ok@a.com' }],
      staged: [{ email: 'x@a.com' }, { email: 'ok@a.com' }],
      profiles: [{ id: 'p9' }, { id: 'p8', linkedUid: 'u1' }, { id: 'p7', emailKey: 'x@a.com' }, { id: 'p6', contactEmail: 'ok@a.com' }],
    }, set);
    expect(out.users.map((u) => u.uid)).toEqual(['u3']);
    expect(out.invites).toHaveLength(1);
    expect(out.staged).toHaveLength(1);
    expect(out.profiles.map((p) => p.id)).toEqual(['p6']);
  });

  it('the CSV classifier, single-add path and resend all consult the removal marker', () => {
    const imp = readFileSync('src/app/api/services/officeImportService.js', 'utf8');
    expect(imp).toMatch(/previously-removed/);
    expect(imp).toMatch(/isRemovedEmail\(await loadRemovedSet\(officeId\), email\)/);
    expect(imp).toMatch(/isRemovedUid\(await loadRemovedSet\(officeId\), targetUid\)/);
  });

  it('the Agents page puts Remove Agent in a menu with the specified confirmation and updates the list', () => {
    const ui = readFileSync('src/app/dashboard/office/agents/page.js', 'utf8');
    expect(ui).toMatch(/Remove Agent/);
    expect(ui).toMatch(/They will no longer appear in the office agent directory\./);
    expect(ui).toMatch(/\/agent-removals/);
  });
});
