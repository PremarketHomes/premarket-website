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
    update: async (p) => { const cur = { ...store.get(path) }; for (const [k, v] of Object.entries(p)) { if (v === 'DEL') delete cur[k]; else cur[k] = v; } store.set(path, cur); },
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
let txChain = Promise.resolve();
const authUsers = new Map();
const authSpies = { verifyIdToken: vi.fn(), getUser: vi.fn(async (uid) => { if (!authUsers.has(uid)) { const e = new Error('nf'); e.code = 'auth/user-not-found'; throw e; } return authUsers.get(uid); }), createUser: vi.fn(), updateUser: vi.fn() };
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (n) => colRef(n),
    // Firestore serialises contended transactions (retrying the loser); model that with a mutex.
    runTransaction: (fn) => {
      const run = txChain.then(async () => {
        const writes = [];
        const tx = { get: (r) => r.get(), set: (r, d) => writes.push(() => r.set(d)), update: (r, p) => writes.push(() => r.update(p)) };
        const out = await fn(tx);
        for (const w of writes) await w();
        return out;
      });
      txChain = run.catch(() => {});
      return run;
    },
  },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => ({ toMillis: () => Date.now() }), delete: () => 'DEL' } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => authSpies }));
const sendEmail = vi.fn(async () => ({ data: { id: 'e1' } }));
const sendNewBuyerInterestEmail = vi.fn(async () => ({}));
vi.mock('../../src/app/api/services/resendService', () => ({
  sendEmail: (...a) => sendEmail(...a), sendPropertyReadyEmail: vi.fn(), sendNewBuyerInterestEmail: (...a) => sendNewBuyerInterestEmail(...a),
}));
vi.mock('../../src/app/api/services/billingService', () => ({ recordPropertyCharge: vi.fn(async () => ({ created: true })) }));

import { sendCampaignLinkOnce, campaignLinkKey } from '../../src/app/api/services/agentNotificationService';
import { resendCampaignLink } from '../../src/app/api/services/managedCampaignService';
import { GET as registrationsRoute } from '../../src/app/api/registrations/managed/route';
import { POST as notifyInterest } from '../../src/app/api/offers/notify-interest/route';

const adminDb = { collection: (n) => colRef(n) };
const agent = (n, extra = {}) => ({ firstName: n, lastName: 'X', email: `${n.toLowerCase()}@hph.com`, agent: true, officeId: 'hph', accountStatus: 'active', ...extra });
function seed() {
  store.clear(); authUsers.clear(); sendEmail.mockClear(); sendNewBuyerInterestEmail.mockClear();
  store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah'], status: 'active' });
  store.set('officeAdminInfo/other', { name: 'Other', officeAdminUids: ['otheradmin'], status: 'active' });
  for (const [u, d] of Object.entries({
    hannah: agent('Hannah', { isOfficeAdmin: true }), ann: agent('Ann', { teamId: 't1' }), bob: agent('Bob', { teamId: 't1' }),
    cat: agent('Cat', { teamId: 't2' }), dan: agent('Dan', { teamId: 't2' }), ivy: agent('Ivy', { accountStatus: 'invited', teamId: 't1' }),
    olly: agent('Olly', { officeId: 'other' }), otheradmin: agent('OtherAdmin', { officeId: 'other' }), lead: agent('Lead'),
  })) { store.set(`users/${u}`, d); authUsers.set(u, { disabled: false }); }
  store.set('teams/t1', { officeId: 'hph', createdBy: 'ann' }); store.set('teams/t2', { officeId: 'hph', createdBy: 'dan' });
  store.set('officeAgents/prof1', { officeId: 'hph', linkedUid: 'ivy', contactEmail: 'ivy.pro@elsewhere.com' });
  store.set('properties/p_ivy', { userId: 'ivy', address: '1 Ivy St, Tweed Heads NSW', managedCreation: true, createdByUid: 'hannah', createdByRole: 'officeAdmin', visibility: false });
  store.set('properties/p_bob', { userId: 'bob', address: '2 Bob Rd, Kingscliff NSW' });
  store.set('properties/p_cat', { userId: 'cat', address: '3 Cat Ave, Casuarina NSW' });
  store.set('properties/p_olly', { userId: 'olly', address: '9 Other St' });
  const reg = (id, propertyId, extra = {}) => store.set(`offers/${id}`, {
    propertyId, serious: true, buyerName: 'Buyer ' + id, buyerEmail: `${id}@buyer.com`, buyerPhone: '0400 111 222', nextAction: 'contact', timeframe: '3-months', buyerType: 'cash', isFirstHomeBuyer: true, isInvestor: false,
    // same stored document also carries the anonymous opinion and linkage — these must never leave:
    offerAmount: 987654, seriousnessLevel: 'high', userId: 'buyeracct', sessionId: 'sess-secret', createdAt: new Date('2026-11-01'), ...extra,
  });
  reg('r1', 'p_ivy'); reg('r2', 'p_bob'); reg('r3', 'p_cat'); reg('r4', 'p_olly');
  store.set('offers/opinion1', { propertyId: 'p_bob', serious: false, offerAmount: 111111, sessionId: 's' }); // anonymous opinion, not a registration
}
beforeEach(seed);
const emails = () => sendEmail.mock.calls.map((c) => c[0]);

describe('campaign link email to the assigned agent', () => {
  it('goes to an invited agent who has never logged in, at their account email — not the editable professional email', async () => {
    expect(await sendCampaignLinkOnce({ propertyId: 'p_ivy', recipientUid: 'ivy' })).toEqual({ sent: true });
    expect(emails()).toHaveLength(1);
    const e = emails()[0];
    expect(e.to).toBe('ivy@hph.com');
    expect(e.to).not.toMatch(/elsewhere/);
    expect(e.html).toContain('1 Ivy St, Tweed Heads NSW');
    expect(e.html).toContain('https://premarket.homes/find-property?propertyId=p_ivy');
    expect(e.html).toMatch(/buyers in your database/i);
    expect(e.html).toContain('Hannah X at your office');
    expect(e.idempotencyKey).toBe(campaignLinkKey({ propertyId: 'p_ivy', recipientUid: 'ivy', seq: 1 }));
    expect(store.get(`emailLog/${e.idempotencyKey}`).status).toBe('sent');
    expect(authSpies.createUser).not.toHaveBeenCalled();
    expect(store.get('users/ivy').accountStatus).toBe('invited');
  });
  it('contains no buyer data and no price information', async () => {
    await sendCampaignLinkOnce({ propertyId: 'p_ivy', recipientUid: 'ivy' });
    expect(emails()[0].html + emails()[0].text).not.toMatch(/987654|opinion1|buyer\.com|0400 111/);
  });
  it('is once-only: repeats and concurrent triggers never send twice', async () => {
    await Promise.all([1, 2, 3].map(() => sendCampaignLinkOnce({ propertyId: 'p_ivy', recipientUid: 'ivy' })));
    await sendCampaignLinkOnce({ propertyId: 'p_ivy', recipientUid: 'ivy' });
    expect(emails()).toHaveLength(1);
  });
  it('a failed send is retryable and then sends exactly once', async () => {
    sendEmail.mockRejectedValueOnce(new Error('Resend rejected the email (x, HTTP 500): down'));
    expect(await sendCampaignLinkOnce({ propertyId: 'p_ivy', recipientUid: 'ivy' })).toEqual({ sent: false, reason: 'send-failed' });
    expect(await sendCampaignLinkOnce({ propertyId: 'p_ivy', recipientUid: 'ivy' })).toEqual({ sent: true });
    expect(await sendCampaignLinkOnce({ propertyId: 'p_ivy', recipientUid: 'ivy' })).toMatchObject({ sent: false, reason: 'sent' });
    expect(sendEmail).toHaveBeenCalledTimes(2); // one failed attempt + one success
  });
  it('skips ineligible or stale recipients and never emails the creator instead', async () => {
    store.set('users/bob', { ...store.get('users/bob'), unsubscribed: true });
    expect((await sendCampaignLinkOnce({ propertyId: 'p_bob', recipientUid: 'bob' })).reason).toBe('unsubscribed');
    expect((await sendCampaignLinkOnce({ propertyId: 'p_ivy', recipientUid: 'bob' })).reason).toBe('no-longer-owner');
    authUsers.set('cat', { disabled: true });
    expect((await sendCampaignLinkOnce({ propertyId: 'p_cat', recipientUid: 'cat' })).reason).toBe('auth-disabled');
    store.set('users/dan', { ...store.get('users/dan'), accountStatus: 'suspended' });
    store.set('properties/p_dan', { userId: 'dan', address: 'x' });
    expect((await sendCampaignLinkOnce({ propertyId: 'p_dan', recipientUid: 'dan' })).reason).toBe('account-suspended');
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('the development kill switch sends nothing and writes nothing', async () => {
    process.env.DISABLE_AGENT_CAMPAIGN_EMAILS = '1';
    try { expect((await sendCampaignLinkOnce({ propertyId: 'p_ivy', recipientUid: 'ivy' })).reason).toBe('disabled'); } finally { delete process.env.DISABLE_AGENT_CAMPAIGN_EMAILS; }
    expect(sendEmail).not.toHaveBeenCalled();
    expect([...store.keys()].some((k) => k.startsWith('emailLog/'))).toBe(false);
  });
  it('the notification code never reads the professional contact email', () => {
    expect(readFileSync('src/app/api/services/agentNotificationService.js', 'utf8')).not.toMatch(/contactEmail|officeAgents/);
    expect(readFileSync('src/app/api/services/agentCampaignEmail.js', 'utf8')).not.toMatch(/contactEmail|officeAgents/);
  });
});

describe('authorised resend of the campaign link', () => {
  it('office admin and the owner may resend; each resend is a new once-only event, rate limited', async () => {
    expect(await resendCampaignLink(adminDb, { actorUid: 'hannah', propertyId: 'p_ivy' })).toMatchObject({ sent: true });
    expect(emails()).toHaveLength(1);
    expect(emails()[0].html).toMatch(/again/);
    await expect(resendCampaignLink(adminDb, { actorUid: 'ivy', propertyId: 'p_ivy' })).rejects.toMatchObject({ status: 429 });
    expect(emails()).toHaveLength(1);
    store.set('properties/p_ivy', { ...store.get('properties/p_ivy'), campaignLinkResentAtMs: 0 });
    expect(await resendCampaignLink(adminDb, { actorUid: 'ivy', propertyId: 'p_ivy' })).toMatchObject({ sent: true });
    expect(emails()).toHaveLength(2);
    expect(new Set(emails().map((e) => e.idempotencyKey)).size).toBe(2);
    expect(emails().every((e) => e.to === 'ivy@hph.com')).toBe(true); // always the selling agent's account email
  });
  it('strangers, team creators (Team Admin retired) and other offices cannot resend (404, nothing sent)', async () => {
    for (const actor of ['ann', 'dan', 'cat', 'otheradmin', 'olly', 'lead']) {
      await expect(resendCampaignLink(adminDb, { actorUid: actor, propertyId: 'p_ivy' })).rejects.toMatchObject({ status: 404 });
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('buyer registration notification goes to the assigned agent', () => {
  const notify = (offerId, propertyId) => notifyInterest(new Request('http://x', { method: 'POST', body: JSON.stringify({ offerId, propertyId }) }));
  it('uses the campaign owner (the assigned agent), never the administrator who created it, and only once', async () => {
    store.set('offers/offer_ivy_0001', { ...store.get('offers/r1'), propertyId: 'prop_ivy_0001' }); // real Firestore ids are 20 characters
    store.set('properties/prop_ivy_0001', { ...store.get('properties/p_ivy') });
    expect((await (await notify('offer_ivy_0001', 'prop_ivy_0001')).json())).toEqual({ sent: true });
    expect(sendNewBuyerInterestEmail).toHaveBeenCalledTimes(1);
    const call = sendNewBuyerInterestEmail.mock.calls[0][0];
    expect(call).toMatchObject({ agentEmail: 'ivy@hph.com', propertyId: 'prop_ivy_0001', buyerEmail: 'r1@buyer.com' });
    expect(call.agentEmail).not.toBe('hannah@hph.com');
    expect(JSON.stringify(call)).not.toMatch(/987654|offerAmount|sess-secret/);
    await notify('offer_ivy_0001', 'prop_ivy_0001');
    expect(sendNewBuyerInterestEmail).toHaveBeenCalledTimes(1);
  });
});

describe('launch default: the office Registrations overview is OFF for everyone', () => {
  const get = async (uid) => { authSpies.verifyIdToken.mockResolvedValue({ uid }); const res = await registrationsRoute(new Request('http://x', { headers: { authorization: 'Bearer t' } })); return { status: res.status, ...(await res.json()) }; };
  beforeEach(() => { delete process.env.OFFICE_REGISTRATIONS_ENABLED; delete process.env.TEAM_REGISTRATIONS_ENABLED; });
  it('with no flag set, even the office admin gets no registrations list and no buyer data leaves the route', async () => {
    for (const uid of ['hannah', 'ann', 'dan', 'bob', 'lead']) {
      const r = await get(uid);
      expect(r.status).toBe(403);
      expect(JSON.stringify(r)).not.toMatch(/buyer\.com|0400 111|Buyer r|registrations"/);
    }
  });
  it('the team flag alone does not switch it on, and only the exact value "1" enables the office overview', async () => {
    process.env.TEAM_REGISTRATIONS_ENABLED = '1';
    expect((await get('hannah')).status).toBe(403);
    for (const v of ['true', 'yes', '', '0', 'TRUE', ' 1']) { process.env.OFFICE_REGISTRATIONS_ENABLED = v; expect((await get('hannah')).status).toBe(403); }
    process.env.OFFICE_REGISTRATIONS_ENABLED = '1';
    expect((await get('hannah')).status).toBe(200);
    delete process.env.OFFICE_REGISTRATIONS_ENABLED; delete process.env.TEAM_REGISTRATIONS_ENABLED;
  });
  it('the sidebar link is only shown when the server reports the overview is on', async () => {
    const dash = readFileSync('src/app/dashboard/page.js', 'utf8');
    expect(dash).toContain("fetch('/api/features')");
    expect(dash).toMatch(/isOfficeAdmin === true && registrationsOn/);
    const { GET: featuresRoute } = await import('../../src/app/api/features/route');
    expect(await (await featuresRoute()).json()).toEqual({ officeRegistrations: false, managedCampaigns: false });
    process.env.OFFICE_REGISTRATIONS_ENABLED = '1';
    try { expect(await (await featuresRoute()).json()).toEqual({ officeRegistrations: true, managedCampaigns: false }); } finally { delete process.env.OFFICE_REGISTRATIONS_ENABLED; }
  });
  it('existing access is not reduced: the agent still gets the registration email and reports are untouched by the flag', () => {
    const notify = readFileSync('src/app/api/offers/notify-interest/route.js', 'utf8');
    expect(notify).not.toMatch(/OFFICE_REGISTRATIONS_ENABLED|officeRegistrationsEnabled/);
    expect(readFileSync('src/app/api/services/propertyAccessService.js', 'utf8')).not.toMatch(/officeRegistrationsEnabled/);
  });
});

describe('team creators: identifiable buyer registrations are OFF by default', () => {
  const get = async (uid) => { authSpies.verifyIdToken.mockResolvedValue({ uid }); const res = await registrationsRoute(new Request('http://x', { headers: { authorization: 'Bearer t' } })); return { status: res.status, ...(await res.json()) }; };
  beforeEach(() => { delete process.env.TEAM_REGISTRATIONS_ENABLED; process.env.OFFICE_REGISTRATIONS_ENABLED = '1'; });
  afterEach(() => { delete process.env.OFFICE_REGISTRATIONS_ENABLED; });
  it('without TEAM_REGISTRATIONS_ENABLED=1, team creators are refused and see no buyer details at all', async () => {
    for (const uid of ['ann', 'dan']) {
      const r = await get(uid);
      expect(r.status).toBe(403);
      expect(JSON.stringify(r)).not.toMatch(/buyer\.com|0400 111|Buyer r/);
    }
  });
  it('the existing office-admin access is unchanged and unexpanded', async () => {
    const r = await get('hannah');
    expect(r.status).toBe(200);
    expect(r.scope).toBe('office');
    expect(r.registrations.map((x) => x.id).sort()).toEqual(['r1', 'r2', 'r3']);
  });
  it('only the exact value "1" enables it (not "true", "yes" or empty)', async () => {
    for (const v of ['true', 'yes', '', '0', 'TRUE', ' 1']) {
      process.env.TEAM_REGISTRATIONS_ENABLED = v;
      expect((await get('ann')).status).toBe(403);
    }
    delete process.env.TEAM_REGISTRATIONS_ENABLED;
  });
  it('a team creator who is ALSO an office admin keeps office-wide access (existing right), regardless of the flag', async () => {
    store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah', 'ann'], status: 'active' });
    const r = await get('ann');
    expect(r.status).toBe(200);
    expect(r.scope).toBe('office');
  });
  it('Team Admin retired: even with TEAM_REGISTRATIONS_ENABLED=1 a team creator gets no scope, no list and no buyer details', async () => {
    process.env.TEAM_REGISTRATIONS_ENABLED = '1';
    try {
      for (const uid of ['ann', 'dan']) {
        const r = await get(uid);
        expect(r.status).toBe(403);
        expect(JSON.stringify(r)).not.toMatch(/buyer\.com|0400 111|Buyer r/);
      }
    } finally { delete process.env.TEAM_REGISTRATIONS_ENABLED; }
    const { GET: agentsRoute } = await import('../../src/app/api/properties/managed/agents/route');
    process.env.MANAGED_CAMPAIGNS_ENABLED = '1';
    try {
      authSpies.verifyIdToken.mockResolvedValue({ uid: 'ann' });
      expect(await (await agentsRoute(new Request('http://x', { headers: { authorization: 'Bearer t' } }))).json()).toEqual({ role: null, agents: [] });
    } finally { delete process.env.MANAGED_CAMPAIGNS_ENABLED; }
  });
  it('My Team never links to registrations', () => {
    const page = readFileSync('src/app/dashboard/team/page.js', 'utf8');
    expect(page).not.toMatch(/registrations/i);
  });
});

describe('registration visibility (overview and team access explicitly enabled)', () => {
  beforeEach(() => { process.env.TEAM_REGISTRATIONS_ENABLED = '1'; process.env.OFFICE_REGISTRATIONS_ENABLED = '1'; });
  afterEach(() => { delete process.env.TEAM_REGISTRATIONS_ENABLED; delete process.env.OFFICE_REGISTRATIONS_ENABLED; });
  const get = async (uid) => { authSpies.verifyIdToken.mockResolvedValue({ uid }); const res = await registrationsRoute(new Request('http://x', { headers: { authorization: 'Bearer t' } })); return { status: res.status, ...(await res.json()) }; };
  it('Office Admin sees every registration in the office — and none from other offices', async () => {
    const r = await get('hannah');
    expect(r.scope).toBe('office');
    expect(r.registrations.map((x) => x.id).sort()).toEqual(['r1', 'r2', 'r3']);
    expect(r.registrations.find((x) => x.id === 'r1')).toMatchObject({ address: '1 Ivy St, Tweed Heads NSW', agentName: 'Ivy X', buyerEmail: 'r1@buyer.com', nextAction: 'contact' });
  });
  it('team creators get no registrations list at all (no team-wide registration access)', async () => {
    for (const uid of ['ann', 'dan']) expect((await get(uid)).status).toBe(403);
  });
  it('ordinary agents, team members and leadership-style accounts are refused; another office’s admin sees none of this office', async () => {
    for (const uid of ['bob', 'cat', 'ivy', 'lead']) expect((await get(uid)).status).toBe(403);
    const other = await get('otheradmin');
    expect(other.registrations.map((x) => x.id)).toEqual(['r4']);
    expect(JSON.stringify(other)).not.toMatch(/Ivy|p_ivy|@hph/);
    const none = await registrationsRoute(new Request('http://x'));
    expect(none.status).toBe(401);
  });
  it('price opinions stay anonymous: no opinion amount, score, session or account link in any response', async () => {
    for (const uid of ['hannah']) {
      const text = JSON.stringify(await get(uid));
      expect(text).not.toMatch(/987654|111111|offerAmount|seriousnessLevel|sessionId|sess-secret|buyeracct|userId|opinion1/);
    }
  });
  it('registrations carry a date only, never a time, so they cannot be matched to opinion timestamps', async () => {
    const r = await get('hannah');
    expect(r.registrations.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.createdAt))).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/T\d{2}:\d{2}/);
  });
  it('anonymous (unregistered) opinions are never listed', async () => {
    expect((await get('hannah')).registrations.some((x) => x.id === 'opinion1')).toBe(false);
  });
  it('a suspended office removes even the office admin\'s registrations list', async () => {
    store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah'], status: 'suspended' });
    expect((await get('hannah')).status).toBe(403);
  });
  it('Leadership Hub membership grants no registration access and no operational rights', async () => {
    store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah'], status: 'active', leadershipUids: ['lead', 'bob'] });
    expect((await get('lead')).status).toBe(403);
    expect((await get('bob')).status).toBe(403);
    expect((await get('hannah')).status).toBe(200); // office admin status is separate from leadership
  });
});
