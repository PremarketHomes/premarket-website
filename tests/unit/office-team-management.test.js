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

import { GET as listTeams, POST as createTeam } from '../../src/app/api/offices/[officeId]/teams/route';
import { PATCH as patchTeam } from '../../src/app/api/offices/[officeId]/teams/[teamId]/route';
import { POST as addMember } from '../../src/app/api/offices/[officeId]/teams/[teamId]/members/route';
import { PATCH as moveMember, DELETE as removeMember } from '../../src/app/api/offices/[officeId]/teams/members/[uid]/route';

const agent = (n, extra = {}) => ({ firstName: n, lastName: 'X', email: `${n.toLowerCase()}@hph.com`, agent: true, officeId: 'hph', accountStatus: 'active', ...extra });
function seed() {
  store.clear(); accessed.clear();
  store.set('offices/hph', {}); store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah'], status: 'active' });
  store.set('offices/other', {}); store.set('officeAdminInfo/other', { name: 'Other', officeAdminUids: ['otheradmin'], status: 'active' });
  store.set('users/hannah', agent('Hannah', { isOfficeAdmin: true }));
  for (const n of ['ann', 'bob', 'cat', 'dan', 'eve']) store.set(`users/${n}`, agent(n[0].toUpperCase() + n.slice(1)));
  store.set('users/ivy', agent('Ivy', { accountStatus: 'invited' }));
  store.set('users/olly', agent('Olly', { officeId: 'other' }));
  store.set('users/otheradmin', agent('OtherAdmin', { officeId: 'other', isOfficeAdmin: true }));
  // team t1: ann (creator), bob, cat ; team t2: dan (creator), eve
  store.set('teams/t1', { officeId: 'hph', createdBy: 'ann' });
  store.set('teams/t2', { officeId: 'hph', createdBy: 'dan' });
  for (const [u, t] of [['ann', 't1'], ['bob', 't1'], ['cat', 't1'], ['dan', 't2'], ['eve', 't2']]) store.set(`users/${u}`, { ...store.get(`users/${u}`), teamId: t });
  store.set('teams/otherTeam', { officeId: 'other', createdBy: 'olly' });
  store.set('properties/p1', { userId: 'bob', agentName: 'Bob', address: '1 A St' });
  store.set('billingItems/b1', { agentUid: 'bob', amount: 100 });
}
const call = (fn, body, uid, officeId = 'hph', extra = {}, method = 'POST') => {
  authSpies.verifyIdToken.mockResolvedValue({ uid });
  const req = new Request(`http://localhost/t${extra.query || ''}`, { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: ['GET', 'DELETE'].includes(method) ? undefined : JSON.stringify(body || {}) });
  return fn(req, { params: Promise.resolve({ officeId, ...extra.params }) });
};
const json = async (r) => ({ status: r.status, ...(await r.json()) });
const teamOf = (u) => store.get(`users/${u}`).teamId;
beforeEach(seed);

describe('listing', () => {
  it('Office Admin sees all office teams, members, administrators and unassigned agents (incl. invited and staged)', async () => {
    const r = await json(await call(listTeams, null, 'hannah', 'hph', {}, 'GET'));
    expect(r.teams.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(r.teams.find((t) => t.id === 't1')).toMatchObject({ adminUid: 'ann', adminName: 'Ann X' });
    expect(r.teams.find((t) => t.id === 't1').members.map((m) => m.uid).sort()).toEqual(['ann', 'bob', 'cat']);
    const un = r.unassigned.map((u) => u.email).sort();
    expect(un).toEqual(['hannah@hph.com', 'ivy@hph.com', 'sam@hph.com']);
    expect(r.unassigned.find((u) => u.email === 'sam@hph.com').canAssign).toBe(false);
    expect(r.unassigned.find((u) => u.email === 'ivy@hph.com').canAssign).toBe(true);
    expect(JSON.stringify(r)).not.toContain('olly');
  });
});

describe('authorization (office admin only; no new role)', () => {
  it('team creators, team members, agents and other-office admins are refused on every operation', async () => {
    const ops = [
      () => ({ fn: listTeams, method: 'GET' }),
      () => ({ fn: createTeam, body: { memberUids: ['hannah', 'ivy'], adminUid: 'hannah' } }),
      () => ({ fn: patchTeam, body: { name: 'x' }, extra: { params: { teamId: 't1' } }, method: 'PATCH' }),
      () => ({ fn: addMember, body: { uid: 'ivy' }, extra: { params: { teamId: 't1' } } }),
      () => ({ fn: moveMember, body: { toTeamId: 't2' }, extra: { params: { uid: 'bob' } }, method: 'PATCH' }),
      () => ({ fn: removeMember, extra: { params: { uid: 'bob' } }, method: 'DELETE' }),
    ];
    const before = JSON.stringify([...store.entries()]);
    for (const uid of ['ann', 'bob', 'dan', 'otheradmin']) {
      for (const op of ops) {
        const o = op();
        expect((await call(o.fn, o.body, uid, 'hph', o.extra || {}, o.method || 'POST')).status).toBe(403);
      }
    }
    expect(JSON.stringify([...store.entries()])).toBe(before);
    const noAuth = await listTeams(new Request('http://localhost/t'), { params: Promise.resolve({ officeId: 'hph' }) });
    expect(noAuth.status).toBe(401);
  });
  it("cannot reach another office's teams or agents even as an admin of this one", async () => {
    expect((await call(addMember, { uid: 'ivy' }, 'hannah', 'hph', { params: { teamId: 'otherTeam' } })).status).toBe(404);
    expect((await call(addMember, { uid: 'olly' }, 'hannah', 'hph', { params: { teamId: 't1' } })).status).toBe(404);
    expect((await call(moveMember, { toTeamId: 'otherTeam' }, 'hannah', 'hph', { params: { uid: 'bob' } }, 'PATCH')).status).toBe(404);
    expect((await call(moveMember, { toTeamId: 't2' }, 'hannah', 'hph', { params: { uid: 'olly' } }, 'PATCH')).status).toBe(404);
    expect((await call(patchTeam, { name: 'x' }, 'hannah', 'hph', { params: { teamId: 'otherTeam' } }, 'PATCH')).status).toBe(404);
    expect(teamOf('olly')).toBeUndefined();
  });
});

describe('create / edit', () => {
  it('creates a team from unassigned agents (an invited agent can be placed), names it and sets its administrator', async () => {
    const r = await json(await call(createTeam, { name: '  Tweed   Team ', memberUids: ['hannah', 'ivy'], adminUid: 'hannah' }, 'hannah'));
    expect(r.status).toBe(200);
    const t = store.get(`teams/${r.teamId}`);
    expect(t).toMatchObject({ officeId: 'hph', createdBy: 'hannah', name: 'Tweed Team' });
    expect(teamOf('hannah')).toBe(r.teamId); expect(teamOf('ivy')).toBe(r.teamId);
    expect(store.get('users/ivy').accountStatus).toBe('invited');
  });
  it('rejects a team of one, an admin outside the team, and agents already in a team', async () => {
    expect((await call(createTeam, { memberUids: ['ivy'], adminUid: 'ivy' }, 'hannah')).status).toBe(400);
    expect((await call(createTeam, { memberUids: ['hannah', 'ivy'], adminUid: 'bob' }, 'hannah')).status).toBe(400);
    expect((await call(createTeam, { memberUids: ['hannah', 'bob'], adminUid: 'hannah' }, 'hannah')).status).toBe(409);
  });
  it('renames a team and reassigns its administrator to a current member only', async () => {
    expect((await call(patchTeam, { name: 'Coast', adminUid: 'bob' }, 'hannah', 'hph', { params: { teamId: 't1' } }, 'PATCH')).status).toBe(200);
    expect(store.get('teams/t1')).toMatchObject({ name: 'Coast', createdBy: 'bob' });
    expect((await call(patchTeam, { adminUid: 'dan' }, 'hannah', 'hph', { params: { teamId: 't1' } }, 'PATCH')).status).toBe(400);
    expect(store.get('teams/t1').createdBy).toBe('bob');
  });
  it('the Office Admin keeps office-admin status; assigning a team admin grants no office-wide rights', async () => {
    await call(patchTeam, { adminUid: 'bob' }, 'hannah', 'hph', { params: { teamId: 't1' } }, 'PATCH');
    expect(store.get('officeAdminInfo/hph').officeAdminUids).toEqual(['hannah']);
    expect(store.get('users/bob').isOfficeAdmin).toBeUndefined();
    expect((await call(listTeams, null, 'bob', 'hph', {}, 'GET')).status).toBe(403);
  });
});

describe('membership changes', () => {
  it('adds an unassigned agent; refuses one already in a team', async () => {
    expect((await call(addMember, { uid: 'ivy' }, 'hannah', 'hph', { params: { teamId: 't1' } })).status).toBe(200);
    expect(teamOf('ivy')).toBe('t1');
    expect((await call(addMember, { uid: 'bob' }, 'hannah', 'hph', { params: { teamId: 't2' } })).status).toBe(409);
  });
  it('moves an agent between teams without touching campaigns, billing, Auth or profile', async () => {
    const snapshot = JSON.stringify([store.get('properties/p1'), store.get('billingItems/b1'), store.get('users/bob')].map((x) => ({ ...x, teamId: undefined })));
    const r = await json(await call(moveMember, { toTeamId: 't2' }, 'hannah', 'hph', { params: { uid: 'bob' } }, 'PATCH'));
    expect(r).toMatchObject({ status: 200, moved: true, dissolvedFrom: null });
    expect(teamOf('bob')).toBe('t2');
    expect(JSON.stringify([store.get('properties/p1'), store.get('billingItems/b1'), store.get('users/bob')].map((x) => ({ ...x, teamId: undefined })))).toBe(snapshot);
    expect(store.get('users/bob').accountStatus).toBe('active');
    for (const c of ['properties', 'billingItems', 'offers', 'agents', 'officeAgents']) expect(accessed.has(c)).toBe(false);
    expect(authSpies.updateUser).not.toHaveBeenCalled();
  });
  it('moving the team creator passes the administrator role on (existing behaviour)', async () => {
    await call(moveMember, { toTeamId: 't2' }, 'hannah', 'hph', { params: { uid: 'ann' } }, 'PATCH');
    expect(store.get('teams/t1').createdBy).not.toBe('ann');
    expect(['bob', 'cat']).toContain(store.get('teams/t1').createdBy);
  });
  it('refuses a move that would dissolve the source team unless confirmed; then unassigns the remaining member', async () => {
    const r = await json(await call(moveMember, { toTeamId: 't1' }, 'hannah', 'hph', { params: { uid: 'eve' } }, 'PATCH'));
    expect(r).toMatchObject({ status: 409, code: 'would-dissolve' });
    expect(teamOf('eve')).toBe('t2');
    const ok = await json(await call(moveMember, { toTeamId: 't1', confirmDissolve: true }, 'hannah', 'hph', { params: { uid: 'eve' } }, 'PATCH'));
    expect(ok).toMatchObject({ status: 200, dissolvedFrom: 't2' });
    expect(teamOf('eve')).toBe('t1'); expect(teamOf('dan')).toBeUndefined(); expect(store.has('teams/t2')).toBe(false);
  });
  it('moves an unassigned agent straight into a team', async () => {
    expect((await call(moveMember, { toTeamId: 't1' }, 'hannah', 'hph', { params: { uid: 'ivy' } }, 'PATCH')).status).toBe(200);
    expect(teamOf('ivy')).toBe('t1');
  });
  it('removes a member (confirm needed if the team would dissolve)', async () => {
    expect((await call(removeMember, null, 'hannah', 'hph', { params: { uid: 'bob' } }, 'DELETE')).status).toBe(200);
    expect(teamOf('bob')).toBeUndefined(); expect(teamOf('ann')).toBe('t1');
    expect((await call(removeMember, null, 'hannah', 'hph', { params: { uid: 'dan' } }, 'DELETE')).status).toBe(409);
    expect((await call(removeMember, null, 'hannah', 'hph', { params: { uid: 'dan' }, query: '?confirmDissolve=1' }, 'DELETE')).status).toBe(200);
    expect(store.has('teams/t2')).toBe(false);
  });
  it('every change is audit-logged with actor, action and office', async () => {
    await call(createTeam, { memberUids: ['hannah', 'ivy'], adminUid: 'hannah' }, 'hannah');
    await call(moveMember, { toTeamId: 't2' }, 'hannah', 'hph', { params: { uid: 'bob' } }, 'PATCH');
    const logs = [...store.entries()].filter(([k]) => k.startsWith('officeTeamAudit/')).map(([, v]) => v);
    expect(logs.map((l) => l.action).sort()).toEqual(['team.create', 'team.moveMember']);
    expect(logs.every((l) => l.actorUid === 'hannah' && l.officeId === 'hph')).toBe(true);
  });
});

describe('boundaries (source guards)', () => {
  it('team admin service never touches campaigns, offers, billing, Auth or profiles', () => {
    const src = readFileSync('src/app/api/services/officeTeamAdminService.js', 'utf8');
    expect(src).not.toMatch(/collection\(['"](properties|offers|agents|officeAgents|billing\w*|charges)['"]\)/);
    expect(src).not.toMatch(/firebase-admin\/auth|getAuth|billingService|resendService/);
  });
  it('existing My Team invitation/leave/remove flows are unchanged in behaviour (only helper exports added)', () => {
    const src = readFileSync('src/app/api/services/teamService.js', 'utf8');
    expect(src).toContain('export async function sendTeamInvite');
    expect(src).toContain("'Only the team creator or an office administrator can remove members.'");
  });
});
