import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mockVerifyIdToken = vi.fn();
const mockGetUsers = vi.fn(async (ids) => ({ users: ids.map(({ uid }) => ({ uid, metadata: { lastSignInTime: 'Tue, 03 Nov 2026 01:00:00 GMT' } })) }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mockVerifyIdToken, getUsers: mockGetUsers }) }));

// Minimal in-memory Firestore: doc().get(), chained where() with ==, in, array-contains.
function makeFakeDb() {
  const store = {};
  const match = (d, [field, op, value]) => {
    if (op === '==') return d[field] === value;
    if (op === 'in') return value.includes(d[field]);
    if (op === 'array-contains') return Array.isArray(d[field]) && d[field].includes(value);
    throw new Error(`unsupported op ${op}`);
  };
  return {
    _seed(name, id, data) { store[name] = store[name] || {}; store[name][id] = data; },
    collection(name) {
      store[name] = store[name] || {};
      const query = (filters) => ({
        where: (f, op, v) => query([...filters, [f, op, v]]),
        async get() {
          const rows = Object.entries(store[name]).filter(([, d]) => filters.every((f) => match(d, f)));
          const docs = rows.map(([id, d]) => ({ id, data: () => d }));
          return { empty: !docs.length, size: docs.length, docs };
        },
      });
      return {
        doc: (id) => ({ id, async get() { const d = store[name][id]; return { exists: !!d, id, data: () => d }; } }),
        ...query([]),
      };
    },
  };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

const ts = (iso) => ({ toDate: () => new Date(iso) });
const NOW = new Date('2026-11-04T03:00:00Z'); // Wed 4 Nov 2026, 14:00 Sydney
const SECRET = 'SECRET-DO-NOT-LEAK';

function seed() {
  fakeDb = makeFakeDb();
  fakeDb._seed('officeAdminInfo', 'hph', { name: 'HPH', status: 'active', officeAdminUids: ['hphAdmin'], leadershipUids: ['david', 'trevor'] });
  fakeDb._seed('officeAdminInfo', 'other', { name: 'Other', status: 'active', officeAdminUids: ['otherAdmin'], leadershipUids: ['otherLeader'] });
  fakeDb._seed('officeAdminInfo', 'dead', { name: 'Dead', status: 'disabled', leadershipUids: ['deadLeader'] });

  fakeDb._seed('users', 'david', { firstName: 'David', lastName: 'Manby', avatar: 'd.jpg' });
  fakeDb._seed('users', 'trevor', { firstName: 'Trevor', lastName: 'Tippett', avatar: 't.jpg' });
  fakeDb._seed('users', 'hphAdmin', { firstName: 'Hannah', officeId: 'hph', isOfficeAdmin: true });
  fakeDb._seed('users', 'otherLeader', { firstName: 'Olly', officeId: 'other' });
  fakeDb._seed('users', 'deadLeader', { firstName: 'Dee', officeId: 'dead' });
  fakeDb._seed('users', 'plain', { firstName: 'Plain', officeId: 'hph' });
  fakeDb._seed('users', 'indep', { firstName: 'Indep' });
  fakeDb._seed('users', 'buyer', { firstName: 'Bea', lastName: 'Buyer', email: 'bea@x.test', phone: '0411', fcmToken: SECRET });

  fakeDb._seed('users', 'ann', { firstName: 'Ann', lastName: 'A', officeId: 'hph', accountStatus: 'active', email: 'ann@hph.test', fcmToken: SECRET });
  fakeDb._seed('users', 'bob', { firstName: 'Bob', lastName: 'B', officeId: 'hph', accountStatus: 'active', teamId: 't1' });
  fakeDb._seed('users', 'cat', { firstName: 'Cat', lastName: 'C', officeId: 'hph', accountStatus: 'active' });
  fakeDb._seed('users', 'dan', { firstName: 'Dan', lastName: 'D', officeId: 'hph', accountStatus: 'invited', invitedAt: ts('2026-10-01T00:00:00Z') });
  fakeDb._seed('users', 'outsider', { firstName: 'Out', officeId: 'other', accountStatus: 'active' });
  fakeDb._seed('officeInvites', 'hph_eve', { officeId: 'hph', status: 'pending', targetUid: 'eve', targetName: 'Eve', createdAt: ts('2026-10-20T00:00:00Z') });

  fakeDb._seed('properties', 'p1', { userId: 'ann', formattedAddress: '1 Ann St', createdAt: ts('2026-09-10T00:00:00Z'), price: 900000, visibility: true, stats: { views: 40 }, billingNote: SECRET });
  fakeDb._seed('properties', 'p2', { userId: 'bob', formattedAddress: '2 Bob St', createdAt: ts('2026-10-10T00:00:00Z'), visibility: true, stats: { views: 10 } });
  fakeDb._seed('properties', 'p3', { userId: 'ann', formattedAddress: '3 Sold St', archived: true, archivedReason: 'sold', createdAt: ts('2026-08-01T00:00:00Z') });
  fakeDb._seed('properties', 'p4', { userId: 'bob', formattedAddress: '4 Removed St', hidden: true, createdAt: ts('2026-08-01T00:00:00Z') });
  fakeDb._seed('properties', 'pOut', { userId: 'outsider', formattedAddress: '9 Other St', createdAt: ts('2026-08-01T00:00:00Z') });

  // p1 (Ann): 3 opinions (1 registered). One is by Bob's teammate-linked account — still Ann's.
  fakeDb._seed('offers', 'o1', { propertyId: 'p1', type: 'opinion', offerAmount: 900000, createdAt: ts('2026-11-03T00:00:00Z') }); // this week
  fakeDb._seed('offers', 'o2', { propertyId: 'p1', type: 'opinion', serious: true, userId: 'bob', buyerName: 'Real Buyer', buyerEmail: 'real@buyer.test', buyerPhone: '0400111222', createdAt: ts('2026-10-20T00:00:00Z') }); // this month? no: October
  fakeDb._seed('offers', 'o3', { propertyId: 'p1', type: 'opinion', createdAt: ts('2026-11-01T20:00:00Z') }); // 2 Nov Sydney = this month, last week (Mon 2 Nov is the week start)
  fakeDb._seed('offers', 'o4', { propertyId: 'p1', type: 'comment' }); // not an opinion
  fakeDb._seed('offers', 'o5', { propertyId: 'p4', type: 'opinion' }); // removed campaign
  fakeDb._seed('offers', 'o6', { propertyId: 'pOut', type: 'opinion' }); // other office
  // p2 (Bob): 3 opinions → ties Ann on opinions; Ann has 1 registration so she ranks first
  fakeDb._seed('offers', 'o7', { propertyId: 'p2', type: 'opinion', createdAt: ts('2026-11-03T00:00:00Z') });
  fakeDb._seed('offers', 'o8', { propertyId: 'p2', type: 'opinion', createdAt: ts('2026-11-03T01:00:00Z') });
  fakeDb._seed('offers', 'o9', { propertyId: 'p2', type: 'opinion', createdAt: ts('2026-09-03T01:00:00Z') });
  fakeDb._seed('likes', 'l1', { propertyId: 'p1', userId: 'buyer' });
}

const req = (url, { token = 't' } = {}) =>
  new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const as = (uid) => mockVerifyIdToken.mockResolvedValue({ uid });

beforeEach(() => { seed(); vi.clearAllMocks(); });

describe('requireLeadership (server-side scope + membership)', () => {
  const run = async (uid) => (await import('../../src/app/api/services/leadershipService')).requireLeadership(fakeDb, uid);

  it('David and Trevor resolve to the SAME office scope, each with their own profile', async () => {
    const d = await run('david'); const t = await run('trevor');
    expect(d.officeId).toBe('hph'); expect(t.officeId).toBe('hph');
    expect(d.leader.firstName).toBe('David'); expect(t.leader.firstName).toBe('Trevor');
  });
  it('denies ordinary agents, office admins who are not leaders, independents and buyers', async () => {
    for (const uid of ['plain', 'hphAdmin', 'indep', 'buyer', 'ann']) {
      await expect(run(uid)).rejects.toMatchObject({ status: 403 });
    }
  });
  it('denies a missing uid (401) and an unknown user', async () => {
    await expect(run(null)).rejects.toMatchObject({ status: 401 });
    await expect(run('ghost')).rejects.toMatchObject({ status: 403 });
  });
  it('denies a leader of a non-active office', async () => {
    await expect(run('deadLeader')).rejects.toMatchObject({ status: 403 });
  });
  it('a leader whose own account is linked to a DIFFERENT office is refused', async () => {
    fakeDb._seed('users', 'david', { firstName: 'David', officeId: 'other' });
    await expect(run('david')).rejects.toMatchObject({ status: 403 });
  });
  it('another office\'s leader only ever sees their own office (cross-office)', async () => {
    expect((await run('otherLeader')).officeId).toBe('other');
  });
  it('access follows leadershipUids live: removal ends it immediately', async () => {
    expect((await run('trevor')).officeId).toBe('hph');
    fakeDb._seed('officeAdminInfo', 'hph', { name: 'HPH', status: 'active', leadershipUids: ['david'] });
    await expect(run('trevor')).rejects.toMatchObject({ status: 403 });
  });
});

describe('GET /api/leadership/hub', () => {
  const call = async (uid, opts) => {
    if (uid) as(uid);
    const { GET } = await import('../../src/app/api/leadership/hub/route.js');
    return GET(req('http://localhost/api/leadership/hub', opts));
  };

  it('401 without a token; 403 for an ordinary agent, an office admin and a leader of another office\'s data is theirs only', async () => {
    expect((await call(null, { token: null })).status).toBe(401);
    mockVerifyIdToken.mockRejectedValue(new Error('bad'));
    expect((await call(null)).status).toBe(401);
    for (const uid of ['plain', 'hphAdmin', 'ann']) expect((await call(uid)).status).toBe(403);
  });

  it('David and Trevor receive identical office data; only the personal profile differs', async () => {
    const d = await (await call('david')).json();
    const t = await (await call('trevor')).json();
    expect(d.leader.firstName).toBe('David');
    expect(t.leader.firstName).toBe('Trevor');
    const strip = ({ leader, generatedAt, ...rest }) => rest;
    expect(strip(d)).toEqual(strip(t));
  });

  it('never includes another office\'s agents, campaigns or opinions', async () => {
    const body = await (await call('david')).json();
    const text = JSON.stringify(body);
    expect(text).not.toContain('outsider');
    expect(text).not.toContain('9 Other St');
    expect(body.overview.campaigns).toBe(3); // p1, p2, p3 (p4 removed by agent)
  });

  it('counts opinions once, attributes to the listing agent, and treats registrations as a subset', async () => {
    const body = await (await call('david')).json();
    const ann = body.agents.find((a) => a.uid === 'ann');
    const bob = body.agents.find((a) => a.uid === 'bob');
    expect(ann).toMatchObject({ opinions: 3, registrations: 1, campaigns: 2, activeCampaigns: 1 });
    expect(bob).toMatchObject({ opinions: 3, registrations: 0, campaigns: 1 });
    expect(body.overview).toMatchObject({ opinions: 6, registrations: 1, campaigns: 3, activeCampaigns: 2, views: 50 });
    // The buyer-linked uid ('bob' on o2) does not move the opinion off Ann.
  });

  it('time filters use the opinion submission date (Sydney calendar week/month), not property creation', async () => {
    const { leaderboard } = await (await call('david')).json();
    const get = (p, uid) => leaderboard[p].find((r) => r.uid === uid);
    // This week (Mon 2 Nov Sydney →): o1, o3 (Ann: 2); o7, o8 (Bob: 2)
    expect(get('week', 'ann').opinions).toBe(2);
    expect(get('week', 'bob').opinions).toBe(2);
    // This month (1 Nov →): same four; o2 (20 Oct) and o9 (3 Sep) are outside
    expect(get('month', 'ann').opinions).toBe(2);
    expect(get('month', 'bob').opinions).toBe(2);
    expect(get('month', 'ann').registrations).toBe(0);
    expect(get('all', 'ann').registrations).toBe(1);
  });

  it('breaks ties deterministically (opinions, registrations, campaigns, name, uid) and shares a rank only when fully level', async () => {
    const { leaderboard } = await (await call('david')).json();
    expect(leaderboard.all.map((r) => r.uid).slice(0, 2)).toEqual(['ann', 'bob']);
    expect(leaderboard.all[0].rank).toBe(1);
    expect(leaderboard.all[1].rank).toBe(2);
    // week: Ann and Bob level on opinions/registrations; Ann has more campaigns → still ordered, ranks differ
    expect(leaderboard.week.map((r) => r.uid).slice(0, 2)).toEqual(['ann', 'bob']);
    const { rankAgents } = await import('../../src/app/api/services/leadershipService');
    const level = rankAgents([
      { uid: 'z', name: 'Zed', opinions: 2, registrations: 0, campaigns: 1 },
      { uid: 'a', name: 'Abe', opinions: 2, registrations: 0, campaigns: 1 },
    ]);
    expect(level.map((r) => r.uid)).toEqual(['a', 'z']);
    expect(level.map((r) => r.rank)).toEqual([1, 1]);
    // identical input in any order → identical output
    expect(rankAgents([...level].reverse())).toEqual(level);
  });

  it('flags non-activated and activated-without-campaign agents without inferring inactivity from sign-in', async () => {
    mockGetUsers.mockRejectedValueOnce(new Error('auth down'));
    const body = await (await call('david')).json();
    expect(body.attention.notActivated.sort()).toEqual(['dan', 'eve']);
    expect(body.attention.activatedNoCampaign.sort()).toEqual(['cat', 'hphAdmin', 'plain']); // all members with zero campaigns
    expect(body.attention.activatedNoCampaign).not.toContain('ann');
    expect(body.attention.strongEngagement.length).toBeGreaterThan(0);
    // sign-in lookup failed → unknown (null), and nobody is called inactive because of it
    expect(body.agents.every((a) => a.lastSignInAt === null)).toBe(true);
    expect(body.attention.notActivated).not.toContain('cat');
  });

  it('reports last sign-in separately from campaign activity', async () => {
    const body = await (await call('david')).json();
    const cat = body.agents.find((a) => a.uid === 'cat');
    expect(cat.lastSignInAt).toBe('2026-11-03T01:00:00.000Z');
    expect(cat.latestCampaignAt).toBeNull();
    expect(cat.campaigns).toBe(0);
  });

  it('exposes no buyer identity, contact detail, token or billing field anywhere', async () => {
    const text = JSON.stringify(await (await call('david')).json());
    for (const leak of ['real@buyer.test', '0400111222', 'Real Buyer', 'bea@x.test', '0411', SECRET, 'ann@hph.test', 'billing', 'xero', 'invoice']) {
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});

describe('GET /api/leadership/access', () => {
  it('tells leaders apart from everyone else without erroring', async () => {
    const { GET } = await import('../../src/app/api/leadership/access/route.js');
    as('david');
    expect(await (await GET(req('http://localhost/x'))).json()).toMatchObject({ leader: true });
    as('plain');
    expect(await (await GET(req('http://localhost/x'))).json()).toEqual({ leader: false });
  });
});

describe('GET /api/leadership/properties/[id]/report (read-only, buyer-redacted)', () => {
  const call = async (uid, id) => {
    if (uid) as(uid);
    const { GET } = await import('../../src/app/api/leadership/properties/[id]/report/route.js');
    return GET(req(`http://localhost/api/leadership/properties/${id}/report`), { params: Promise.resolve({ id }) });
  };

  it('returns anonymised opinions only — no names, emails, phones, uids or buyer profiles', async () => {
    const res = await call('trevor', 'p1');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ readOnly: true, redacted: true, totals: { opinions: 3, registrations: 1, likes: 1 } });
    expect(body.opinions).toHaveLength(3);
    const text = JSON.stringify(body);
    for (const leak of ['real@buyer.test', '0400111222', 'Real Buyer', 'bea@x.test', SECRET, '"userId"', 'buyerEmail', 'buyerPhone']) {
      expect(text).not.toContain(leak);
    }
    expect(body.listingAgent.name).toBe('Ann A');
  });
  it('404 (not 403) for another office\'s campaign, a removed campaign and a missing one — ids cannot be probed', async () => {
    for (const id of ['pOut', 'p4', 'nope']) expect((await call('david', id)).status).toBe(404);
  });
  it('denies ordinary agents, office admins and unauthenticated callers', async () => {
    for (const uid of ['plain', 'hphAdmin', 'ann']) expect((await call(uid, 'p1')).status).toBe(403);
    expect((await call('otherLeader', 'p1')).status).toBe(404);
    mockVerifyIdToken.mockRejectedValue(new Error('bad'));
    expect((await call(null, 'p1')).status).toBe(401);
  });
});

describe('read-only and isolation guarantees', () => {
  const root = path.resolve(__dirname, '../../src/app/api/leadership');
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.join(d, f.name)); })(root);

  it('every leadership route exports GET only (no write verbs)', async () => {
    const routes = files.filter((f) => f.endsWith('route.js'));
    expect(routes.length).toBe(4);
    for (const f of routes) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)/);
      expect(src).toMatch(/export\s+async\s+function\s+GET/);
    }
  });
  it('leadership code never writes to Firestore and never touches billing, invoicing, Xero or superAdmin', () => {
    const svc = path.resolve(__dirname, '../../src/app/api/services/leadershipService.js');
    const metrics = path.resolve(__dirname, '../../src/app/api/services/leadershipMetrics.js');
    for (const f of [...files, svc, metrics]) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src).not.toMatch(/\)\s*\.(set|update|add|delete|create)\(|\.(batch|runTransaction)\(/);
      expect(src).not.toMatch(/FieldValue|billingService|invoice|xero|verifyAdmin|superAdmin|officeAdminUids/i);
    }
  });
  it('leadership grants nothing on the existing office-admin and property-report routes', async () => {
    const { getPropertyReportAccess } = await import('../../src/app/api/services/propertyAccessService');
    const property = (await fakeDb.collection('properties').doc('p1').get()).data();
    expect(await getPropertyReportAccess(fakeDb, { uid: 'david', property })).toBeNull();
    const { requireOfficeAdmin } = await import('../../src/app/api/services/officeService');
    await expect(requireOfficeAdmin({ officeId: 'hph', uid: 'david' })).rejects.toMatchObject({ status: 403 });
  });
});


describe('GET /api/leadership/agents/[uid] (coaching profile)', () => {
  const call = async (uid, target, opts) => {
    if (uid) as(uid);
    const { GET } = await import('../../src/app/api/leadership/agents/[uid]/route.js');
    return GET(req(`http://localhost/api/leadership/agents/${target}`, opts), { params: Promise.resolve({ uid: target }) });
  };

  it('401 unauthenticated; 403 for ordinary agents, office admins and the agent themself', async () => {
    expect((await call(null, 'ann', { token: null })).status).toBe(401);
    for (const uid of ['plain', 'hphAdmin', 'ann', 'indep']) expect((await call(uid, 'ann')).status).toBe(403);
  });

  it('404 (never data) for another office\'s agent, a pending invitee, a leader\'s own id and an unknown id', async () => {
    for (const target of ['outsider', 'eve', 'david', 'ghost']) expect((await call('david', target)).status).toBe(404);
    // and the other office's leader cannot read HPH agents either
    expect((await call('otherLeader', 'ann')).status).toBe(404);
  });

  it('figures match the Hub exactly, and David and Trevor see the same profile', async () => {
    const hub = await (await (await import('../../src/app/api/leadership/hub/route.js')).GET((as('david'), req('http://localhost/h')))).json();
    const d = await (await call('david', 'ann')).json();
    const t = await (await call('trevor', 'ann')).json();
    const row = hub.agents.find((a) => a.uid === 'ann');
    expect(d.agent).toEqual(row);
    expect(d.summary).toMatchObject({ campaigns: 2, opinions: 3, registrations: 1, views: 40, campaignsWithFeedback: 1 });
    expect(d.ranks.all).toEqual({ rank: hub.leaderboard.all.find((r) => r.uid === 'ann').rank, of: hub.leaderboard.all.length });
    expect(d.leader.firstName).toBe('David'); expect(t.leader.firstName).toBe('Trevor');
    const strip = ({ leader, generatedAt, weekly, ...rest }) => rest;
    expect(strip(d)).toEqual(strip(t));
    expect(d.properties.map((p) => p.id).sort()).toEqual(['p1', 'p3']); // never Bob's or another office's
  });

  it('exposes no buyer identity, contact detail, token or billing field', async () => {
    const text = JSON.stringify(await (await call('david', 'ann')).json()).toLowerCase();
    for (const leak of ['real@buyer.test', '0400111222', 'real buyer', 'bea@x.test', SECRET.toLowerCase(), 'ann@hph.test', 'billing', 'xero']) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('buildAgentProfile — coaching observations', () => {
  const day = (n) => new Date(NOW.getTime() - n * 86400000);
  const base = () => ({
    now: NOW,
    members: [{ uid: 'x', firstName: 'Xena', lastName: 'X', accountStatus: 'active', activatedAt: day(100) }, { uid: 'y', firstName: 'Yan', accountStatus: 'active' }],
    properties: [], opinions: [], lastSignIns: {},
  });
  const prop = (id, o = {}) => ({ id, userId: 'x', formattedAddress: `${id} St`, createdAt: day(20), visibility: true, stats: { views: 0 }, ...o });
  const opn = (id, propertyId, daysAgo, serious = false) => ({ id, propertyId, type: 'opinion', serious, createdAt: day(daysAgo) });
  const profile = async (inputs, uid = 'x') => (await import('../../src/app/api/services/leadershipMetrics')).buildAgentProfile(inputs, uid);
  const ids = (p) => p.coaching.map((c) => c.id);

  it('flags active campaigns with zero opinions, but not sold/archived ones', async () => {
    const i = base();
    i.properties = [prop('a', { stats: { views: 10 } }), prop('b', { stats: { views: 5 } }), prop('sold', { visibility: false, archived: true, archivedReason: 'sold' })];
    const p = await profile(i);
    const item = p.coaching.find((c) => c.id === 'no-opinions');
    expect(item.propertyIds.sort()).toEqual(['a', 'b']);
    expect(item.title).toMatch(/^2 active campaigns have no buyer opinions$/);
    expect(item.detail).toContain('15 views');
  });

  it('flags views with few (1–2) opinions, and strong feedback by opinions or registrations', async () => {
    const i = base();
    i.properties = [prop('few', { stats: { views: 30 } }), prop('quiet', { stats: { views: 30 } }), prop('big'), prop('regs')];
    i.opinions = [
      opn('1', 'few', 3), opn('2', 'few', 4),
      ...[1, 2, 3, 4, 5].map((n) => opn(`b${n}`, 'big', n)),
      opn('r1', 'regs', 2, true), opn('r2', 'regs', 3, true),
    ];
    const p = await profile(i);
    expect(p.coaching.find((c) => c.id === 'views-limited-opinions').propertyIds).toEqual(['few']);
    expect(p.coaching.find((c) => c.id === 'strong-feedback').propertyIds).toEqual(['big', 'regs']);
    expect(p.coaching.find((c) => c.id === 'no-opinions').propertyIds).toEqual(['quiet']); // zero opinions is reported once, not as "few"
  });

  it('activated-without-campaign and not-activated are stated factually', async () => {
    const none = await profile(base());
    expect(none.coaching[0]).toMatchObject({ id: 'no-campaigns', tone: 'attention' });
    expect(none.coaching[0].detail).toMatch(/Activated on/);
    const i = base(); i.members[0] = { uid: 'x', firstName: 'Xena', accountStatus: 'invited', invitedAt: day(10) };
    expect((await profile(i)).coaching[0]).toMatchObject({ id: 'not-activated' });
  });

  it('compares the last 30 days with the 30 before: up, down, steady and gone quiet', async () => {
    const run = async (recent, earlier) => {
      const i = base(); i.properties = [prop('a', { stats: { views: 1 } })];
      i.opinions = [...Array(recent).keys()].map((n) => opn(`r${n}`, 'a', 5 + n)).concat([...Array(earlier).keys()].map((n) => opn(`e${n}`, 'a', 35 + n)));
      return profile(i);
    };
    expect(ids(await run(4, 2))).toContain('trend-up');
    expect(ids(await run(1, 3))).toContain('trend-down');
    expect(ids(await run(2, 2))).toContain('trend-steady');
    expect(ids(await run(0, 3))).toContain('trend-quiet');
    expect(ids(await run(0, 0)).some((x) => x.startsWith('trend-'))).toBe(false);
    const up = await run(4, 2);
    expect(up.summary).toMatchObject({ opinionsLast30: 4, opinionsPrior30: 2 });
  });

  it('flags a long gap since the last upload', async () => {
    const i = base(); i.properties = [prop('old', { createdAt: day(70) })];
    expect(ids(await profile(i))).toContain('no-recent-campaign');
    const j = base(); j.properties = [prop('new', { createdAt: day(10) })];
    expect(ids(await profile(j))).not.toContain('no-recent-campaign');
  });

  it('never labels or scores an agent', async () => {
    const i = base(); i.properties = [prop('a')];
    const text = JSON.stringify(await profile(i)).toLowerCase();
    for (const bad of ['poor', 'underperform', 'weak', 'score', 'grade', 'lazy', 'inactive', 'failing']) expect(text).not.toContain(bad);
  });

  it('does not double count duplicated opinion documents and ignores other agents\' campaigns', async () => {
    const i = base();
    i.properties = [prop('a'), prop('mine-not', { userId: 'y' })];
    i.opinions = [opn('dup', 'a', 2, true), opn('dup', 'a', 2, true), opn('other', 'mine-not', 2)];
    const p = await profile(i);
    expect(p.summary).toMatchObject({ opinions: 1, registrations: 1 });
    expect(p.weekly.reduce((n, w) => n + w.opinions, 0)).toBe(1);
    expect(p.properties.map((x) => x.id)).toEqual(['a']);
  });

  it('returns null for someone who is not a current member', async () => {
    expect(await profile(base(), 'nobody')).toBeNull();
  });
});
