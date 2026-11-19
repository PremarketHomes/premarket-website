import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// Team managers: members listed in a team's server-only `managerUids` run every campaign of THEIR team (any uploader),
// with the full (privacy-separated) report, emailing it only to the selling agent or themselves, and may remove members.
// Nothing for invited (not yet activated) accounts, other teams, other offices or the rest of the office.

// ── in-memory Firestore: doc get/set/update, where ('==' / 'in'), simple transactions ──
const DELETE = Symbol('delete');
let store;
const snap = (c, id) => ({ exists: store[c]?.[id] !== undefined, id, ref: ref(c, id), data: () => (store[c]?.[id] ? { ...store[c][id] } : undefined) });
const patch = (base, p) => { const o = { ...base }; for (const [k, v] of Object.entries(p)) { if (v === DELETE) delete o[k]; else o[k] = v; } return o; };
function ref(c, id) {
  return {
    id, _c: c,
    get: async () => snap(c, id),
    set: async (d) => { (store[c] ||= {})[id] = { ...d }; },
    update: async (p) => { store[c][id] = patch(store[c][id], p); },
  };
}
function col(c, filters = []) {
  return {
    doc: (id) => ref(c, id),
    where: (f, op, v) => col(c, [...filters, [f, op, v]]),
    add: async (d) => { const id = `auto${Object.keys(store[c] || {}).length + 1}`; (store[c] ||= {})[id] = { ...d }; return { id }; },
    get: async () => {
      const docs = Object.keys(store[c] || {}).map((id) => snap(c, id))
        .filter((s) => filters.every(([f, op, v]) => (op === 'in' ? v.includes(s.data()[f]) : s.data()[f] === v)));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  };
}
const fakeDb = {
  collection: (c) => col(c),
  runTransaction: async (fn) => {
    const writes = [];
    const out = await fn({
      get: (x) => x.get(),
      update: (r, p) => writes.push(() => { store[r._c][r.id] = patch(store[r._c][r.id], p); }),
      set: (r, d) => writes.push(() => { (store[r._c] ||= {})[r.id] = { ...d }; }),
      delete: (r) => writes.push(() => { delete store[r._c][r.id]; }),
      create: (r, d) => writes.push(() => { (store[r._c] ||= {})[r.id] = { ...d }; }),
    });
    writes.forEach((w) => w());
    return out;
  },
  batch: () => ({ set: () => {}, update: () => {}, commit: async () => {} }),
};
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => fakeDb[p] }) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => DELETE, arrayRemove: (v) => v } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUser: async (uid) => ({ uid, disabled: false }) }) }));
const mockGatherReport = vi.fn(async () => {});
vi.mock('../../src/app/api/services/reportService', () => ({ gatherReport: (...a) => mockGatherReport(...a) }));
vi.mock('../../src/app/api/services/resendService', () => ({ sendEmail: vi.fn(), sendTeamInviteEmail: vi.fn(), sendPropertyReadyEmail: vi.fn() }));
vi.mock('../../src/app/api/services/agentNotificationService', () => ({ sendCampaignLinkOnce: vi.fn(async () => ({ sent: true })) }));
vi.mock('../../src/app/api/middleware/auth', () => ({
  verifyAuth: async (req) => {
    const uid = req.headers.get('x-test-uid');
    return uid ? { authenticated: true, uid } : { authenticated: false, error: 'Unauthorized', status: 401 };
  },
}));

const { managedTeamOf, isTeamCampaign, isTeamManagerFor } = await import('../../src/app/api/services/teamAccess');
const { getPropertyReportAccess, getPropertyReportData, teamManagerReportRecipients } = await import('../../src/app/api/services/propertyAccessService');
const { resolveCampaignRole, listTeamManagerCampaigns, updateManagedProperty, updateManagedDetails } = await import('../../src/app/api/services/managedCampaignService');
const { removeTeamMember, getTeamOverview } = await import('../../src/app/api/services/teamService');
const sendReport = (await import('../../src/app/api/send-report/route')).POST;
const bsoAccess = (await import('../../src/app/api/bso/access/route')).GET;
const teamCampaigns = (await import('../../src/app/api/teams/campaigns/route')).GET;

const HPH = 'hph';
const TEAM = 'mh';
const agent = (first, last, extra = {}) => ({ firstName: first, lastName: last, email: `${first.toLowerCase()}@hph.test`, agent: true, roles: ['agent'], officeId: HPH, accountStatus: 'active', ...extra });
const prop = (userId, address, extra = {}) => ({ userId, formattedAddress: address, address: 'Suburb', visibility: true, archived: false, createdAt: '2026-11-10T00:00:00Z', stats: { views: 5 }, ...extra });

beforeEach(() => {
  process.env.MANAGED_CAMPAIGNS_ENABLED = '1';
  mockGatherReport.mockClear();
  store = {
    officeAdminInfo: {
      [HPH]: { name: 'Harcourts Property Hub', status: 'active', officeAdminUids: ['jess'], bsoUids: ['peta', 'bailey'] },
      other: { name: 'Other', status: 'active', officeAdminUids: [], bsoUids: [] },
    },
    teams: {
      [TEAM]: { name: 'Mitch Harrop Team', officeId: HPH, createdBy: 'bailey', managerUids: ['estelle', 'erika'] },
      t2: { name: 'Other Team', officeId: HPH, createdBy: 'gina' },
    },
    users: {
      estelle: agent('Estelle', 'Aston', { teamId: TEAM }),
      erika: agent('Erika', 'Zatyko', { teamId: TEAM }),
      mitch: agent('Mitch', 'Harrop', { teamId: TEAM }),
      bailey: agent('Bailey', 'Thornley', { teamId: TEAM }),
      george: agent('George', 'May', { teamId: TEAM, accountStatus: 'invited' }),
      peta: agent('Peta', 'Harris'), // HPH BSO, not in the team
      gina: agent('Gina', 'Other', { teamId: 't2' }),
      hal: agent('Hal', 'Other', { teamId: 't2' }),
      jess: agent('Jessica', 'Charley', { agent: false, roles: [] }),
      olly: agent('Olly', 'Outside', { officeId: 'other', teamId: TEAM }), // stale pointer from another office
      buyer1: { firstName: 'Bea', lastName: 'Buyer', email: 'bea@buyer.test', phone: '0411' },
    },
    properties: {
      // Estelle uploads under her own account for Mitch (roster agent)
      placid: prop('estelle', '4 Placid Ct, Varsity Lakes QLD 4227, Australia', { agentId: 'r1', agentName: 'Mitch Harrop' }),
      // A BSO outside the team uploaded under the agent's account and manages it
      managed: prop('mitch', '1 Managed St, Robina QLD 4226, Australia', { createdByUid: 'peta', createdByRole: 'bso', managedByUid: 'peta' }),
      // A BSO outside the team uploaded under her OWN account for Mitch (older flow)
      petaForMitch: prop('peta', '2 Roster Rd, Robina QLD 4226, Australia', { agentId: 'r2', agentName: 'Mitch Harrop' }),
      // George is invited (never logged in): a BSO created his campaign for him
      georgeProp: prop('george', '3 George St, Burleigh QLD 4220, Australia'),
      hiddenOne: prop('mitch', 'Hidden', { hidden: true }),
      // Not the team's
      petaOwn: prop('peta', '9 Peta Pl, Southport QLD 4215, Australia'),
      ginaProp: prop('gina', '5 Gina Ave, Nerang QLD 4211, Australia'),
    },
    offers: {
      o1: { propertyId: 'placid', type: 'opinion', serious: true, userId: 'buyer1', buyerName: 'Bea Buyer', buyerEmail: 'bea@buyer.test', offerAmount: 1200000, createdAt: '2026-11-11T00:00:00Z' },
      o2: { propertyId: 'placid', type: 'opinion', serious: false, offerAmount: 1100000, createdAt: '2026-11-12T00:00:00Z' },
    },
  };
});

const req = (uid, url = 'http://x/api', { method = 'GET', body } = {}) => new Request(url, {
  method, headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-test-uid': uid } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const user = (uid) => store.users[uid];
const P = (id) => store.properties[id];

describe('who is a team manager (server-only managerUids, live checks)', () => {
  it('a listed, activated member of the team', async () => {
    expect((await managedTeamOf(fakeDb, { actorUid: 'estelle', actor: user('estelle') }))?.id).toBe(TEAM);
    expect((await managedTeamOf(fakeDb, { actorUid: 'erika', actor: user('erika') }))?.id).toBe(TEAM);
  });
  it('nothing until an invited account activates itself (Erika before signing in)', async () => {
    store.users.erika.accountStatus = 'invited';
    expect(await managedTeamOf(fakeDb, { actorUid: 'erika', actor: user('erika') })).toBeNull();
  });
  it('nothing for ordinary members, other teams, a member who left, another office or an inactive office', async () => {
    expect(await managedTeamOf(fakeDb, { actorUid: 'mitch', actor: user('mitch') })).toBeNull(); // member, not listed
    expect(await managedTeamOf(fakeDb, { actorUid: 'gina', actor: user('gina') })).toBeNull();
    store.users.erika.teamId = 't2'; // left the team: the listing alone grants nothing
    expect(await managedTeamOf(fakeDb, { actorUid: 'erika', actor: user('erika') })).toBeNull();
    store.teams[TEAM].managerUids.push('olly'); // listed, but in another office
    expect(await managedTeamOf(fakeDb, { actorUid: 'olly', actor: user('olly') })).toBeNull();
    store.officeAdminInfo[HPH].status = 'suspended';
    expect(await managedTeamOf(fakeDb, { actorUid: 'estelle', actor: user('estelle') })).toBeNull();
  });
});

describe('which campaigns are the team\'s (whoever uploaded them)', () => {
  const team = { id: TEAM, ...{ officeId: HPH } };
  it.each([
    ['owned by a member, roster agent Mitch', 'placid', true],
    ['BSO-uploaded under the agent\'s account', 'managed', true],
    ['BSO\'s own account, roster selling agent in the team', 'petaForMitch', true],
    ['an invited member\'s campaign created for them', 'georgeProp', true],
    ['the BSO\'s own other campaign', 'petaOwn', false],
    ['another team\'s campaign', 'ginaProp', false],
  ])('%s', async (_n, id, expected) => {
    expect(await isTeamCampaign(fakeDb, { team, property: P(id), owner: user(P(id).userId) })).toBe(expected);
  });
  it('an ambiguous roster name matches nobody', async () => {
    store.users.mitch2 = agent('Mitch', 'Harrop'); // a second "Mitch Harrop" in the office, not in the team
    expect(await isTeamCampaign(fakeDb, { team, property: P('petaForMitch'), owner: user('peta') })).toBe(false);
  });
});

describe('reports: full (separated) report on the team\'s campaigns only', () => {
  it('teamManager on every team campaign; nothing on other HPH campaigns', async () => {
    for (const id of ['managed', 'petaForMitch', 'georgeProp']) {
      expect(await getPropertyReportAccess(fakeDb, { uid: 'erika', property: P(id) }), id).toBe('teamManager');
    }
    expect(await getPropertyReportAccess(fakeDb, { uid: 'erika', property: P('placid') })).toBe('teamManager');
    expect(await getPropertyReportAccess(fakeDb, { uid: 'estelle', property: P('placid') })).toBe('owner'); // unchanged
    for (const id of ['petaOwn', 'ginaProp']) expect(await getPropertyReportAccess(fakeDb, { uid: 'erika', property: P(id) }), id).toBeNull();
    // An ordinary member keeps the redacted teammate level
    expect(await getPropertyReportAccess(fakeDb, { uid: 'mitch', property: P('placid') })).toBe('teamMember');
  });
  it('the report has registrations with contact details but no price, and anonymous prices', async () => {
    const r = await getPropertyReportData(fakeDb, { uid: 'erika', propertyId: 'placid' });
    expect(r).toMatchObject({ status: 200, access: 'teamManager', readOnly: true });
    expect(r.registrations).toEqual([expect.objectContaining({ id: 'o1', name: 'Bea Buyer', email: 'bea@buyer.test' })]);
    expect(r.registrations[0]).not.toHaveProperty('offerAmount');
    expect(r.priceOpinions).toEqual([{ offerAmount: 1200000 }, { offerAmount: 1100000 }]);
    expect(r.reportRecipients.map((x) => x.email)).toEqual(['mitch@hph.test', 'erika@hph.test']);
  });
  it('invited Erika gets no report at all until she activates', async () => {
    store.users.erika.accountStatus = 'invited';
    expect((await getPropertyReportData(fakeDb, { uid: 'erika', propertyId: 'placid' })).status).toBe(403);
  });
});

describe('emailing a report', () => {
  const send = (uid, email, propertyId = 'placid') => sendReport(req(uid, 'http://x/api/send-report', { method: 'POST', body: { email, propertyId, name: 'X' } }));
  it('a team manager may send it to the selling agent or themself only (emails on file)', async () => {
    expect((await send('erika', 'mitch@hph.test')).status).toBe(200);
    expect((await send('erika', ' ERIKA@hph.test ')).status).toBe(200);
    expect(mockGatherReport).toHaveBeenCalledTimes(2);
    for (const to of ['vendor@example.com', 'estelle@hph.test', 'bea@buyer.test']) expect((await send('erika', to)).status).toBe(403);
    expect((await send('erika', 'mitch@hph.test', 'petaOwn')).status).toBe(403); // not the team's
    expect(mockGatherReport).toHaveBeenCalledTimes(2);
  });
  it('ordinary members are still refused; the owner keeps sending anywhere', async () => {
    expect((await send('mitch', 'mitch@hph.test')).status).toBe(403);
    expect((await send('estelle', 'vendor@example.com')).status).toBe(200);
  });
  it('recipients: the roster selling agent, never the uploader', async () => {
    const r = await teamManagerReportRecipients(fakeDb, { uid: 'estelle', property: P('petaForMitch') });
    expect(r.map((x) => [x.role, x.email])).toEqual([['sellingAgent', 'mitch@hph.test'], ['me', 'estelle@hph.test']]);
  });
});

describe('managing the team\'s campaigns', () => {
  it('teamManager role on team campaigns: show/hide/archive and edit details through the server', async () => {
    expect(await resolveCampaignRole(fakeDb, { actorUid: 'erika', property: P('managed') })).toBe('teamManager');
    expect(await resolveCampaignRole(fakeDb, { actorUid: 'erika', property: P('petaOwn') })).toBeNull();
    await updateManagedProperty(fakeDb, { actorUid: 'erika', propertyId: 'managed', action: 'hide' });
    expect(P('managed').visibility).toBe(false);
    await expect(updateManagedProperty(fakeDb, { actorUid: 'erika', propertyId: 'ginaProp', action: 'hide' })).rejects.toMatchObject({ status: 404 });
    expect(P('ginaProp').visibility).toBe(true);
  });
  it('the Dashboard list: every team campaign (any uploader), nothing else, with views and opinion counts', async () => {
    const { campaigns } = await listTeamManagerCampaigns(fakeDb, 'erika');
    expect(campaigns.map((c) => c.id).sort()).toEqual(['georgeProp', 'managed', 'petaForMitch', 'placid']);
    const placid = campaigns.find((c) => c.id === 'placid');
    expect(placid).toMatchObject({ address: '4 Placid Ct, Varsity Lakes QLD 4227, Australia', access: 'teamManager', views: 5, opinions: 2 });
    expect(placid.sellingAgent.name).toBe('Mitch Harrop'); // the assigned selling agent, not the uploader
    expect((await listTeamManagerCampaigns(fakeDb, 'estelle')).campaigns.find((c) => c.id === 'placid').access).toBe('owner');
    await expect(listTeamManagerCampaigns(fakeDb, 'mitch')).rejects.toMatchObject({ status: 403 });
  });
  it('routes: /api/teams/campaigns and the access flag follow the server check', async () => {
    expect((await teamCampaigns(req('erika'))).status).toBe(200);
    expect((await teamCampaigns(req('mitch'))).status).toBe(403);
    expect((await teamCampaigns(req(null))).status).toBe(401);
    expect(await (await bsoAccess(req('erika'))).json()).toMatchObject({ bso: false, teamManager: true });
    expect(await (await bsoAccess(req('mitch'))).json()).toEqual({ bso: false });
  });
});

describe('team administration', () => {
  it('a team manager may remove members like the creator; ordinary members may not', async () => {
    await expect(removeTeamMember({ actorUid: 'mitch', targetUid: 'george' })).rejects.toMatchObject({ status: 403 });
    await removeTeamMember({ actorUid: 'erika', targetUid: 'george' });
    expect(user('george').teamId).toBeUndefined();
    const overview = await getTeamOverview('estelle');
    expect(overview.team.members.filter((m) => !m.isYou).every((m) => m.canRemove)).toBe(true);
  });
  it('managerUids is server-only: the team collection is closed to every client', () => {
    expect(readFileSync('firestore.rules', 'utf8')).toContain('match /teams/{teamId} { allow read, write: if false; }');
  });
});
