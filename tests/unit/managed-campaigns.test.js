import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const store = new Map();
let autoId = 0;
function docRef(path) {
  const id = path.split('/').pop();
  return {
    id, path,
    get: async () => (store.has(path) ? { exists: true, id, ref: docRef(path), data: () => store.get(path) } : { exists: false, id }),
    set: async (d) => { store.set(path, { ...d }); },
    create: async (d) => { if (store.has(path)) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; } store.set(path, { ...d }); },
    update: async (p) => { store.set(path, { ...store.get(path), ...p }); },
  };
}
function colRef(name, filters = []) {
  return {
    doc: (id) => docRef(`${name}/${id || `auto${++autoId}`}`),
    add: async (d) => { const id = `auto${++autoId}`; store.set(`${name}/${id}`, { ...d }); return { id }; },
    where: (f, op, v) => colRef(name, [...filters, [f, op, v]]),
    get: async () => ({
      docs: [...store.entries()].filter(([p]) => p.startsWith(`${name}/`) && p.split('/').length === 2)
        .filter(([, d]) => filters.every(([f, op, v]) => (op === 'in' ? v.includes(d[f]) : d[f] === v)))
        .map(([p, d]) => ({ id: p.split('/')[1], ref: docRef(p), data: () => d })),
    }),
  };
}
const db = { collection: (n) => colRef(n) };
const authSpies = { verifyIdToken: vi.fn(), createUser: vi.fn(), updateUser: vi.fn() };
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: { collection: (n) => colRef(n) } }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => authSpies }));
const sendCampaignLinkOnce = vi.fn(async () => ({ sent: true }));
vi.mock('../../src/app/api/services/agentNotificationService', () => ({ sendCampaignLinkOnce: (...a) => sendCampaignLinkOnce(...a) }));
const recordPropertyCharge = vi.fn(async () => ({ created: true }));
vi.mock('../../src/app/api/services/billingService', () => ({ recordPropertyCharge: (...a) => recordPropertyCharge(...a), settleChargesForAgent: vi.fn(), recordOfficeDeparture: vi.fn() }));

import { POST as createRoute } from '../../src/app/api/properties/managed/route';
import { GET as agentsRoute } from '../../src/app/api/properties/managed/agents/route';
import { PATCH as manageRoute } from '../../src/app/api/properties/[id]/managed/route';
import { GET as officeCampaigns } from '../../src/app/api/offices/[officeId]/campaigns/route';
import { sanitizePropertyInput, resolveManagementRole } from '../../src/app/api/services/managedCampaignService';

const agent = (n, extra = {}) => ({ firstName: n, lastName: 'X', email: `${n.toLowerCase()}@hph.com`, agent: true, officeId: 'hph', accountStatus: 'active', ...extra });
function seed() {
  store.clear(); recordPropertyCharge.mockClear(); sendCampaignLinkOnce.mockClear();
  store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah'], status: 'active' });
  store.set('officeAdminInfo/other', { name: 'Other', officeAdminUids: ['otheradmin'], status: 'active' });
  store.set('users/hannah', agent('Hannah', { isOfficeAdmin: true }));
  store.set('users/ann', agent('Ann', { teamId: 't1' }));            // team creator t1
  store.set('users/bob', agent('Bob', { teamId: 't1' }));            // member of t1
  store.set('users/cat', agent('Cat', { teamId: 't2' }));            // member of t2 (creator dan)
  store.set('users/dan', agent('Dan', { teamId: 't2' }));
  store.set('users/ivy', agent('Ivy', { accountStatus: 'invited', teamId: 't1' })); // never activated
  store.set('users/solo', agent('Solo'));                            // no team
  store.set('users/olly', agent('Olly', { officeId: 'other' }));
  store.set('users/otheradmin', agent('OtherAdmin', { officeId: 'other', isOfficeAdmin: true }));
  store.set('teams/t1', { officeId: 'hph', createdBy: 'ann' });
  store.set('teams/t2', { officeId: 'hph', createdBy: 'dan' });
}
const input = (extra = {}) => ({ address: '1 Test St, Tweed Heads NSW', price: '$1,250,000', bedrooms: 3, bathrooms: 2, carSpaces: 1, propertyType: 2, imageUrls: ['https://premarketvideos.b-cdn.net/a.jpg'], ...extra });
let n = 0;
const rid = () => `req-${String(++n).padStart(20, '0')}`;
const post = (uid, body) => {
  authSpies.verifyIdToken.mockResolvedValue({ uid });
  return createRoute(new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
};
const create = (uid, ownerUid, extra = {}) => post(uid, { ownerUid, requestId: rid(), acceptTerms: true, property: input(), ...extra });
const props = () => [...store.entries()].filter(([k]) => k.startsWith('properties/'));
beforeEach(() => { seed(); process.env.MANAGED_CAMPAIGNS_ENABLED = '1'; });
afterEach(() => { delete process.env.MANAGED_CAMPAIGNS_ENABLED; });

describe('who may create for whom (server-side)', () => {
  it('Office Admin creates for any agent in the office — active, invited (never activated), team or no team', async () => {
    for (const owner of ['ann', 'bob', 'cat', 'ivy', 'solo']) {
      const r = await create('hannah', owner);
      expect(r.status).toBe(201);
    }
    expect(props()).toHaveLength(5);
  });
  it('Team Admin is retired: a team creator cannot create campaigns for anyone, not even their own teammates', async () => {
    for (const owner of ['bob', 'ivy', 'cat', 'dan', 'solo', 'olly', 'hannah']) expect((await create('ann', owner)).status).toBe(404);
    expect((await create('dan', 'cat')).status).toBe(404);
    expect(props()).toHaveLength(0);
  });
  it('ordinary team members and agents have no management authority', async () => {
    for (const actor of ['bob', 'solo', 'cat']) for (const owner of ['ann', 'bob', 'ivy']) {
      expect((await create(actor, owner)).status).toBe(404);
    }
    expect(props()).toHaveLength(0);
  });
  it('an admin of another office cannot create for this office, and this admin cannot create for another office', async () => {
    expect((await create('otheradmin', 'ann')).status).toBe(404);
    expect((await create('hannah', 'olly')).status).toBe(404);
    expect(props()).toHaveLength(0);
  });
  it('requires authentication, accepted terms, a request id and a chosen agent', async () => {
    expect((await createRoute(new Request('http://x', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await create('hannah', 'ann', { acceptTerms: false })).status).toBe(400);
    expect((await create('hannah', 'ann', { requestId: 'short' })).status).toBe(400);
    expect((await create('hannah', '')).status).toBe(400);
    expect((await create('hannah', 'hannah')).status).toBe(404); // self-creation uses the existing agent flow
  });
});

describe('attribution', () => {
  it('the campaign belongs to the SELECTED agent; the admin is recorded separately', async () => {
    const r = await (await create('hannah', 'ivy')).json();
    const p = store.get(`properties/${r.propertyId}`);
    expect(p).toMatchObject({ userId: 'ivy', managedCreation: true, createdByUid: 'hannah', createdByRole: 'officeAdmin', termsAcceptedBy: 'hannah', visibility: false, active: true, agentManaged: true });
    expect(p.userId).not.toBe('hannah');
    // An office admin who chooses no BSO manages the campaign themself.
    expect(p.managedByUid).toBe('hannah');
  });
  it('the existing agent dashboard query (userId == agent) finds it, and the office list shows owner and creator', async () => {
    const r = await (await create('hannah', 'ivy')).json();
    store.set(`properties/${r.propertyId}`, { ...store.get(`properties/${r.propertyId}`), formattedAddress: '1 Test St, Tweed Heads NSW 2485, Australia', address: 'Tweed Heads NSW Australia' });
    expect(props().filter(([, p]) => p.userId === 'ivy').map(([k]) => k)).toEqual([`properties/${r.propertyId}`]);
    authSpies.verifyIdToken.mockResolvedValue({ uid: 'hannah' });
    const res = await officeCampaigns(new Request('http://x', { headers: { authorization: 'Bearer t' } }), { params: Promise.resolve({ officeId: 'hph' }) });
    const { campaigns } = await res.json();
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].address).toBe('1 Test St, Tweed Heads NSW 2485, Australia'); // full street address, not the suburb-level field
    expect(campaigns[0]).toMatchObject({ id: r.propertyId, ownerUid: 'ivy', ownerName: 'Ivy X', ownerLoginStatus: 'invited', managed: true, createdByUid: 'hannah' });
    expect(JSON.stringify(campaigns)).not.toMatch(/offer|opinion|buyer/i);
  });
  it('client-supplied ownership, billing, stats and agent fields are ignored (allowlist)', async () => {
    const r = await (await create('hannah', 'bob', { property: input({ userId: 'hannah', stats: { views: 9999 }, agentId: 'x', createdByUid: 'evil', managedCreation: false, active: false, visibility: true, termsAcceptedBy: 'evil', wantsPremiumListing: true }) })).json();
    expect(store.get(`properties/${r.propertyId}`)).toMatchObject({ userId: 'bob', stats: { views: 0 }, agentId: null, createdByUid: 'hannah', managedCreation: true, active: true, visibility: false, termsAcceptedBy: 'hannah', wantsPremiumListing: false });
  });
  it('does not create or modify any Firebase Auth user and never marks an account active', async () => {
    await create('hannah', 'ivy');
    expect(authSpies.createUser).not.toHaveBeenCalled();
    expect(authSpies.updateUser).not.toHaveBeenCalled();
    expect(store.get('users/ivy').accountStatus).toBe('invited');
  });
});

describe('duplicates and billing', () => {
  it('a retry or double-submit with the same request id returns the SAME campaign: one record, one charge', async () => {
    const body = { ownerUid: 'bob', requestId: 'same-request-id-0001', acceptTerms: true, property: input() };
    const a = await (await post('hannah', body)).json();
    const bRes = await post('hannah', body);
    const b = await bRes.json();
    expect(b).toMatchObject({ propertyId: a.propertyId, duplicate: true });
    expect(bRes.status).toBe(200);
    expect(props()).toHaveLength(1);
    expect(recordPropertyCharge).toHaveBeenCalledTimes(1);
  });
  it('uses the existing billing rule unchanged: recordPropertyCharge for the OWNER, nothing else billing-related', async () => {
    await create('hannah', 'ivy');
    expect(recordPropertyCharge).toHaveBeenCalledTimes(1);
    expect(recordPropertyCharge.mock.calls[0][0]).toMatchObject({ userId: 'ivy' });
    expect([...store.keys()].some((k) => /invoice|xero|pricing/i.test(k))).toBe(false);
    const src = readFileSync('src/app/api/services/managedCampaignService.js', 'utf8');
    expect(src).not.toMatch(/xero|invoiceRun|invoicePreview|campaignPricing|taxType/i);
  });
  it('a billing failure never loses the campaign (the monthly run sweeps it, as for agent-created ones)', async () => {
    recordPropertyCharge.mockRejectedValueOnce(new Error('boom'));
    expect((await create('hannah', 'bob')).status).toBe(201);
    expect(props()).toHaveLength(1);
  });
  it('writes a server-side audit record', async () => {
    await create('hannah', 'bob');
    const audit = [...store.entries()].filter(([k]) => k.startsWith('officeCampaignAudit/')).map(([, v]) => v);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'campaign.create', ownerUid: 'bob', actorUid: 'hannah', actorRole: 'officeAdmin', officeId: 'hph' });
  });
});

describe('team changes never transfer ownership or access', () => {
  it('team creators never gain management through their team, before or after a move; ownership and history stay put', async () => {
    const r = await (await create('hannah', 'bob')).json();
    const id = r.propertyId;
    const manage = (uid, action) => { authSpies.verifyIdToken.mockResolvedValue({ uid }); return manageRoute(new Request('http://x', { method: 'PATCH', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ action }) }), { params: Promise.resolve({ id }) }); };
    expect((await manage('ann', 'show')).status).toBe(404); // Bob's team creator
    // Hannah moves Bob to team t2
    store.set('users/bob', { ...store.get('users/bob'), teamId: 't2' });
    expect((await manage('dan', 'show')).status).toBe(404); // the new team's creator
    expect(store.get(`properties/${id}`)).toMatchObject({ userId: 'bob', createdByUid: 'hannah', visibility: false });
    expect((await manage('hannah', 'archive')).status).toBe(200);
    expect(store.get(`properties/${id}`)).toMatchObject({ archived: true, userId: 'bob' });
  });
  it('manage actions are narrow and authorised: unknown actions and strangers are refused; ownership never changes', async () => {
    const id = (await (await create('hannah', 'bob')).json()).propertyId;
    const manage = (uid, action) => { authSpies.verifyIdToken.mockResolvedValue({ uid }); return manageRoute(new Request('http://x', { method: 'PATCH', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ action }) }), { params: Promise.resolve({ id }) }); };
    expect((await manage('hannah', 'delete')).status).toBe(400);
    expect((await manage('hannah', 'transfer')).status).toBe(400);
    for (const uid of ['ann', 'cat', 'solo', 'otheradmin']) expect((await manage(uid, 'show')).status).toBe(404);
    expect(store.get(`properties/${id}`)).toMatchObject({ userId: 'bob', visibility: false });
    // The selling agent (owner) can already do this on their own dashboard; the server action gives them nothing new.
    expect((await manage('bob', 'show')).status).toBe(200);
    expect(store.get(`properties/${id}`)).toMatchObject({ userId: 'bob', visibility: true });
  });
});

describe('assignable agent selector is scoped to permissions', () => {
  const list = async (uid) => { authSpies.verifyIdToken.mockResolvedValue({ uid }); return (await agentsRoute(new Request('http://x', { headers: { authorization: 'Bearer t' } }))).json(); };
  it('office admin: whole office (never other offices, never self)', async () => {
    const r = await list('hannah');
    expect(r.role).toBe('officeAdmin');
    expect(r.agents.map((a) => a.uid).sort()).toEqual(['ann', 'bob', 'cat', 'dan', 'ivy', 'solo']);
    expect(r.agents.find((a) => a.uid === 'ivy').loginStatus).toBe('invited');
  });
  it('team creators (Team Admin retired), ordinary members and agents get nothing', async () => {
    for (const uid of ['ann', 'dan', 'bob', 'solo', 'olly']) expect(await list(uid)).toEqual({ role: null, agents: [] });
  });
});

describe('agent selector uses the professional profile', () => {
  const list = async (uid) => { authSpies.verifyIdToken.mockResolvedValue({ uid }); return (await agentsRoute(new Request('http://x', { headers: { authorization: 'Bearer t' } }))).json(); };
  it('shows the office-managed name and photo where one is set, and the login name otherwise', async () => {
    store.set('officeAgents/p1', { officeId: 'hph', linkedUid: 'ivy', fullName: 'Ivy Rose Invited-Smith', photoUrl: 'https://premarketvideos.b-cdn.net/ivy.png' });
    const r = await list('hannah');
    expect(r.agents.find((a) => a.uid === 'ivy')).toMatchObject({ name: 'Ivy Rose Invited-Smith', photoUrl: 'https://premarketvideos.b-cdn.net/ivy.png' });
    expect(r.agents.find((a) => a.uid === 'bob').name).toBe('Bob X');
  });
  it('ignores ambiguous profiles (two for one agent) exactly as the directory does', async () => {
    store.set('officeAgents/p1', { officeId: 'hph', linkedUid: 'ivy', fullName: 'One' });
    store.set('officeAgents/p2', { officeId: 'hph', linkedUid: 'ivy', fullName: 'Two' });
    expect((await list('hannah')).agents.find((a) => a.uid === 'ivy').name).toBe('Ivy X');
  });
});

describe('hardening', () => {
  it('refuses to create for suspended, disabled or deactivated accounts', async () => {
    for (const [uid, patch] of [['bob', { accountStatus: 'suspended' }], ['cat', { disabled: true }], ['solo', { deactivated: true }]]) {
      store.set(`users/${uid}`, { ...store.get(`users/${uid}`), ...patch });
      expect((await create('hannah', uid)).status).toBe(404);
    }
    expect(props()).toHaveLength(0);
    expect(recordPropertyCharge).not.toHaveBeenCalled();
  });
  it('accepts the focal-point formats the wizard produces (decimals, exponents) and clamps to 0-100', () => {
    expect(sanitizePropertyInput(input({ heroFocalPoint: '50.5% 33.333333%' })).heroFocalPoint).toBe('50.5% 33.333333%');
    expect(sanitizePropertyInput(input({ heroFocalPoint: '1.2e-7% 99%' })).heroFocalPoint).toBe('1.2e-7% 99%');
    expect(sanitizePropertyInput(input({ heroFocalPoint: '150% -5%' })).heroFocalPoint).toBe('100% 0%');
    expect(sanitizePropertyInput(input({ heroFocalPoint: 'javascript:1' })).heroFocalPoint).toBeUndefined();
  });
});

describe('input validation', () => {
  it('requires an address and price, https photos and sane sizes', () => {
    expect(() => sanitizePropertyInput({ price: '1' })).toThrow();
    expect(() => sanitizePropertyInput({ address: 'a' })).toThrow();
    expect(() => sanitizePropertyInput(input({ imageUrls: ['http://x/y.jpg'] }))).toThrow();
    expect(() => sanitizePropertyInput(input({ imageUrls: ['javascript:alert(1)'] }))).toThrow();
    expect(() => sanitizePropertyInput(input({ imageUrls: Array(61).fill('https://a/b.jpg') }))).toThrow();
    expect(sanitizePropertyInput(input({ price: '$1,250,000' })).price).toBe('1250000');
  });
  it('agents outside an active office are unmanageable', async () => {
    store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah'], status: 'suspended' });
    expect((await create('hannah', 'bob')).status).toBe(404);
    expect(await resolveManagementRole(db, { actorUid: 'hannah', owner: { uid: 'bob', officeId: 'hph' } })).toBeNull();
  });
});

describe('launch default: managed campaigns are OFF (directory, photos and teams only)', () => {
  const call = (route, uid, method = 'GET', body, params) => {
    authSpies.verifyIdToken.mockResolvedValue({ uid });
    return route(new Request('http://x', { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve(params || { id: 'p1', officeId: 'hph' }) });
  };
  beforeEach(() => { delete process.env.MANAGED_CAMPAIGNS_ENABLED; });
  it('creation is refused for everyone, including the office admin, and nothing is written or charged', async () => {
    for (const uid of ['hannah', 'ann']) {
      const r = await call(createRoute, uid, 'POST', { ownerUid: 'bob', requestId: 'launch-default-0000001', acceptTerms: true, property: input() });
      expect(r.status).toBe(403);
    }
    expect(props()).toHaveLength(0);
    expect(recordPropertyCharge).not.toHaveBeenCalled();
    expect(sendCampaignLinkOnce).not.toHaveBeenCalled();
  });
  it('show/hide/archive, link resend and the office campaigns list are all refused', async () => {
    store.set('properties/p1', { userId: 'bob', address: 'x', visibility: false });
    expect((await call(manageRoute, 'hannah', 'PATCH', { action: 'show' })).status).toBe(403);
    expect(store.get('properties/p1').visibility).toBe(false);
    const { POST: resendRoute } = await import('../../src/app/api/properties/[id]/campaign-link/resend/route');
    expect((await call(resendRoute, 'hannah', 'POST')).status).toBe(403);
    expect((await call(officeCampaigns, 'hannah')).status).toBe(403);
    expect(sendCampaignLinkOnce).not.toHaveBeenCalled();
  });
  it('nobody is offered an agent selector', async () => {
    for (const uid of ['hannah', 'ann', 'bob']) expect(await (await call(agentsRoute, uid)).json()).toEqual({ role: null, agents: [] });
  });
  it('the sidebar Campaigns link depends on the server flag, and only the exact value "1" enables it', async () => {
    const { managedCampaignsEnabled } = await import('../../src/app/api/services/environmentGuard');
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) expect(managedCampaignsEnabled({ MANAGED_CAMPAIGNS_ENABLED: v })).toBe(false);
    expect(managedCampaignsEnabled({ MANAGED_CAMPAIGNS_ENABLED: '1' })).toBe(true);
    expect(readFileSync('src/app/dashboard/page.js', 'utf8')).toMatch(/isOfficeAdmin === true && campaignsOn/);
  });
  it('agent-led campaign creation is not affected by the switch', () => {
    const add = readFileSync('src/app/dashboard/add/page.js', 'utf8');
    expect(add).toContain("addDoc(collection(db, 'properties'), propertyData)");
    expect(readFileSync('src/app/api/properties/[id]/record-charge/route.js', 'utf8')).not.toMatch(/managedCampaignsEnabled/);
  });
});
