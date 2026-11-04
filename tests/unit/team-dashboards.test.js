import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/* ───────────────────────── in-memory Firestore ─────────────────────────
 * Supports what the team code uses: doc get/set/update/delete, chained
 * where('==') queries, and runTransaction with OPTIMISTIC CONCURRENCY — every
 * doc read in a transaction is version-checked at commit and the callback is
 * retried on conflict, like the real Admin SDK. Reads yield to the event loop
 * so two transactions genuinely interleave in the concurrency tests. */
const DELETE = Symbol('delete');
const ts = (iso) => ({ toDate: () => new Date(iso), toMillis: () => new Date(iso).getTime() });
const now = () => { const t = Date.now(); return { toDate: () => new Date(t), toMillis: () => t }; };

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => now(), delete: () => DELETE, arrayRemove: (v) => v },
}));

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: mockVerifyIdToken,
    getUserByEmail: async (email) => {
      const hit = Object.entries(db.store.users || {}).find(([, d]) => d.data.email?.toLowerCase() === email.toLowerCase());
      if (!hit) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      return { uid: hit[0], disabled: hit[1].data.__authDisabled === true };
    },
    updateUser: async () => {},
  }),
}));

const mockSendTeamInviteEmail = vi.fn(async () => {});
vi.mock('../../src/app/api/services/resendService', () => ({
  sendTeamInviteEmail: (...a) => mockSendTeamInviteEmail(...a),
  sendOfficeInviteEmail: vi.fn(),
  sendOfficeJoinInviteEmail: vi.fn(),
}));
const mockGatherReport = vi.fn(async () => {});
vi.mock('../../src/app/api/services/reportService', () => ({ gatherReport: (...a) => mockGatherReport(...a) }));

function makeDb() {
  const store = {};
  const colVersion = {};
  let autoId = 0;
  const bump = (c) => { colVersion[c] = (colVersion[c] || 0) + 1; };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const snapOf = (c, id) => {
    const rec = store[c]?.[id];
    return { exists: !!rec, id, data: () => (rec ? structuredCloneWithTs(rec.data) : undefined), ref: docRef(c, id), _v: rec?.v ?? 0 };
  };
  const applyPatch = (base, patch) => {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) { if (v === DELETE) delete out[k]; else out[k] = v; }
    return out;
  };
  const write = (c, id, data) => { store[c] = store[c] || {}; store[c][id] = { data, v: (store[c][id]?.v || 0) + 1 }; bump(c); };
  const remove = (c, id) => { if (store[c]?.[id]) { delete store[c][id]; bump(c); } };

  function docRef(c, id) {
    return {
      id, _c: c, path: `${c}/${id}`, get: async () => snapOf(c, id),
      update: async (patch) => {
        if (database.failUpdates) throw new Error('simulated write failure');
        if (!store[c]?.[id]) throw new Error(`update of missing doc ${c}/${id}`);
        write(c, id, applyPatch(store[c][id].data, patch));
      },
    };
  }
  function query(c, filters = []) {
    return {
      _c: c,
      where: (f, op, v) => {
        if (op !== '==' && op !== 'in') throw new Error('only == and in');
        return query(c, [...filters, [f, v, op]]);
      },
      limit: () => query(c, filters),
      get: async () => {
        const docs = Object.keys(store[c] || {}).map((id) => snapOf(c, id)).filter((s) => filters.every(([f, v, op]) => (op === 'in' ? v.includes(s.data()[f]) : s.data()[f] === v)));
        return { empty: !docs.length, size: docs.length, docs };
      },
    };
  }
  const database = {
    store,
    failUpdates: false,
    seed(c, id, data) { write(c, id, data); },
    raw: (c, id) => store[c]?.[id]?.data,
    count: (c) => Object.keys(store[c] || {}).length,
    collection: (c) => ({ doc: (id) => docRef(c, id || `auto${++autoId}`), where: (f, op, v) => query(c).where(f, op, v) }),
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const reads = []; // [{c,id,v}] and [{c,colV}]
        const writes = [];
        const tx = {
          async get(target) {
            await tick();
            if (target.path) {
              const s = snapOf(target._c, target.id);
              reads.push({ c: target._c, id: target.id, v: s._v });
              return s;
            }
            reads.push({ c: target._c, colV: colVersion[target._c] || 0 });
            return target.get();
          },
          set: (r, data) => writes.push(['set', r, data]),
          update: (r, patch) => writes.push(['update', r, patch]),
          delete: (r) => writes.push(['delete', r]),
        };
        const result = await fn(tx);
        await tick();
        const stale = reads.some((r) => (r.colV !== undefined ? (colVersion[r.c] || 0) !== r.colV : (store[r.c]?.[r.id]?.v ?? 0) !== r.v));
        if (stale) continue;
        for (const [kind, r, payload] of writes) {
          if (kind === 'set') write(r._c, r.id, applyPatch({}, payload));
          else if (kind === 'update') {
            if (!store[r._c]?.[r.id]) throw new Error(`update of missing doc ${r.path}`);
            write(r._c, r.id, applyPatch(store[r._c][r.id].data, payload));
          } else remove(r._c, r.id);
        }
        return result;
      }
      throw new Error('transaction kept conflicting');
    },
  };
  return database;
}
function structuredCloneWithTs(o) { return { ...o }; }

let db;
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => db[p] }) }));

/* ─────────────────────────── world ─────────────────────────── */
process.env.TEAM_INVITE_MIN_RESPONSE_MS = '0'; // the response-time floor has its own test
const SECRET_NAME = 'Bea Buyer';
const agent = (first, extra = {}) => ({ firstName: first, lastName: 'Test', email: `${first.toLowerCase()}@a.test`, agent: true, roles: ['agent'], officeId: 'A', accountStatus: 'active', ...extra });

function seedWorld() {
  db = makeDb();
  db.seed('officeAdminInfo', 'A', { name: 'Office A', status: 'active', officeAdminUids: ['adminA'] });
  db.seed('officeAdminInfo', 'B', { name: 'Office B', status: 'active', officeAdminUids: ['adminB'] });
  db.seed('officeAdminInfo', 'D', { name: 'Dead', status: 'disabled', officeAdminUids: [] });
  db.seed('users', 'adminA', agent('AdminA', { isOfficeAdmin: true }));
  db.seed('users', 'adminB', agent('AdminB', { officeId: 'B', isOfficeAdmin: true }));
  for (const n of ['alice', 'bob', 'carol', 'dave']) db.seed('users', n, agent(n[0].toUpperCase() + n.slice(1)));
  db.seed('users', 'erin', agent('Erin', { accountStatus: 'invited' }));
  db.seed('users', 'zed', agent('Zed', { officeId: 'B' }));
  db.seed('users', 'indep', agent('Indep', { officeId: undefined }));
  db.seed('users', 'root', { firstName: 'Root', email: 'root@x.test', superAdmin: true });
  db.seed('users', 'buyer1', { firstName: 'Bea', lastName: 'Buyer', email: 'bea@buyer.test', phone: '0411 222 333', buyerPreferences: { maxBudget: 1 } });
  for (let i = 0; i < 12; i++) db.seed('users', `mate${i}`, agent(`Mate${i}`));

  db.seed('properties', 'bobProp', {
    userId: 'bob', formattedAddress: '1 Bob St', price: 900000, visibility: true, createdAt: ts('2026-09-01T00:00:00Z'),
    vendorEmail: 'vendor@secret.test', imageUrls: ['x.jpg'], stats: { views: 7 },
  });
  db.seed('properties', 'aliceProp', { userId: 'alice', formattedAddress: '2 Alice St', visibility: true, createdAt: ts('2026-09-02T00:00:00Z') });
  db.seed('properties', 'zedProp', { userId: 'zed', formattedAddress: '9 Zed St' });
  db.seed('offers', 'offer1', {
    propertyId: 'bobProp', type: 'opinion', serious: true, userId: 'buyer1', offerAmount: 880000,
    buyerName: SECRET_NAME, buyerEmail: 'bea@buyer.test', buyerPhone: '0411 222 333',
    sessionId: 'sess-123', visitorId: 'vis-456', timeframe: '3 months', isInvestor: true, createdAt: ts('2026-10-01T00:00:00Z'),
    interestNotifiedAt: ts('2026-10-01T00:00:00Z'),
  });
  db.seed('offers', 'offer2', { propertyId: 'bobProp', type: 'opinion', serious: false, offerAmount: 850000, sessionId: 'sess-999', createdAt: ts('2026-10-02T00:00:00Z') });
  db.seed('likes', 'like1', { propertyId: 'bobProp', userId: 'buyer1', createdAt: ts('2026-10-03T00:00:00Z') });
}

/** Put people straight into a team (as the accept flow would have). */
function makeTeam(id, members, { creator = members[0], officeId = 'A' } = {}) {
  db.seed('teams', id, { officeId, createdBy: creator, createdAt: ts('2026-10-01T00:00:00Z'), updatedAt: ts('2026-10-01T00:00:00Z') });
  for (const m of members) db.seed('users', m, { ...db.raw('users', m), teamId: id });
}

const svc = () => import('../../src/app/api/services/teamService');
const accessSvc = () => import('../../src/app/api/services/propertyAccessService');
const invite = async (from, email) => (await svc()).sendTeamInvite({ actorUid: from, actorEmail: db.raw('users', from).email, email });
const pendingInviteFor = (toUid) => Object.entries(db.store.teamInvites || {}).find(([, r]) => r.data.toUid === toUid && r.data.status === 'pending');
const respond = async (id, uid, action) => (await svc()).respondToInvite({ inviteId: id, actorUid: uid, action });
const fails = async (p, status, code) => {
  const err = await p.then(() => null, (e) => e);
  expect(err, 'expected the call to be refused').not.toBeNull();
  expect(err.status).toBe(status);
  if (code) expect(err.code).toBe(code);
  return err;
};

beforeEach(() => { seedWorld(); vi.clearAllMocks(); });

/* ─────────────────────────── invitations ─────────────────────────── */
describe('creating a team and sending invitations', () => {
  it('inviting an agent with no team creates a pending invite but NO team yet and shares nothing', async () => {
    const res = await invite('alice', 'BOB@a.test');
    expect(res.ok).toBe(true);
    const [, rec] = pendingInviteFor('bob');
    expect(rec.data).toMatchObject({ fromUid: 'alice', toUid: 'bob', officeId: 'A', teamId: null, status: 'pending' });
    expect(db.count('teams')).toBe(0);
    expect(db.raw('users', 'alice').teamId).toBeUndefined();
    expect(db.raw('users', 'bob').teamId).toBeUndefined();
  });

  it('emails exactly the one recipient, linking to the in-app page (no bulk path)', async () => {
    await invite('alice', 'bob@a.test');
    expect(mockSendTeamInviteEmail).toHaveBeenCalledTimes(1);
    const [to, , inviterName, officeName, link] = mockSendTeamInviteEmail.mock.calls[0];
    expect(to).toBe('bob@a.test');
    expect(inviterName).toBe('Alice Test');
    expect(officeName).toBe('Office A');
    expect(link).toMatch(/\/dashboard\/team$/);
  });

  it('a failed email does not lose the invitation, is recorded for support, and looks like success to the sender', async () => {
    const ok = await invite('alice', 'carol@a.test');
    mockSendTeamInviteEmail.mockRejectedValueOnce(new Error('resend down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await invite('alice', 'bob@a.test');
    expect(res).toEqual(ok); // no emailSent flag: it would reveal the recipient was eligible
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    const [id, rec] = pendingInviteFor('bob');
    expect(rec.data.status).toBe('pending');
    expect(db.raw('teamInvites', id).emailStatus).toBe('failed');
    expect(db.raw('teamInvites', pendingInviteFor('carol')[0]).emailStatus).toBe('sent');
  });

  it('accepting creates the team with the inviter as creator and puts BOTH in it', async () => {
    await invite('alice', 'bob@a.test');
    const [id] = pendingInviteFor('bob');
    const out = await respond(id, 'bob', 'accept');
    expect(out).toMatchObject({ status: 'accepted', createdTeam: true });
    const teamId = db.raw('users', 'alice').teamId;
    expect(teamId).toBeTruthy();
    expect(db.raw('users', 'bob').teamId).toBe(teamId);
    expect(db.raw('teams', teamId)).toMatchObject({ officeId: 'A', createdBy: 'alice' });
    expect(db.raw('teamInvites', id).status).toBe('accepted');
  });

  it('an existing member can invite a third agent, who then joins the SAME team (teams of 3+)', async () => {
    makeTeam('T1', ['alice', 'bob']);
    await invite('bob', 'carol@a.test'); // bob is not the creator
    const [id, rec] = pendingInviteFor('carol');
    expect(rec.data.teamId).toBe('T1');
    await respond(id, 'carol', 'accept');
    expect(db.raw('users', 'carol').teamId).toBe('T1');
    expect(db.count('teams')).toBe(1);
  });

  it('requires an explicit acceptance: nothing is visible until then', async () => {
    await invite('alice', 'bob@a.test');
    const { getPropertyReportAccess } = await accessSvc();
    expect(await getPropertyReportAccess(db, { uid: 'alice', property: db.raw('properties', 'bobProp') })).toBeNull();
    expect(await getPropertyReportAccess(db, { uid: 'bob', property: db.raw('properties', 'aliceProp') })).toBeNull();
  });
});

describe('invitation validation', () => {
  it('rejects self-invitation (by email, case-insensitively)', async () => {
    await fails(invite('alice', 'Alice@A.test'), 400, 'self-invite');
    expect(db.count('teamInvites')).toBe(0);
  });
  it('rejects malformed emails', async () => {
    await fails(invite('alice', 'not-an-email'), 400, 'bad-email');
  });
  it('duplicate pending invitations store nothing and send no second email — including from two members of the same team', async () => {
    const first = await invite('alice', 'bob@a.test');
    expect(await invite('alice', 'bob@a.test')).toEqual(first);
    expect(mockSendTeamInviteEmail).toHaveBeenCalledTimes(1);
    makeTeam('T1', ['carol', 'dave']);
    await invite('carol', 'mate0@a.test');
    await invite('dave', 'mate0@a.test');
    expect([...Object.values(db.store.teamInvites)].filter((r) => r.data.toUid === 'mate0')).toHaveLength(1);
    expect(mockSendTeamInviteEmail).toHaveBeenCalledTimes(2); // bob once, mate0 once
  });
  it('a double-submitted invite (concurrent requests) sends exactly one email', async () => {
    const results = await Promise.all([invite('alice', 'bob@a.test'), invite('alice', 'bob@a.test'), invite('alice', 'bob@a.test')]);
    expect(results[1]).toEqual(results[0]);
    expect(Object.values(db.store.teamInvites)).toHaveLength(1);
    expect(mockSendTeamInviteEmail).toHaveBeenCalledTimes(1);
  });
  it('cross-office: a recipient in another office, or with no office, looks exactly like an unknown email — no invite, no email', async () => {
    const eligible = await invite('alice', 'bob@a.test');
    mockSendTeamInviteEmail.mockClear();
    const results = [await invite('alice', 'zed@a.test'), await invite('alice', 'indep@a.test'), await invite('alice', 'ghost@nowhere.test'), await invite('alice', 'erin@a.test')];
    for (const r of results) expect(r.message).toBe(eligible.message);
    expect(Object.values(db.store.teamInvites).map((r) => r.data.toUid)).toEqual(['bob']);
    expect(mockSendTeamInviteEmail).not.toHaveBeenCalled();
  });
  it('a sender who is not an activated agent of an active office is refused', async () => {
    await fails(invite('indep', 'bob@a.test'), 403, 'not-eligible');
    await fails(invite('erin', 'bob@a.test'), 403, 'not-eligible');
    db.seed('users', 'alice', { ...db.raw('users', 'alice'), officeId: 'D' });
    await fails(invite('alice', 'bob@a.test'), 403, 'office-inactive');
  });
  it('rate-limits invitations per sender per day', async () => {
    for (let i = 0; i < 10; i++) await invite('alice', `mate${i}@a.test`);
    await fails(invite('alice', 'mate10@a.test'), 429, 'rate-limited');
    expect(db.count('teamInvites')).toBe(10);
  });
  it('declining blocks an immediate re-invite (silently — cooldown) but not a later one', async () => {
    await invite('alice', 'bob@a.test');
    const [id] = pendingInviteFor('bob');
    await respond(id, 'bob', 'decline');
    mockSendTeamInviteEmail.mockClear();
    await invite('alice', 'bob@a.test'); // cooldown: generic answer, nothing stored, no email
    expect(db.raw('teamInvites', id).status).toBe('declined');
    expect(mockSendTeamInviteEmail).not.toHaveBeenCalled();
    db.seed('teamInvites', id, { ...db.raw('teamInvites', id), respondedAt: ts('2020-01-01T00:00:00Z') });
    await expect(invite('alice', 'bob@a.test')).resolves.toMatchObject({ ok: true });
    expect(db.raw('teamInvites', id).status).toBe('pending');
  });
});

describe('agents already in another team — teams never merge', () => {
  it('inviting someone in another team is stored and emailed like any other invite — the SENDER learns nothing', async () => {
    const baseline = await invite('mate1', 'mate2@a.test');
    makeTeam('T1', ['alice', 'bob']);
    makeTeam('T2', ['carol', 'dave']);
    const res = await invite('alice', 'carol@a.test');
    expect(res).toEqual(baseline);
    expect(pendingInviteFor('carol')).toBeTruthy();
    expect(mockSendTeamInviteEmail).toHaveBeenCalledTimes(2);
    // …and it appears in the sender's pending list exactly like an eligible recipient's
    const ov = await (await svc()).getTeamOverview('alice');
    expect(ov.outgoing.map((o) => o.toEmail)).toEqual(['carol@a.test']);
    expect(res.message).not.toMatch(/already|leave|in a team/i);
  });
  it('inviting someone already on your own team stores nothing (you can see your members anyway)', async () => {
    makeTeam('T1', ['alice', 'bob']);
    await invite('alice', 'bob@a.test');
    expect(db.count('teamInvites')).toBe(0);
    expect(mockSendTeamInviteEmail).not.toHaveBeenCalled();
  });
  it('an invitation sent before the recipient joined another team can no longer be accepted, and nothing merges', async () => {
    await invite('alice', 'carol@a.test');
    const [id] = pendingInviteFor('carol');
    makeTeam('T2', ['carol', 'dave']);
    const err = await fails(respond(id, 'carol', 'accept'), 409, 'already-in-team');
    expect(err.message).toMatch(/leave/i);
    expect(db.raw('users', 'carol').teamId).toBe('T2');
    expect(db.raw('users', 'alice').teamId).toBeUndefined();
    expect(db.count('teams')).toBe(1);
  });
  it('the overview flags such an invitation as blocked', async () => {
    await invite('alice', 'carol@a.test');
    makeTeam('T2', ['carol', 'dave']);
    const ov = await (await svc()).getTeamOverview('carol');
    expect(ov.incoming).toHaveLength(1);
    expect(ov.incoming[0].blocked).toBe(true);
  });
});

describe('accepting, declining, expiry', () => {
  it('only the invited account can accept or decline', async () => {
    await invite('alice', 'bob@a.test');
    const [id] = pendingInviteFor('bob');
    await fails(respond(id, 'carol', 'accept'), 403);
    await fails(respond(id, 'carol', 'decline'), 403);
    await fails(respond(id, 'alice', 'accept'), 403); // the sender can't accept on their behalf
    expect(db.raw('teamInvites', id).status).toBe('pending');
  });
  it('decline closes the invitation and it can no longer be accepted', async () => {
    await invite('alice', 'bob@a.test');
    const [id] = pendingInviteFor('bob');
    expect(await respond(id, 'bob', 'decline')).toEqual({ status: 'declined' });
    await fails(respond(id, 'bob', 'accept'), 410, 'gone');
    expect(db.count('teams')).toBe(0);
  });
  it('invitations expire after 14 days: cannot be accepted and are not listed', async () => {
    await invite('alice', 'bob@a.test');
    const [id, rec] = pendingInviteFor('bob');
    db.seed('teamInvites', id, { ...rec.data, createdAt: ts(new Date(Date.now() - 15 * 86400000).toISOString()) });
    await fails(respond(id, 'bob', 'accept'), 410, 'expired');
    const ov = await (await svc()).getTeamOverview('bob');
    expect(ov.incoming).toHaveLength(0);
    // …whereas 13 days is still fine
    db.seed('teamInvites', id, { ...rec.data, createdAt: ts(new Date(Date.now() - 13 * 86400000).toISOString()) });
    expect((await respond(id, 'bob', 'accept')).status).toBe('accepted');
  });
  it('an expired invitation can be replaced by a fresh one', async () => {
    await invite('alice', 'bob@a.test');
    const [id, rec] = pendingInviteFor('bob');
    db.seed('teamInvites', id, { ...rec.data, createdAt: ts('2020-01-01T00:00:00Z') });
    await expect(invite('alice', 'bob@a.test')).resolves.toMatchObject({ ok: true });
  });
  it('accept is refused if the recipient has since left the office (cross-office)', async () => {
    await invite('alice', 'bob@a.test');
    const [id] = pendingInviteFor('bob');
    db.seed('users', 'bob', { ...db.raw('users', 'bob'), officeId: 'B' });
    await fails(respond(id, 'bob', 'accept'), 409, 'office-mismatch');
    expect(db.count('teams')).toBe(0);
  });
  it('accept is refused if the inviter has left the office or moved teams', async () => {
    await invite('alice', 'bob@a.test');
    const [id] = pendingInviteFor('bob');
    db.seed('users', 'alice', { ...db.raw('users', 'alice'), officeId: undefined });
    await fails(respond(id, 'bob', 'accept'), 410, 'inviter-gone');
    db.seed('users', 'alice', agent('Alice'));
    makeTeam('T9', ['alice', 'dave']);
    await fails(respond(id, 'bob', 'accept'), 410, 'inviter-moved');
  });
  it('the sender or a teammate can cancel; a stranger cannot', async () => {
    makeTeam('T1', ['alice', 'bob']);
    await invite('alice', 'carol@a.test');
    const [id] = pendingInviteFor('carol');
    await fails(respond(id, 'dave', 'cancel'), 403);
    await respond(id, 'bob', 'cancel');
    expect(db.raw('teamInvites', id).status).toBe('cancelled');
    await fails(respond(id, 'carol', 'accept'), 410, 'gone');
  });
});

describe('one team per agent, transactionally', () => {
  it('two concurrent acceptances for the same agent: exactly one wins, one team results', async () => {
    await invite('alice', 'carol@a.test');
    await invite('bob', 'carol@a.test');
    const ids = Object.entries(db.store.teamInvites).filter(([, r]) => r.data.toUid === 'carol').map(([id]) => id);
    expect(ids).toHaveLength(2);
    const results = await Promise.allSettled(ids.map((id) => respond(id, 'carol', 'accept')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected.reason.status).toBe(409);
    expect(db.count('teams')).toBe(1);
    const teamId = db.raw('users', 'carol').teamId;
    const inTeam = ['alice', 'bob'].filter((u) => db.raw('users', u).teamId === teamId);
    expect(inTeam).toHaveLength(1); // the loser was NOT dragged into the winner's team
  });
  it('double-clicking accept on one invite is idempotent', async () => {
    await invite('alice', 'bob@a.test');
    const [id] = pendingInviteFor('bob');
    const results = await Promise.allSettled([respond(id, 'bob', 'accept'), respond(id, 'bob', 'accept')]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(db.count('teams')).toBe(1);
  });
  it('simultaneous invites to two people and acceptance by both never create a second team for the inviter', async () => {
    await invite('alice', 'bob@a.test');
    await invite('alice', 'carol@a.test');
    const ids = Object.keys(db.store.teamInvites);
    const results = await Promise.allSettled([respond(ids[0], 'bob', 'accept'), respond(ids[1], 'carol', 'accept')]);
    // the second must fail cleanly (inviter now has a team) — never produce two teams for alice
    expect(db.count('teams')).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const teamId = db.raw('users', 'alice').teamId;
    for (const u of ['bob', 'carol']) expect([teamId, undefined]).toContain(db.raw('users', u).teamId);
  });
});

/* ───────────────────── invitation privacy (sender's view) ───────────────────── */
describe('the sender cannot learn anything about the recipient', () => {
  it('EVERY outcome returns the identical response body: eligible, in-team, same team, duplicate, recently declined, other office, no office, not activated, unknown, disabled', async () => {
    const baseline = await invite('mate1', 'mate2@a.test'); // a normal stored invite
    expect(Object.keys(baseline).sort()).toEqual(['message', 'ok']); // no emailSent / reason / status fields

    makeTeam('T2', ['carol', 'dave']);                                   // carol is in another team
    makeTeam('T1', ['alice', 'bob']);                                    // bob is on alice's team
    db.seed('users', 'mate5', { ...db.raw('users', 'mate5'), __authDisabled: true });
    await invite('alice', 'mate3@a.test');                               // → pending…
    const outcomes = {
      eligible: await invite('alice', 'mate4@a.test'),
      inOtherTeam: await invite('alice', 'carol@a.test'),
      onYourTeam: await invite('alice', 'bob@a.test'),
      duplicate: await invite('alice', 'mate3@a.test'),                  // …and again
      otherOffice: await invite('alice', 'zed@a.test'),
      noOffice: await invite('alice', 'indep@a.test'),
      notActivated: await invite('alice', 'erin@a.test'),
      unknown: await invite('alice', 'nobody@nowhere.test'),
      authDisabled: await invite('alice', 'mate5@a.test'),
    };
    for (const [name, out] of Object.entries(outcomes)) expect(out, name).toEqual(baseline);
  });

  it('a declined-recently recipient is indistinguishable too', async () => {
    const baseline = await invite('mate1', 'mate2@a.test');
    await invite('alice', 'bob@a.test');
    await respond(pendingInviteFor('bob')[0], 'bob', 'decline');
    expect(await invite('alice', 'bob@a.test')).toEqual(baseline);
  });

  it('refusals never mention teams: the only error a sender can hit is about themself (bad email, self, rate limit, own eligibility)', async () => {
    makeTeam('T2', ['carol', 'dave']);
    for (const email of ['carol@a.test', 'dave@a.test', 'zed@a.test', 'nobody@x.test']) {
      const out = await invite('alice', email);
      expect(JSON.stringify(out)).not.toMatch(/leave|already|current team|another office|not eligible/i);
    }
  });

  it('the in-team recipient IS told — but only themself, on their own page and when accepting', async () => {
    makeTeam('T2', ['carol', 'dave']);
    await invite('alice', 'carol@a.test');
    const [id] = pendingInviteFor('carol');
    const ov = await (await svc()).getTeamOverview('carol');
    expect(ov.incoming).toEqual([expect.objectContaining({ id, blocked: true })]);
    const err = await fails(respond(id, 'carol', 'accept'), 409, 'already-in-team');
    expect(err.message).toMatch(/leave your current team/i);
    // once they leave, the same invitation can be accepted
    await (await svc()).leaveTeam({ actorUid: 'carol' });
    expect((await respond(id, 'carol', 'accept')).status).toBe('accepted');
  });

  it('the sender’s pending list does not distinguish an in-team recipient from any other', async () => {
    makeTeam('T2', ['carol', 'dave']);
    await invite('alice', 'carol@a.test');
    await invite('alice', 'mate0@a.test');
    const { outgoing } = await (await svc()).getTeamOverview('alice');
    expect(outgoing.map((o) => Object.keys(o).sort().join())).toEqual(Array(2).fill(Object.keys(outgoing[0]).sort().join()));
    expect(outgoing.map((o) => o.toEmail).sort()).toEqual(['carol@a.test', 'mate0@a.test']);
  });

  it('timing: eligible and ineligible answers are held to the same minimum duration', async () => {
    process.env.TEAM_INVITE_MIN_RESPONSE_MS = '150';
    try {
      for (const email of ['bob@a.test', 'zed@a.test', 'nobody@nowhere.test']) {
        const t = Date.now();
        await invite('alice', email);
        expect(Date.now() - t, email).toBeGreaterThanOrEqual(145);
      }
    } finally { process.env.TEAM_INVITE_MIN_RESPONSE_MS = '0'; }
  });
});

/* ───────────────────── invitation + email reliability ───────────────────── */
describe('invitation and email reliability', () => {
  it('the invitation appears on the recipient’s My Team page (API) with who/where/when', async () => {
    await invite('alice', 'bob@a.test');
    mockVerifyIdToken.mockResolvedValue({ uid: 'bob' });
    const { GET } = await import('../../src/app/api/teams/mine/route.js');
    const res = await GET(new Request('http://localhost/api/teams/mine', { headers: { authorization: 'Bearer t' } }));
    const body = await res.json();
    expect(body.incoming).toEqual([expect.objectContaining({ fromName: 'Alice Test', officeName: 'Office A', blocked: false })]);
    expect(new Date(body.incoming[0].expiresAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86400000);
  });

  it('acceptance works even when the notification email failed', async () => {
    mockSendTeamInviteEmail.mockRejectedValueOnce(new Error('resend down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await invite('alice', 'bob@a.test');
    console.error.mockRestore();
    const [id] = pendingInviteFor('bob');
    expect(db.raw('teamInvites', id).emailStatus).toBe('failed');
    expect((await respond(id, 'bob', 'accept')).status).toBe('accepted');
    expect(db.raw('users', 'bob').teamId).toBeTruthy();
  });

  it('even if recording the email status itself fails, the invitation is intact and the call succeeds', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.failUpdates = true; // the post-send emailStatus update throws
    await expect(invite('alice', 'bob@a.test')).resolves.toMatchObject({ ok: true });
    db.failUpdates = false;
    spy.mockRestore();
    const [id] = pendingInviteFor('bob');
    expect(db.raw('teamInvites', id).status).toBe('pending');
    expect((await respond(id, 'bob', 'accept')).status).toBe('accepted');
  });

  it('email goes to the recipient only, once per stored invitation, never to the sender or anyone else', async () => {
    await invite('alice', 'bob@a.test');
    await invite('alice', 'bob@a.test');
    await invite('alice', 'zed@a.test');
    await invite('alice', 'ghost@x.test');
    expect(mockSendTeamInviteEmail.mock.calls.map((c) => c[0])).toEqual(['bob@a.test']);
  });
});

describe('invitation ATTEMPT rate limit', () => {
  it('counts every lookup — including ones that store nothing and send nothing', async () => {
    for (let i = 0; i < 30; i++) await invite('alice', `ghost${i}@nowhere.test`);
    expect(db.count('teamInvites')).toBe(0);
    expect(db.raw('teamInviteAttempts', 'alice').count).toBe(30);
    await fails(invite('alice', 'ghost-31@nowhere.test'), 429, 'rate-limited');
    await fails(invite('alice', 'bob@a.test'), 429, 'rate-limited'); // a real colleague is blocked too
    expect(mockSendTeamInviteEmail).not.toHaveBeenCalled();
  });
  it('is per sender: one agent hitting the limit does not block another', async () => {
    for (let i = 0; i < 30; i++) await invite('alice', `ghost${i}@nowhere.test`);
    await expect(invite('bob', 'carol@a.test')).resolves.toMatchObject({ ok: true });
  });
  it('resets after the 24-hour window', async () => {
    for (let i = 0; i < 30; i++) await invite('alice', `ghost${i}@nowhere.test`);
    db.seed('teamInviteAttempts', 'alice', { count: 30, windowStart: ts(new Date(Date.now() - 25 * 3600000).toISOString()) });
    await expect(invite('alice', 'bob@a.test')).resolves.toMatchObject({ ok: true });
    expect(db.raw('teamInviteAttempts', 'alice').count).toBe(1);
  });
  it('concurrent attempts cannot slip past the cap', async () => {
    db.seed('teamInviteAttempts', 'alice', { count: 28, windowStart: ts(new Date().toISOString()) });
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => invite('alice', `ghost${i}@nowhere.test`)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(db.raw('teamInviteAttempts', 'alice').count).toBe(30);
  });
  it('malformed emails and self-invites are refused before a lookup and are not charged', async () => {
    await fails(invite('alice', 'nope'), 400, 'bad-email');
    await fails(invite('alice', 'alice@a.test'), 400, 'self-invite');
    expect(db.raw('teamInviteAttempts', 'alice')).toBeUndefined();
  });
  it('the stored-invitation cap (10/day) still applies on top', async () => {
    for (let i = 0; i < 10; i++) await invite('alice', `mate${i}@a.test`);
    await fails(invite('alice', 'mate10@a.test'), 429, 'rate-limited');
  });
});

/* ─────────────────────── leaving and removing ─────────────────────── */
describe('leaving and removing members', () => {
  it('a member leaves voluntarily; the team (of 3) carries on', async () => {
    makeTeam('T1', ['alice', 'bob', 'carol']);
    expect(await (await svc()).leaveTeam({ actorUid: 'bob' })).toMatchObject({ left: true, dissolved: false });
    expect(db.raw('users', 'bob').teamId).toBeUndefined();
    expect(db.raw('users', 'alice').teamId).toBe('T1');
  });
  it('when the creator leaves, creator status passes to a remaining member', async () => {
    makeTeam('T1', ['alice', 'bob', 'carol']);
    await (await svc()).leaveTeam({ actorUid: 'alice' });
    expect(['bob', 'carol']).toContain(db.raw('teams', 'T1').createdBy);
  });
  it('a team that would be left with one person is dissolved — nobody is stranded in a team of one', async () => {
    makeTeam('T1', ['alice', 'bob']);
    expect(await (await svc()).leaveTeam({ actorUid: 'bob' })).toMatchObject({ dissolved: true });
    expect(db.raw('teams', 'T1')).toBeUndefined();
    expect(db.raw('users', 'alice').teamId).toBeUndefined();
  });
  it('after leaving, the agent can be invited into (or start) another team', async () => {
    makeTeam('T1', ['alice', 'bob']);
    await (await svc()).leaveTeam({ actorUid: 'bob' });
    await expect(invite('carol', 'bob@a.test')).resolves.toMatchObject({ ok: true });
  });
  it('leaving without a team is a clear error', async () => {
    await fails((await svc()).leaveTeam({ actorUid: 'alice' }), 404, 'no-team');
  });
  it('the creator can remove a member; properties and ownership are untouched', async () => {
    makeTeam('T1', ['alice', 'bob', 'carol'], { creator: 'alice' });
    await (await svc()).removeTeamMember({ actorUid: 'alice', targetUid: 'bob' });
    expect(db.raw('users', 'bob').teamId).toBeUndefined();
    expect(db.raw('properties', 'bobProp').userId).toBe('bob');
  });
  it('an authorised office admin (not a member) can remove a member', async () => {
    makeTeam('T1', ['alice', 'bob', 'carol'], { creator: 'alice' });
    await (await svc()).removeTeamMember({ actorUid: 'adminA', targetUid: 'carol' });
    expect(db.raw('users', 'carol').teamId).toBeUndefined();
  });
  it.each([
    ['an ordinary member', 'bob', 'carol'],
    ['an admin of a DIFFERENT office', 'adminB', 'carol'],
    ['an outsider', 'dave', 'carol'],
  ])('%s cannot remove a member', async (_n, actor, target) => {
    makeTeam('T1', ['alice', 'bob', 'carol'], { creator: 'alice' });
    await fails((await svc()).removeTeamMember({ actorUid: actor, targetUid: target }), 403, 'forbidden');
    expect(db.raw('users', 'carol').teamId).toBe('T1');
  });
  it('removing yourself goes through "leave"; removing a non-member is a 404', async () => {
    makeTeam('T1', ['alice', 'bob']);
    await fails((await svc()).removeTeamMember({ actorUid: 'alice', targetUid: 'alice' }), 400, 'use-leave');
    await fails((await svc()).removeTeamMember({ actorUid: 'alice', targetUid: 'dave' }), 404, 'not-member');
  });
  it('overview only offers Remove controls to the creator / an office admin', async () => {
    makeTeam('T1', ['alice', 'bob', 'carol'], { creator: 'alice' });
    const s = await svc();
    expect((await s.getTeamOverview('alice')).team.members.filter((m) => m.canRemove).map((m) => m.uid).sort()).toEqual(['bob', 'carol']);
    expect((await s.getTeamOverview('bob')).team.members.some((m) => m.canRemove)).toBe(false);
  });
});

/* ───────────────── access, revocation, read-only, redaction ───────────────── */
describe('team access to a teammate’s property report', () => {
  const access = async (uid, propertyId = 'bobProp') =>
    (await accessSvc()).getPropertyReportAccess(db, { uid, property: db.raw('properties', propertyId) });

  it('teammates get the new read-only team level; owner stays owner', async () => {
    makeTeam('T1', ['alice', 'bob']);
    expect(await access('alice')).toBe('teamMember');
    expect(await access('bob')).toBe('owner');
  });
  it('same office but NOT same team, other team, other office, or no office: refused', async () => {
    makeTeam('T1', ['alice', 'bob']);
    makeTeam('T2', ['carol', 'dave']);
    for (const u of ['carol', 'dave', 'mate0', 'zed', 'indep', 'buyer1', 'erin']) expect(await access(u), u).toBeNull();
  });
  it('a forged teamId pointer alone grants nothing (no team doc / wrong office)', async () => {
    db.seed('users', 'bob', { ...db.raw('users', 'bob'), teamId: 'FAKE' });
    db.seed('users', 'carol', { ...db.raw('users', 'carol'), teamId: 'FAKE' });
    expect(await access('carol')).toBeNull();
    db.seed('teams', 'FAKE', { officeId: 'B', createdBy: 'zed' });
    expect(await access('carol')).toBeNull(); // team belongs to a different office
  });
  it('REVOCATION: leaving the team ends access immediately', async () => {
    makeTeam('T1', ['alice', 'bob', 'carol']);
    expect(await access('alice')).toBe('teamMember');
    await (await svc()).leaveTeam({ actorUid: 'alice' });
    expect(await access('alice')).toBeNull();
    expect(await access('carol')).toBe('teamMember'); // the rest are unaffected
  });
  it('REVOCATION: being removed ends access immediately', async () => {
    makeTeam('T1', ['alice', 'bob', 'carol'], { creator: 'carol' });
    await (await svc()).removeTeamMember({ actorUid: 'carol', targetUid: 'alice' });
    expect(await access('alice')).toBeNull();
  });
  it('REVOCATION: dissolving the team ends access for everyone', async () => {
    makeTeam('T1', ['alice', 'bob']);
    await (await svc()).leaveTeam({ actorUid: 'bob' });
    expect(await access('alice')).toBeNull();
  });
  it('REVOCATION: either agent leaving the office, or the office deactivating, ends access with no cleanup', async () => {
    makeTeam('T1', ['alice', 'bob']);
    db.seed('users', 'alice', { ...db.raw('users', 'alice'), officeId: undefined });
    expect(await access('alice')).toBeNull();
    db.seed('users', 'alice', agent('Alice', { teamId: 'T1' }));
    expect(await access('alice')).toBe('teamMember');
    db.seed('users', 'bob', { ...db.raw('users', 'bob'), officeId: 'B' });
    expect(await access('alice')).toBeNull();
    db.seed('users', 'bob', agent('Bob', { teamId: 'T1' }));
    db.seed('officeAdminInfo', 'A', { name: 'Office A', status: 'disabled', officeAdminUids: ['adminA'] });
    expect(await access('alice')).toBeNull();
  });
  it('team membership never confers office-admin or super-admin power', async () => {
    makeTeam('T1', ['adminA', 'bob']);
    // an office admin who is also a teammate keeps the existing admin level; a plain teammate can't reach it
    makeTeam('T2', ['alice', 'carol']);
    expect(await access('alice', 'bobProp')).toBeNull();
    makeTeam('T3', ['alice', 'dave']);
    const { listAgentPropertiesForOffice } = await import('../../src/app/api/services/officeTeamService');
    await expect(listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'bob', actorUid: 'alice' })).rejects.toMatchObject({ status: 403 });
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    await expect(removeAgentFromOffice({ officeId: 'A', targetUid: 'bob', actorUid: 'alice' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('report + buyer-profile + management routes for a team member', () => {
  const req = (url, { method = 'GET', body } = {}) => new Request(url, { method, headers: { 'Content-Type': 'application/json', authorization: 'Bearer t' }, body: body ? JSON.stringify(body) : undefined });
  const as = (uid) => mockVerifyIdToken.mockResolvedValue({ uid });
  const ctx = (id) => ({ params: Promise.resolve({ id }) });
  const report = async (uid, id = 'bobProp') => {
    as(uid);
    const { GET } = await import('../../src/app/api/properties/[id]/report/route.js');
    return GET(req(`http://localhost/api/properties/${id}/report`), ctx(id));
  };

  beforeEach(() => makeTeam('T1', ['alice', 'bob']));

  it('serves a READ-ONLY, redacted report to a teammate', async () => {
    const res = await report('alice');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ access: 'teamMember', readOnly: true, redacted: true, buyers: {} });
    expect(body.offers).toHaveLength(2);
    expect(body.likes).toHaveLength(1);
    expect(body.offers.find((o) => o.offerAmount === 880000)).toBeTruthy(); // feedback still useful
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('PII: no buyer name, email, phone, uid, session/visitor id, raw offer id or vendor contact appears anywhere in the response', async () => {
    const text = JSON.stringify(await (await report('alice')).json());
    for (const forbidden of [
      SECRET_NAME, 'Bea', 'bea@buyer.test', '0411 222 333', 'buyer1', 'sess-123', 'sess-999', 'vis-456',
      'offer1', 'offer2', 'like1', 'vendor@secret.test', 'vendorEmail', 'interestNotifiedAt', 'buyerPreferences',
    ]) expect(text, `leaked "${forbidden}"`).not.toContain(forbidden);
  });

  it('offer rows are rebuilt from an allowlist and carry only anonymous labels', async () => {
    const { offers } = await (await report('alice')).json();
    const allowed = new Set(['id', 'type', 'offerAmount', 'createdAt', 'updatedAt', 'serious', 'fromWeb', 'isFirstHomeBuyer', 'isInvestor', 'buyerType', 'nextAction', 'timeframe', 'buyerName']);
    for (const o of offers) for (const k of Object.keys(o)) expect(allowed.has(k), `unexpected field ${k}`).toBe(true);
    expect(offers.find((o) => o.serious).buyerName).toMatch(/^Buyer \d+$/);
    expect(offers.find((o) => !o.serious).buyerName).toBeNull();
  });

  it('the listing agent and the office admin keep their existing, un-redacted reports', async () => {
    const owner = await (await report('bob')).json();
    expect(owner.readOnly).toBe(false);
    expect(owner.offers.find((o) => o.id === 'offer1').buyerEmail).toBe('bea@buyer.test');
    const admin = await (await report('adminA')).json();
    expect(admin).toMatchObject({ access: 'officeAdmin', readOnly: true });
    expect(admin.buyers.buyer1.email).toBe('bea@buyer.test');
  });

  it('buyer-profiles is refused for a teammate (and still served to the owner / office admin)', async () => {
    const call = async (uid) => {
      as(uid);
      const { GET } = await import('../../src/app/api/properties/[id]/buyer-profiles/route.js');
      return GET(req('http://localhost/x'), ctx('bobProp'));
    };
    const res = await call('alice');
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('Bea');
    expect((await call('bob')).status).toBe(200);
    expect((await call('adminA')).status).toBe(200);
  });

  it('a teammate cannot send a report for the listing', async () => {
    as('alice');
    const { POST } = await import('../../src/app/api/send-report/route.js');
    const res = await POST(req('http://localhost/api/send-report', { method: 'POST', body: { email: 'v@x.test', propertyId: 'bobProp', name: 'V' } }));
    expect(res.status).toBe(403);
    expect(mockGatherReport).not.toHaveBeenCalled();
  });

  it('BILLING: a teammate cannot record a charge against, or generate a card for, the listing', async () => {
    as('alice');
    const { POST: recordCharge } = await import('../../src/app/api/properties/[id]/record-charge/route.js');
    const charge = await recordCharge(req('http://localhost/x', { method: 'POST' }), ctx('bobProp'));
    expect(charge.status).toBe(403);
    expect(db.count('propertyCharges')).toBe(0);
    const { POST: card } = await import('../../src/app/api/reports/property-card/route.js');
    const cardRes = await card(req('http://localhost/x', { method: 'POST', body: { propertyId: 'bobProp' } }));
    expect(cardRes.status).toBe(403);
  });

  it('canManageProperty is false for the team level; property ownership is untouched', async () => {
    const { canManageProperty } = await accessSvc();
    expect(canManageProperty('teamMember')).toBe(false);
    expect(canManageProperty('officeAdmin')).toBe(false);
    expect(db.raw('properties', 'bobProp').userId).toBe('bob');
  });

  it('after leaving, the same request is refused immediately', async () => {
    expect((await report('alice')).status).toBe(200);
    await (await svc()).leaveTeam({ actorUid: 'alice' });
    expect((await report('alice')).status).toBe(403);
  });
});

describe('team properties list', () => {
  it('lists only teammates’ properties with the owner named, and minimal fields (no offers/contact/billing)', async () => {
    makeTeam('T1', ['alice', 'bob']);
    const out = await (await svc()).listTeamProperties('alice');
    expect(out.total).toBe(1);
    expect(out.properties[0]).toMatchObject({ id: 'bobProp', owner: { uid: 'bob', name: 'Bob Test' } });
    expect(JSON.stringify(out)).not.toMatch(/vendor|email|phone|buyer|offer/i);
    expect(out.properties.find((p) => p.id === 'aliceProp')).toBeUndefined(); // not your own
  });
  it('is refused without a team, and immediately after being removed', async () => {
    await fails((await svc()).listTeamProperties('alice'), 403, 'no-team');
    makeTeam('T1', ['alice', 'bob'], { creator: 'bob' });
    await (await svc()).removeTeamMember({ actorUid: 'bob', targetUid: 'alice' });
    await fails((await svc()).listTeamProperties('alice'), 403, 'no-team');
  });
  it('adds an anonymous opinion COUNT per teammate property — never an offer, amount or buyer detail', async () => {
    makeTeam('T1', ['alice', 'bob']);
    db.seed('offers', 'offer3', { propertyId: 'bobProp', type: 'interest', serious: true, buyerName: SECRET_NAME }); // not an opinion
    db.seed('offers', 'offerOther', { propertyId: 'zedProp', type: 'opinion' }); // someone else's property
    const out = await (await svc()).listTeamProperties('alice');
    expect(out.properties[0].opinions).toBe(2); // offer1 + offer2 only
    const json = JSON.stringify(out);
    expect(json).not.toContain(SECRET_NAME);
    expect(json).not.toMatch(/offerAmount|880000|850000|bea@buyer|sess-/);
  });
  it('does not share a property its owner has hidden from their own view', async () => {
    makeTeam('T1', ['alice', 'bob']);
    db.seed('properties', 'bobHidden', { userId: 'bob', formattedAddress: '3 Hidden St', hidden: true, archived: true, createdAt: ts('2026-09-03T00:00:00Z') });
    const out = await (await svc()).listTeamProperties('alice');
    expect(out.properties.map((p) => p.id)).toEqual(['bobProp']);
  });
  it('never includes a teammate who has left the office', async () => {
    makeTeam('T1', ['alice', 'bob', 'carol']);
    db.seed('users', 'bob', { ...db.raw('users', 'bob'), officeId: 'B' });
    const out = await (await svc()).listTeamProperties('alice');
    expect(out.properties.find((p) => p.owner.uid === 'bob')).toBeUndefined();
  });
});

describe('API routes', () => {
  const req = (url, { method = 'GET', body, token = 't' } = {}) => new Request(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const as = (uid) => mockVerifyIdToken.mockResolvedValue({ uid, email: db.raw('users', uid)?.email });

  it('all /api/teams routes reject logged-out callers', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad'));
    const mods = [
      ['mine', 'GET'], ['properties', 'GET'], ['leave', 'POST'], ['invites', 'POST'],
    ];
    for (const [path, method] of mods) {
      const mod = await import(`../../src/app/api/teams/${path}/route.js`);
      const res = await mod[method](req(`http://localhost/api/teams/${path}`, { method, token: null }));
      expect(res.status, path).toBe(401);
    }
  });

  it('POST /api/teams/invites → accept via POST /api/teams/invites/[id] → GET /api/teams/mine, end to end', async () => {
    as('alice');
    const inv = await import('../../src/app/api/teams/invites/route.js');
    const ok = await inv.POST(req('http://localhost/api/teams/invites', { method: 'POST', body: { email: 'bob@a.test' } }));
    expect(ok.status).toBe(200);
    const [id] = pendingInviteFor('bob');
    as('bob');
    const { POST } = await import('../../src/app/api/teams/invites/[id]/route.js');
    const acc = await POST(req('http://localhost/x', { method: 'POST', body: { action: 'accept' } }), { params: Promise.resolve({ id }) });
    expect(acc.status).toBe(200);
    const { GET } = await import('../../src/app/api/teams/mine/route.js');
    const mine = await (await GET(req('http://localhost/x'))).json();
    expect(mine.team.members.map((m) => m.name).sort()).toEqual(['Alice Test', 'Bob Test']);
    expect(mine.team.members.find((m) => m.isYou).name).toBe('Bob Test');
  });

  it('service errors surface as clean JSON with the right status, never a stack', async () => {
    as('alice');
    const inv = await import('../../src/app/api/teams/invites/route.js');
    const res = await inv.POST(req('http://localhost/x', { method: 'POST', body: { email: 'alice@a.test' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'self-invite' });
  });

  it('an agent outside any office sees "not eligible" instead of a team UI', async () => {
    const ov = await (await svc()).getTeamOverview('indep');
    expect(ov).toMatchObject({ eligible: false, team: null });
  });
});

/* ───────────────────────── rules + static guarantees ───────────────────────── */
describe('firestore.rules (static check — the emulator suite in tests/rules exercises them live)', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  it('teams and teamInvites are server-only', () => {
    expect(rules).toMatch(/match \/teams\/\{teamId\}\s*\{\s*allow read, write: if false;\s*\}/);
    expect(rules).toMatch(/match \/teamInvites\/\{inviteId\}\s*\{\s*allow read, write: if false;\s*\}/);
  });
  it('teamId can never be client-set at account creation, and is not in the client update allowlist', () => {
    expect(rules).toMatch(/hasAny\(\[[^\]]*'teamId'[^\]]*\]\)/s);
    const updateAllow = rules.match(/affectedKeys\(\)\s*\.hasOnly\(\[([^\]]*)\]\)/s)[1];
    expect(updateAllow).not.toContain('teamId');
  });
  it('the property write rules are unchanged: still the owner only', () => {
    const block = rules.match(/match \/properties\/\{propertyId\} \{[\s\S]*?\n    \}/)[0];
    expect(block).toContain('resource.data.userId == request.auth.uid');
    expect(block).not.toMatch(/team/i);
  });
});
