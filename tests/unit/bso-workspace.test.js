/**
 * BSO workspace: role, campaign creation, management identity, dashboards, access restrictions, reassignment,
 * reports, teams, public identity, billing and email routing. Real services and route handlers over an in-memory
 * Firestore; only Auth token checks, billing and the email sender are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/* ───────────── in-memory Firestore (supports where ==/in, transactions, arrayUnion/arrayRemove) ───────────── */
const store = new Map();
let autoId = 0;
function apply(cur, patch) {
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v && v.__op === 'union') out[k] = [...new Set([...(out[k] || []), ...v.v])];
    else if (v && v.__op === 'remove') out[k] = (out[k] || []).filter((x) => !v.v.includes(x));
    else if (v && v.__op === 'delete') delete out[k];
    else out[k] = v;
  }
  return out;
}
function docRef(path) {
  const id = path.split('/').pop();
  return {
    id, path,
    get: async () => (store.has(path) ? { exists: true, id, ref: docRef(path), data: () => store.get(path) } : { exists: false, id, data: () => undefined }),
    set: async (d, opts) => { store.set(path, opts?.merge ? apply(store.get(path) || {}, d) : apply({}, d)); },
    create: async (d) => { if (store.has(path)) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; } store.set(path, apply({}, d)); },
    update: async (p) => { if (!store.has(path)) throw new Error('NOT_FOUND'); store.set(path, apply(store.get(path), p)); },
  };
}
function colRef(name, filters = []) {
  return {
    doc: (id) => docRef(`${name}/${id || `auto${++autoId}`}`),
    add: async (d) => { const id = `auto${++autoId}`; store.set(`${name}/${id}`, apply({}, d)); return { id }; },
    where: (f, op, v) => colRef(name, [...filters, [f, op, v]]),
    get: async () => ({
      docs: [...store.entries()].filter(([p]) => p.startsWith(`${name}/`) && p.split('/').length === 2)
        .filter(([, d]) => filters.every(([f, op, v]) => (op === 'in' ? v.includes(d[f]) : d[f] === v)))
        .map(([p, d]) => ({ id: p.split('/')[1], ref: docRef(p), data: () => d })),
    }),
  };
}
function runTx(fn) {
  return fn({ get: (r) => r.get(), update: (r, p) => r.update(p), set: (r, d, o) => r.set(d, o), delete: (r) => { store.delete(r.path); } });
}
const db = { collection: (n) => colRef(n), runTransaction: (fn) => runTx(fn) };

const authSpies = { verifyIdToken: vi.fn(), getUser: vi.fn(async () => ({ disabled: false })) };
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: { collection: (n) => colRef(n), runTransaction: (fn) => runTx(fn) } }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'TS',
    arrayUnion: (...v) => ({ __op: 'union', v }),
    arrayRemove: (...v) => ({ __op: 'remove', v }),
    delete: () => ({ __op: 'delete' }),
  },
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => authSpies }));
const sendCampaignLinkOnce = vi.fn(async () => ({ sent: true }));
vi.mock('../../src/app/api/services/agentNotificationService', () => ({ sendCampaignLinkOnce: (...a) => sendCampaignLinkOnce(...a) }));
const recordPropertyCharge = vi.fn(async () => ({ created: true }));
vi.mock('../../src/app/api/services/billingService', () => ({ recordPropertyCharge: (...a) => recordPropertyCharge(...a), settleChargesForAgent: vi.fn(), recordOfficeDeparture: vi.fn() }));

import { POST as createRoute } from '../../src/app/api/properties/managed/route';
import { GET as agentsRoute } from '../../src/app/api/properties/managed/agents/route';
import { GET as roleRoute, PATCH as manageRoute } from '../../src/app/api/properties/[id]/managed/route';
import { POST as managerRoute } from '../../src/app/api/properties/[id]/managed/manager/route';
import { PUT as detailsRoute } from '../../src/app/api/properties/[id]/managed/details/route';
import { POST as mediaRoute } from '../../src/app/api/properties/[id]/managed/media/route';
import { POST as resendRoute } from '../../src/app/api/properties/[id]/campaign-link/resend/route';
import { GET as bsoAccessRoute } from '../../src/app/api/bso/access/route';
import { GET as bsoCampaignsRoute } from '../../src/app/api/bso/campaigns/route';
import { GET as bsoListRoute, POST as bsoGrantRoute } from '../../src/app/api/offices/[officeId]/bsos/route';
import { DELETE as bsoRevokeRoute } from '../../src/app/api/offices/[officeId]/bsos/[uid]/route';
import { GET as officeCampaignsRoute } from '../../src/app/api/offices/[officeId]/campaigns/route';
import { GET as registrationsRoute } from '../../src/app/api/registrations/managed/route';
import { resolveCampaignRole } from '../../src/app/api/services/managedCampaignService';
import { getPropertyReportAccess, getPropertyReportData, getBuyerProfilesForProperty } from '../../src/app/api/services/propertyAccessService';
import { resolveListingAgent } from '../../src/app/utils/listingAgent';

/* ───────────── fake office ───────────── */
// HPH-like office with Hannah (office admin), Peta and Bea (BSOs), Chantal (Sales Team A), Brad (Sales Team B),
// Cara (independent), Ivy (invited, never logged in), Tom (Team A member), Ann (Team A creator = former "Team Admin").
const person = (first, last, extra = {}) => ({ firstName: first, lastName: last, email: `${first.toLowerCase()}@office.test`, agent: true, roles: ['agent'], officeId: 'off1', accountStatus: 'active', ...extra });
function seed() {
  store.clear(); autoId = 0;
  recordPropertyCharge.mockClear(); sendCampaignLinkOnce.mockClear(); authSpies.verifyIdToken.mockReset();
  store.set('officeAdminInfo/off1', { name: 'Test Realty', officeAdminUids: ['hannah'], bsoUids: ['peta', 'bea'], status: 'active' });
  store.set('officeAdminInfo/off2', { name: 'Other Realty', officeAdminUids: ['otheradmin'], bsoUids: ['otherbso'], status: 'active' });
  store.set('users/hannah', person('Hannah', 'Admin', { isOfficeAdmin: true }));
  store.set('users/peta', person('Peta', 'Bso'));
  store.set('users/bea', person('Bea', 'Bso'));
  store.set('users/chantal', person('Chantal', 'Seller', { teamId: 'tA' }));
  store.set('users/tom', person('Tom', 'Teammate', { teamId: 'tA' }));
  store.set('users/ann', person('Ann', 'Creator', { teamId: 'tA' }));
  store.set('users/brad', person('Brad', 'Seller', { teamId: 'tB' }));
  store.set('users/bill', person('Bill', 'Teammate', { teamId: 'tB' }));
  store.set('users/cara', person('Cara', 'Independent'));
  store.set('users/ivy', person('Ivy', 'Invited', { accountStatus: 'invited' }));
  store.set('users/olly', person('Olly', 'Other', { officeId: 'off2' }));
  store.set('users/otheradmin', person('Other', 'Admin', { officeId: 'off2', isOfficeAdmin: true }));
  store.set('users/otherbso', person('Other', 'Bso', { officeId: 'off2' }));
  store.set('teams/tA', { officeId: 'off1', createdBy: 'ann', name: 'Sales Team A' });
  store.set('teams/tB', { officeId: 'off1', createdBy: 'brad', name: 'Sales Team B' });
}
const input = (extra = {}) => ({ address: '73 Test Avenue, Robina QLD', formattedAddress: '73 Test Avenue, Robina QLD 4226, Australia', price: '$1,250,000', bedrooms: 4, bathrooms: 2, carSpaces: 2, propertyType: 1, imageUrls: ['https://premarketvideos.b-cdn.net/a.jpg'], ...extra });
let n = 0;
const rid = () => `req-${String(++n).padStart(20, '0')}`;
const as = (uid) => { authSpies.verifyIdToken.mockResolvedValue({ uid }); };
const req = (method, body) => new Request('http://x', { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const call = async (route, uid, { method = 'GET', body, params = {} } = {}) => {
  as(uid);
  const res = await route(req(method, body), { params: Promise.resolve(params) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const create = (uid, ownerUid, extra = {}) => call(createRoute, uid, { method: 'POST', body: { ownerUid, requestId: rid(), acceptTerms: true, property: input(), ...extra } });
const prop = (id) => store.get(`properties/${id}`);
const audits = () => [...store.entries()].filter(([k]) => k.startsWith('officeCampaignAudit/')).map(([, v]) => v);
beforeEach(() => { seed(); process.env.MANAGED_CAMPAIGNS_ENABLED = '1'; });
afterEach(() => { delete process.env.MANAGED_CAMPAIGNS_ENABLED; delete process.env.OFFICE_REGISTRATIONS_ENABLED; });

/* ───────────── 1. the BSO role ───────────── */
describe('BSO role: assigned and removed by the office admin only', () => {
  it('Hannah gives and removes the role; each change is audited and idempotent', async () => {
    store.set('officeAdminInfo/off1', { ...store.get('officeAdminInfo/off1'), bsoUids: [] });
    expect((await call(bsoGrantRoute, 'hannah', { method: 'POST', body: { uid: 'peta' }, params: { officeId: 'off1' } })).body).toMatchObject({ changed: true, bso: true });
    expect((await call(bsoGrantRoute, 'hannah', { method: 'POST', body: { uid: 'peta' }, params: { officeId: 'off1' } })).body).toMatchObject({ changed: false, bso: true });
    expect(store.get('officeAdminInfo/off1').bsoUids).toEqual(['peta']);
    expect((await call(bsoListRoute, 'hannah', { params: { officeId: 'off1' } })).body.bsos).toEqual([{ uid: 'peta', name: 'Peta Bso', email: 'peta@office.test', active: true }]);
    expect((await call(bsoRevokeRoute, 'hannah', { method: 'DELETE', params: { officeId: 'off1', uid: 'peta' } })).body).toMatchObject({ changed: true, bso: false, campaignsNeedingManager: 0 });
    expect(store.get('officeAdminInfo/off1').bsoUids).toEqual([]);
    const log = [...store.entries()].filter(([k]) => k.startsWith('officeTeamAudit/')).map(([, v]) => v.action);
    expect(log).toEqual(['office.bsoGranted', 'office.bsoRevoked']);
    // nothing about the role is written to the user document
    expect(store.get('users/peta')).toEqual(person('Peta', 'Bso'));
  });
  it('BSOs, former team admins, agents and other offices cannot assign the role', async () => {
    for (const uid of ['peta', 'ann', 'chantal', 'otheradmin']) {
      expect((await call(bsoGrantRoute, uid, { method: 'POST', body: { uid: 'cara' }, params: { officeId: 'off1' } })).status).toBe(403);
      expect((await call(bsoListRoute, uid, { params: { officeId: 'off1' } })).status).toBe(403);
    }
    expect(store.get('officeAdminInfo/off1').bsoUids).toEqual(['peta', 'bea']);
  });
  it('only members of the office with a usable account can be made BSO', async () => {
    expect((await call(bsoGrantRoute, 'hannah', { method: 'POST', body: { uid: 'olly' }, params: { officeId: 'off1' } })).status).toBe(404);
    store.set('users/cara', { ...store.get('users/cara'), accountStatus: 'suspended' });
    expect((await call(bsoGrantRoute, 'hannah', { method: 'POST', body: { uid: 'cara' }, params: { officeId: 'off1' } })).status).toBe(409);
  });
  it('BSO access is live: removed role, moved office or suspension ends it immediately', async () => {
    expect((await call(bsoAccessRoute, 'peta')).body).toEqual({ bso: true, officeId: 'off1', officeName: 'Test Realty' });
    for (const uid of ['hannah', 'chantal', 'ann']) expect((await call(bsoAccessRoute, uid)).body).toEqual({ bso: false });
    store.set('users/peta', { ...store.get('users/peta'), accountStatus: 'suspended' });
    expect((await call(bsoAccessRoute, 'peta')).body).toEqual({ bso: false });
    store.set('users/peta', person('Peta', 'Bso', { officeId: 'off2' }));
    expect((await call(bsoAccessRoute, 'peta')).body).toEqual({ bso: false });
  });
});

/* ───────────── 2. creation ───────────── */
describe('BSO campaign creation', () => {
  it('Peta creates for agents in different sales teams, an independent agent and one who never logged in', async () => {
    for (const owner of ['chantal', 'brad', 'cara', 'ivy']) {
      const r = await create('peta', owner);
      expect(r.status).toBe(201);
      expect(prop(r.body.propertyId)).toMatchObject({
        userId: owner, managedByUid: 'peta', createdByUid: 'peta', createdByRole: 'bso', termsAcceptedBy: 'peta',
        agentId: null, vendorUploaded: false, managedCreation: true, visibility: false,
      });
    }
    // billing: the existing rule, on the selling agent (owner) — once per campaign
    expect(recordPropertyCharge.mock.calls.map((c) => c[0].userId)).toEqual(['chantal', 'brad', 'cara', 'ivy']);
    // email: the existing once-only campaign-link email, to the selling agent, never to the BSO
    expect(sendCampaignLinkOnce.mock.calls.map((c) => c[0])).toEqual(['chantal', 'brad', 'cara', 'ivy'].map((uid) => expect.objectContaining({ recipientUid: uid, seq: 1 })));
    expect(audits().every((a) => a.action === 'campaign.create' && a.actorRole === 'bso' && a.managedByUid === 'peta')).toBe(true);
  });
  it('the agent selector offers the whole office directory (including invited agents), never other offices or the BSO', async () => {
    const r = await call(agentsRoute, 'peta');
    expect(r.body.role).toBe('bso');
    expect(r.body.agents.map((a) => a.uid).sort()).toEqual(['ann', 'bea', 'bill', 'brad', 'cara', 'chantal', 'hannah', 'ivy', 'tom']);
    expect(r.body.agents.find((a) => a.uid === 'ivy').loginStatus).toBe('invited');
    expect(r.body.bsos).toBeUndefined();
    const h = await call(agentsRoute, 'hannah');
    expect(h.body.bsos.map((b) => b.uid)).toEqual(['bea', 'peta']);
  });
  it('a retried upload never creates a second campaign, charge or email', async () => {
    const body = { ownerUid: 'chantal', requestId: 'retry-request-id-00001', acceptTerms: true, property: input() };
    const a = await call(createRoute, 'peta', { method: 'POST', body });
    const b = await call(createRoute, 'peta', { method: 'POST', body });
    expect(b).toMatchObject({ status: 200, body: { propertyId: a.body.propertyId, duplicate: true } });
    expect([...store.keys()].filter((k) => k.startsWith('properties/'))).toHaveLength(1);
    expect(recordPropertyCharge).toHaveBeenCalledTimes(1);
    expect(sendCampaignLinkOnce).toHaveBeenCalledTimes(1);
  });
  it('a BSO cannot create for other offices or for themself, and cannot hand the campaign to someone else', async () => {
    expect((await create('peta', 'olly')).status).toBe(404);
    expect((await create('peta', 'peta')).status).toBe(404);
    expect((await create('peta', 'chantal', { managerUid: 'bea' })).status).toBe(400);
    expect((await create('otherbso', 'chantal')).status).toBe(404);
    expect([...store.keys()].some((k) => k.startsWith('properties/'))).toBe(false);
  });
  it('the Office Admin creates for any agent and either manages it or assigns one of the office BSOs', async () => {
    const own = await create('hannah', 'cara');
    expect(prop(own.body.propertyId)).toMatchObject({ userId: 'cara', managedByUid: 'hannah', createdByUid: 'hannah', createdByRole: 'officeAdmin' });
    const assigned = await create('hannah', 'chantal', { managerUid: 'peta' });
    expect(prop(assigned.body.propertyId)).toMatchObject({ userId: 'chantal', managedByUid: 'peta', createdByUid: 'hannah' });
    for (const notBso of ['ann', 'chantal', 'otherbso', 'nobody']) expect((await create('hannah', 'brad', { managerUid: notBso })).status).toBe(400);
  });
  it('former Team Admins and ordinary agents cannot create for anyone', async () => {
    for (const uid of ['ann', 'brad', 'chantal', 'tom']) expect((await create(uid, 'cara')).status).toBe(404);
  });
});

/* ───────────── 3. dashboards and restrictions ───────────── */
async function portfolio() {
  const ids = {};
  ids.petaChantal1 = (await create('peta', 'chantal')).body.propertyId;
  ids.petaChantal2 = (await create('peta', 'chantal')).body.propertyId;
  ids.petaBrad = (await create('peta', 'brad')).body.propertyId;
  ids.petaCara = (await create('peta', 'cara')).body.propertyId;
  ids.beaChantal = (await create('bea', 'chantal')).body.propertyId;
  // Chantal's own campaign (agent-led) and an older "uploaded under Peta's account for Chantal" campaign
  store.set('properties/chantalOwn', { userId: 'chantal', address: 'Own St', formattedAddress: '1 Own St', visibility: true });
  store.set('properties/legacy', { userId: 'peta', agentId: 'roster1', agentName: 'Chantal Seller', formattedAddress: '73 Riverwalk Ave, Robina', vendorUploaded: true, visibility: false });
  store.set('agents/roster1', { userId: 'peta', name: 'Chantal Seller' });
  return ids;
}

describe('BSO dashboard (server-filtered portfolio)', () => {
  it("lists exactly the campaigns Peta manages plus the one she owns, grouped by the selling agent", async () => {
    const ids = await portfolio();
    const r = await call(bsoCampaignsRoute, 'peta');
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.body.campaigns.map((c) => [c.id, c]));
    expect(Object.keys(byId).sort()).toEqual([ids.petaChantal1, ids.petaChantal2, ids.petaBrad, ids.petaCara, 'legacy'].sort());
    expect(byId[ids.beaChantal]).toBeUndefined(); // another BSO's campaign for the same agent
    expect(byId.chantalOwn).toBeUndefined(); // the agent's own campaign
    // the agent filter data: legacy campaign resolves to the same Chantal as the managed ones
    expect(byId.legacy.sellingAgent).toMatchObject({ uid: 'chantal', key: 'chantal', name: 'Chantal Seller' });
    expect(byId.legacy.access).toBe('owner');
    expect(byId[ids.petaChantal1]).toMatchObject({ access: 'bso', sellingAgent: { uid: 'chantal', key: 'chantal' }, managedByUid: 'peta', status: 'hidden' });
    const agentsInFilter = [...new Set(r.body.campaigns.map((c) => c.sellingAgent.key))].sort();
    expect(agentsInFilter).toEqual(['brad', 'cara', 'chantal']);
    expect(r.body.campaigns.filter((c) => c.sellingAgent.key === 'chantal')).toHaveLength(3);
    expect(JSON.stringify(r.body)).not.toMatch(/offer|opinion|buyerEmail|buyerPhone/i);
  });
  it("Bea only sees her own; non-BSOs (agents, former team admins, the office admin) are refused", async () => {
    const ids = await portfolio();
    expect((await call(bsoCampaignsRoute, 'bea')).body.campaigns.map((c) => c.id)).toEqual([ids.beaChantal]);
    for (const uid of ['chantal', 'ann', 'tom', 'hannah', 'otherbso']) {
      const r = await call(bsoCampaignsRoute, uid);
      if (uid === 'otherbso') { expect(r.status).toBe(200); expect(r.body.campaigns).toEqual([]); } else expect(r.status).toBe(403);
    }
  });
  it('a campaign whose selling agent has left the office drops out of the BSO list (live)', async () => {
    const ids = await portfolio();
    store.set('users/brad', { ...store.get('users/brad'), officeId: 'off2' });
    expect((await call(bsoCampaignsRoute, 'peta')).body.campaigns.map((c) => c.id)).not.toContain(ids.petaBrad);
    expect(await resolveCampaignRole(db, { actorUid: 'peta', property: prop(ids.petaBrad) })).toBeNull();
  });
});

describe('access restrictions are enforced on the server', () => {
  it('per-campaign roles: manager, owner, office admin; nothing from creating other campaigns or from teams', async () => {
    const ids = await portfolio();
    const role = (uid, id) => resolveCampaignRole(db, { actorUid: uid, property: prop(id) });
    expect(await role('peta', ids.petaChantal1)).toBe('bso');
    expect(await role('peta', ids.beaChantal)).toBeNull(); // same agent, different BSO
    expect(await role('peta', 'chantalOwn')).toBeNull();
    expect(await role('chantal', ids.petaChantal1)).toBe('owner');
    expect(await role('hannah', ids.beaChantal)).toBe('officeAdmin');
    for (const uid of ['ann', 'tom', 'brad', 'bill', 'cara', 'otherbso', 'otheradmin']) expect(await role(uid, ids.petaChantal1)).toBeNull();
  });
  it('every management route honours the same rule (404 for campaigns outside the BSO\'s portfolio)', async () => {
    const ids = await portfolio();
    const p = (id) => ({ params: { id } });
    expect((await call(roleRoute, 'peta', p(ids.petaChantal1))).body).toMatchObject({ role: 'bso' });
    expect((await call(manageRoute, 'peta', { method: 'PATCH', body: { action: 'show' }, ...p(ids.petaChantal1) })).status).toBe(200);
    expect(prop(ids.petaChantal1).visibility).toBe(true);
    expect((await call(resendRoute, 'peta', { method: 'POST', ...p(ids.petaChantal1) })).body).toMatchObject({ sent: true });
    expect(sendCampaignLinkOnce).toHaveBeenLastCalledWith(expect.objectContaining({ recipientUid: 'chantal', seq: 2 }));
    for (const [route, method, body] of [[roleRoute, 'GET'], [manageRoute, 'PATCH', { action: 'show' }], [resendRoute, 'POST'],
      [detailsRoute, 'PUT', { property: input({ title: 'x' }) }], [mediaRoute, 'POST', { urls: ['https://premarketvideos.b-cdn.net/z.jpg'] }],
      [managerRoute, 'POST', { managerUid: 'peta' }]]) {
      expect((await call(route, 'peta', { method, body, ...p(ids.beaChantal) })).status).toBe(404);
      expect((await call(route, 'ann', { method, body, ...p(ids.petaChantal1) })).status).toBe(404);
    }
    expect(prop(ids.beaChantal)).toMatchObject({ visibility: false, managedByUid: 'bea' });
  });
  it('removing the BSO role ends access immediately and flags the campaigns for reassignment', async () => {
    const ids = await portfolio();
    const r = await call(bsoRevokeRoute, 'hannah', { method: 'DELETE', params: { officeId: 'off1', uid: 'peta' } });
    expect(r.body.campaignsNeedingManager).toBe(4);
    expect((await call(manageRoute, 'peta', { method: 'PATCH', body: { action: 'show' }, params: { id: ids.petaChantal1 } })).status).toBe(404);
    expect((await call(bsoCampaignsRoute, 'peta')).status).toBe(403);
    const office = (await call(officeCampaignsRoute, 'hannah', { params: { officeId: 'off1' } })).body;
    expect(office.campaigns.filter((c) => c.needsManager).map((c) => c.id).sort()).toEqual([ids.petaChantal1, ids.petaChantal2, ids.petaBrad, ids.petaCara].sort());
    expect(prop(ids.petaChantal1).managedByUid).toBe('peta'); // history kept, never changed automatically
  });
});

/* ───────────── 4. office admin oversight and reassignment ───────────── */
describe('Office Admin oversight', () => {
  it('sees every campaign with its selling agent, manager and creator, plus who can manage campaigns', async () => {
    const ids = await portfolio();
    const r = await call(officeCampaignsRoute, 'hannah', { params: { officeId: 'off1' } });
    const byId = Object.fromEntries(r.body.campaigns.map((c) => [c.id, c]));
    expect(Object.keys(byId)).toHaveLength(7);
    expect(byId[ids.beaChantal]).toMatchObject({ sellingAgent: { uid: 'chantal' }, managedByUid: 'bea', managedByName: 'Bea Bso', createdByName: 'Bea Bso', needsManager: false });
    expect(byId.legacy).toMatchObject({ ownerUid: 'peta', sellingAgent: { uid: 'chantal' }, managedByUid: 'peta' });
    expect(byId.chantalOwn).toMatchObject({ managedByUid: null, sellingAgent: { uid: 'chantal' } });
    expect(r.body.managers).toEqual([
      { uid: 'bea', name: 'Bea Bso', role: 'bso' }, { uid: 'hannah', name: 'Hannah Admin', role: 'officeAdmin' }, { uid: 'peta', name: 'Peta Bso', role: 'bso' },
    ]);
  });
  it('reassigning management moves access from Peta to Bea; the selling agent, creator and billing never change', async () => {
    const ids = await portfolio();
    const before = { ...prop(ids.petaChantal1) };
    const r = await call(managerRoute, 'hannah', { method: 'POST', body: { managerUid: 'bea' }, params: { id: ids.petaChantal1 } });
    expect(r.body).toMatchObject({ changed: true, managedByUid: 'bea' });
    expect(prop(ids.petaChantal1)).toEqual({ ...before, managedByUid: 'bea' });
    expect(await resolveCampaignRole(db, { actorUid: 'bea', property: prop(ids.petaChantal1) })).toBe('bso');
    expect(await resolveCampaignRole(db, { actorUid: 'peta', property: prop(ids.petaChantal1) })).toBeNull();
    expect((await call(bsoCampaignsRoute, 'peta')).body.campaigns.map((c) => c.id)).not.toContain(ids.petaChantal1);
    expect(audits().at(-1)).toMatchObject({ action: 'campaign.reassignManager', fromUid: 'peta', toUid: 'bea', actorUid: 'hannah' });
    expect(recordPropertyCharge).toHaveBeenCalledTimes(5); // creation only
    // Hannah can take it herself; nobody can hand it to a non-BSO; BSOs cannot reassign
    expect((await call(managerRoute, 'hannah', { method: 'POST', body: { managerUid: 'hannah' }, params: { id: ids.petaChantal1 } })).status).toBe(200);
    for (const to of ['ann', 'chantal', 'otherbso']) expect((await call(managerRoute, 'hannah', { method: 'POST', body: { managerUid: to }, params: { id: ids.petaChantal1 } })).status).toBe(400);
    expect((await call(managerRoute, 'bea', { method: 'POST', body: { managerUid: 'bea' }, params: { id: ids.beaChantal } })).status).toBe(403);
  });
});

/* ───────────── 5. reports and buyer data ───────────── */
describe('reports: the managing BSO gets the office-admin level for their campaigns only', () => {
  beforeEach(async () => {
    store.set('offers/o1', { propertyId: 'P', serious: true, type: 'opinion', userId: 'buyer1', buyerName: 'Fake Buyer', buyerEmail: 'b@buyer.test', offerAmount: 900000 });
    store.set('users/buyer1', { firstName: 'Fake', lastName: 'Buyer', email: 'b@buyer.test', phone: '0400', isBuyer: true });
  });
  const withOffer = (id) => { store.set('offers/o1', { ...store.get('offers/o1'), propertyId: id }); };
  it('manager: full read-only report and buyer details; another BSO: nothing', async () => {
    const ids = await portfolio(); withOffer(ids.petaChantal1);
    expect(await getPropertyReportAccess(db, { uid: 'peta', property: prop(ids.petaChantal1) })).toBe('manager');
    const report = await getPropertyReportData(db, { uid: 'peta', propertyId: ids.petaChantal1 });
    expect(report).toMatchObject({ status: 200, access: 'manager', readOnly: true });
    expect(report.offers).toHaveLength(1);
    expect((await getBuyerProfilesForProperty(db, { uid: 'peta', propertyId: ids.petaChantal1 })).status).toBe(200);
    expect(await getPropertyReportAccess(db, { uid: 'bea', property: prop(ids.petaChantal1) })).toBeNull();
    expect((await getPropertyReportData(db, { uid: 'bea', propertyId: ids.petaChantal1 })).status).toBe(403);
    expect((await getBuyerProfilesForProperty(db, { uid: 'bea', propertyId: ids.petaChantal1 })).status).toBe(403);
    expect(await getPropertyReportAccess(db, { uid: 'peta', property: prop('chantalOwn') })).toBeNull();
  });
  it('the existing teammate view stays redacted, follows formal teams only, and never reaches across a shared BSO', async () => {
    const ids = await portfolio();
    // Team A (Chantal's team) sees Chantal's campaigns read-only/redacted; not Brad's or Cara's, though Peta manages all three
    expect(await getPropertyReportAccess(db, { uid: 'tom', property: prop(ids.petaChantal1) })).toBe('teamMember');
    expect(await getPropertyReportAccess(db, { uid: 'tom', property: prop(ids.petaBrad) })).toBeNull();
    expect(await getPropertyReportAccess(db, { uid: 'tom', property: prop(ids.petaCara) })).toBeNull();
    expect(await getPropertyReportAccess(db, { uid: 'bill', property: prop(ids.petaBrad) })).toBe('teamMember');
    expect(await getPropertyReportAccess(db, { uid: 'bill', property: prop(ids.petaChantal1) })).toBeNull();
    withOffer(ids.petaChantal1);
    const redacted = await getPropertyReportData(db, { uid: 'tom', propertyId: ids.petaChantal1 });
    expect(redacted).toMatchObject({ redacted: true, readOnly: true, buyers: {} });
    expect(JSON.stringify(redacted)).not.toMatch(/b@buyer\.test|Fake Buyer/);
    // the former Team Admin has no more than any teammate
    expect(await getPropertyReportAccess(db, { uid: 'ann', property: prop(ids.petaChantal1) })).toBe('teamMember');
  });
  it('no BSO or team registrations list exists (office admin only, and only when that overview is switched on)', async () => {
    process.env.OFFICE_REGISTRATIONS_ENABLED = '1';
    process.env.TEAM_REGISTRATIONS_ENABLED = '1';
    try {
      for (const uid of ['peta', 'bea', 'ann', 'brad']) expect((await call(registrationsRoute, uid)).status).toBe(403);
      expect((await call(registrationsRoute, 'hannah')).status).toBe(200);
    } finally { delete process.env.TEAM_REGISTRATIONS_ENABLED; }
  });
});

/* ───────────── 6. editing and media ───────────── */
describe('editing and photos through the server', () => {
  it('the managing BSO edits details; ownership, management, billing, terms and visibility cannot be changed', async () => {
    const ids = await portfolio();
    const before = { ...prop(ids.petaChantal1) };
    const evil = input({ title: 'New title', description: 'Updated', userId: 'peta', managedByUid: 'bea', createdByUid: 'x', visibility: true, termsAcceptedBy: 'x', agentId: 'r', stats: { views: 1 }, isEager: 1 });
    const r = await call(detailsRoute, 'peta', { method: 'PUT', body: { property: evil }, params: { id: ids.petaChantal1 } });
    expect(r.status).toBe(200);
    expect(prop(ids.petaChantal1)).toMatchObject({ title: 'New title', description: 'Updated', isEager: 1, userId: 'chantal', managedByUid: 'peta', createdByUid: 'peta', visibility: false, termsAcceptedBy: 'peta', agentId: null, stats: before.stats });
    expect(store.get(`draftProperties/${ids.petaChantal1}`)).toMatchObject({ title: 'New title' });
    expect(audits().at(-1)).toMatchObject({ action: 'campaign.edit', actorUid: 'peta', actorRole: 'bso' });
    // a status the form cannot choose (sold) is kept when sent back unchanged
    store.set(`properties/${ids.petaChantal1}`, { ...prop(ids.petaChantal1), listingStatus: 'sold' });
    await call(detailsRoute, 'peta', { method: 'PUT', body: { property: input({ listingStatus: 'sold' }) }, params: { id: ids.petaChantal1 } });
    expect(prop(ids.petaChantal1).listingStatus).toBe('sold');
    expect(recordPropertyCharge).toHaveBeenCalledTimes(5);
  });
  it("the office admin edits office-managed campaigns, but an agent's own campaign stays read-only to the office", async () => {
    const ids = await portfolio();
    expect((await call(detailsRoute, 'hannah', { method: 'PUT', body: { property: input({ title: 'By Hannah' }) }, params: { id: ids.petaChantal1 } })).status).toBe(200);
    expect(prop(ids.petaChantal1).title).toBe('By Hannah');
    for (const id of ['chantalOwn', 'legacy']) {
      expect((await call(detailsRoute, 'hannah', { method: 'PUT', body: { property: input({ title: 'Nope' }) }, params: { id } })).status).toBe(403);
      expect((await call(mediaRoute, 'hannah', { method: 'POST', body: { urls: ['https://premarketvideos.b-cdn.net/z.jpg'] }, params: { id } })).status).toBe(403);
      expect((await call(roleRoute, 'hannah', { params: { id } })).body).toMatchObject({ role: 'officeAdmin', canEdit: false });
    }
    expect(prop('chantalOwn').title).toBeUndefined();
    // once Hannah deliberately assigns a manager, the office runs it
    await call(managerRoute, 'hannah', { method: 'POST', body: { managerUid: 'peta' }, params: { id: 'chantalOwn' } });
    expect((await call(roleRoute, 'peta', { params: { id: 'chantalOwn' } })).body).toMatchObject({ role: 'bso', canEdit: true });
    expect((await call(detailsRoute, 'hannah', { method: 'PUT', body: { property: input({ title: 'Now managed' }) }, params: { id: 'chantalOwn' } })).status).toBe(200);
    expect(readFileSync('src/app/dashboard/edit/[id]/page.js', 'utf8')).toContain('r.canEdit ? r.role || null : null');
  });
  it('photos attach idempotently (a resumed upload never duplicates) and only https images are accepted', async () => {
    const ids = await portfolio();
    const url = 'https://premarketvideos.b-cdn.net/new.jpg';
    const add = (urls) => call(mediaRoute, 'peta', { method: 'POST', body: { urls }, params: { id: ids.petaChantal1 } });
    expect((await add([url])).body).toMatchObject({ added: 1 });
    expect((await add([url])).body).toMatchObject({ added: 0 });
    expect(prop(ids.petaChantal1).imageUrls).toEqual(['https://premarketvideos.b-cdn.net/a.jpg', url]);
    expect(prop(ids.petaChantal1).imageUploadProgress).toMatchObject({ uploaded: 2, total: 2, inProgress: false });
    expect((await add(['http://insecure/x.jpg'])).status).toBe(400);
    expect((await add(Array.from({ length: 60 }, (_, i) => `https://premarketvideos.b-cdn.net/${i}.jpg`))).status).toBe(400);
  });
});

/* ───────────── 7. public identity ───────────── */
describe('buyer-facing identity is the selling agent, never the BSO', () => {
  it('a BSO-created campaign carries no listing-agent override, so the public resolver presents the owner (selling agent)', async () => {
    const ids = await portfolio();
    const p = prop(ids.petaChantal1);
    expect(p.agentId).toBeNull();
    const shown = resolveListingAgent({ property: p, ownerProfile: { firstName: 'Chantal', lastName: 'Seller', avatar: 'https://x/chantal.jpg', phone: '0411' } });
    expect(shown).toMatchObject({ assigned: false, firstName: 'Chantal', lastName: 'Seller', phone: '0411' });
  });
  it('the public resolver and public profile service never read the manager or creator fields', () => {
    for (const f of ['src/app/utils/listingAgent.js', 'src/app/api/services/publicProfileService.js', 'src/app/components/PropertyPageClient.js']) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comments may describe the fields
      expect(code).not.toMatch(/managedByUid|createdByUid/);
    }
  });
});

/* ───────────── 8. switched off by default ───────────── */
describe('everything BSO stays off until MANAGED_CAMPAIGNS_ENABLED=1', () => {
  beforeEach(() => { delete process.env.MANAGED_CAMPAIGNS_ENABLED; });
  it('no navigation, no workspace, no role changes and no management writes', async () => {
    store.set('properties/p1', { userId: 'chantal', managedByUid: 'peta', address: 'x', visibility: false });
    expect((await call(bsoAccessRoute, 'peta')).body).toEqual({ bso: false });
    expect((await call(bsoCampaignsRoute, 'peta')).status).toBe(403);
    expect((await call(bsoGrantRoute, 'hannah', { method: 'POST', body: { uid: 'cara' }, params: { officeId: 'off1' } })).status).toBe(403);
    expect((await call(bsoRevokeRoute, 'hannah', { method: 'DELETE', params: { officeId: 'off1', uid: 'peta' } })).status).toBe(403);
    for (const [route, method, body] of [[managerRoute, 'POST', { managerUid: 'bea' }], [detailsRoute, 'PUT', { property: input() }], [mediaRoute, 'POST', { urls: ['https://a/b.jpg'] }], [roleRoute, 'GET']]) {
      expect((await call(route, 'hannah', { method, body, params: { id: 'p1' } })).status).toBe(403);
    }
    expect(store.get('properties/p1')).toEqual({ userId: 'chantal', managedByUid: 'peta', address: 'x', visibility: false });
    expect(store.get('officeAdminInfo/off1').bsoUids).toEqual(['peta', 'bea']);
  });
});
