import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createFakeFirestore } from './helpers/fakeFirestore';

// Open Home live pilot (api/services/openHomePilot.js + api/open-home/*): allowlisted agent only, own campaigns only,
// public buyer routes by unguessable code, and identity / opinion stored apart with agents seeing aggregates only.

const PHIL = 'NwnuzW7YrdX7looxQVvg6ZpqaOg2';
const OTHER = 'someOtherAgentUid000000000001';
const fake = vi.hoisted(() => ({ db: null, tokens: {} }));
vi.mock('../../src/app/firebase/adminApp', () => ({ get adminDb() { return fake.db; } }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (t) => { if (!fake.tokens[t]) throw Object.assign(new Error('bad'), { code: 'auth/argument-error' }); return { uid: fake.tokens[t] }; } }),
}));

const svc = await import('../../src/app/api/services/openHomePilot');
const { computePriceOpinionRange } = await import('../../src/app/utils/priceOpinionRange');
const { NextRequest } = await import('next/server');
const routes = {
  pilot: await import('../../src/app/api/open-home/pilot/route'),
  sessions: await import('../../src/app/api/open-home/sessions/route'),
  session: await import('../../src/app/api/open-home/sessions/[id]/route'),
  visit: await import('../../src/app/api/open-home/visit/[code]/route'),
  checkIn: await import('../../src/app/api/open-home/visit/[code]/check-in/route'),
  opinion: await import('../../src/app/api/open-home/visit/[code]/opinion/route'),
  interest: await import('../../src/app/api/open-home/visit/[code]/interest/route'),
};

const PROPERTY = {
  userId: PHIL, formattedAddress: '23 Esplanade, Jacobs Well QLD 4208, Australia', address: 'Jacobs Well QLD Australia', price: 1400000,
  imageUrls: ['https://cdn.example/p1.jpg'], visibility: true, clientName: 'Vendor Name', clientEmail: 'vendor@example.com', clientPhone: '0400000000',
};
const RANGE = computePriceOpinionRange(PROPERTY);
const BUYER = { fullName: 'Olivia Bennett', mobile: '0491 570 006', email: 'olivia@example.com' };
const ENV = { ...process.env };
const live = {}; // env pointing at the live project (no FIREBASE_SERVICE_ACCOUNT / project id) in production
const staging = { FIREBASE_PROJECT_ID: 'premarket-ows-staging-dbf1', OPEN_HOME_PILOT_TEST_UIDS: OTHER };

beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.VERCEL_ENV;
  fake.tokens = { 'phil-token': PHIL, 'other-token': OTHER };
  fake.db = createFakeFirestore({
    properties: {
      p1: PROPERTY,
      p2: { ...PROPERTY, archived: true },
      p3: { ...PROPERTY, userId: OTHER },
      p4: { ...PROPERTY, showSuburbOnly: true },
    },
    users: { [PHIL]: { firstName: 'Phil', lastName: 'Chillemi', officeId: 'office1' } },
    offices: { office1: { agencyBrandId: 'office-office1' } },
    agencyBrands: { 'office-office1': { name: 'Harcourts Property Hub', logoUrl: 'https://premarket.homes/offices/hph/logo-colour.png', colors: { primary: '#001f49' } } },
  });
});
afterEach(() => { process.env = { ...ENV }; });

const start = (mode = 'live', propertyId = 'p1') => svc.startPilotSession(fake.db, { uid: PHIL, propertyId, mode, env: live });
const rejects = async (p, status, code) => {
  const err = await p.then(() => null, (e) => e);
  expect(err, 'expected a rejection').toBeTruthy();
  expect(err.status).toBe(status);
  if (code) expect(err.code).toBe(code);
};

describe('who is in the pilot', () => {
  it('only Phil’s verified account is on the allowlist', () => {
    expect(svc.OPEN_HOME_PILOT_UIDS).toEqual([PHIL]);
    expect(svc.isPilotAgent(PHIL, live)).toBe(true);
    for (const u of [OTHER, '', null, undefined, 'phil@propertyhubgc.com.au']) expect(svc.isPilotAgent(u, live)).toBe(false);
  });
  it('a staging test agent counts only when the server is NOT on the live project', () => {
    expect(svc.isPilotAgent(OTHER, { OPEN_HOME_PILOT_TEST_UIDS: OTHER })).toBe(false); // live by default
    expect(svc.isPilotAgent(OTHER, { FIREBASE_PROJECT_ID: 'premarket-homes', OPEN_HOME_PILOT_TEST_UIDS: OTHER })).toBe(false);
    expect(svc.isPilotAgent(OTHER, staging)).toBe(true);
  });
  it('everything agent-side refuses anyone else (403)', async () => {
    await rejects(svc.listPilotCampaigns(fake.db, { uid: OTHER, env: live }), 403, 'not-in-pilot');
    await rejects(svc.startPilotSession(fake.db, { uid: OTHER, propertyId: 'p3', mode: 'live', env: live }), 403, 'not-in-pilot');
    await rejects(svc.listPilotSessions(fake.db, { uid: OTHER, env: live }), 403);
  });
});

describe('agent: campaigns and sessions', () => {
  it('lists only Phil’s own current campaigns, without vendor details or price', async () => {
    const list = await svc.listPilotCampaigns(fake.db, { uid: PHIL, env: live });
    expect(list.map((c) => c.id).sort()).toEqual(['p1', 'p4']);
    expect(list.find((c) => c.id === 'p1')).toMatchObject({ street: '23 Esplanade', suburb: 'Jacobs Well QLD 4208', isPublic: true, activeSession: null });
    expect(JSON.stringify(list)).not.toMatch(/Vendor|vendor@|0400000000|1400000/);
  });

  it('starts a session only on his own, current campaign, in live or test mode', async () => {
    await rejects(svc.startPilotSession(fake.db, { uid: PHIL, propertyId: 'p3', mode: 'live', env: live }), 404, 'no-campaign');
    await rejects(svc.startPilotSession(fake.db, { uid: PHIL, propertyId: 'p2', mode: 'live', env: live }), 404, 'no-campaign');
    await rejects(svc.startPilotSession(fake.db, { uid: PHIL, propertyId: 'p1', mode: 'prod', env: live }), 400);
    const s = await start('test');
    expect(svc.isSessionCode(s.id)).toBe(true);
    expect(s).toMatchObject({ propertyId: 'p1', mode: 'test', state: 'active', checkIns: 0 });
    expect(fake.db._get(`openHomeSessions/${s.id}`)).toMatchObject({ agentUid: PHIL, status: 'active', range: RANGE, checkInCount: 0 });
    expect(fake.db._get(`openHomeOpinions/${s.id}`)).toEqual({ propertyId: 'p1', agentUid: PHIL, mode: 'test', amounts: [], count: 0 });
    expect(fake.db._get(`openHomeOpinionGuards/${s.id}`)).toEqual({ hashes: [] });
    expect((await start('live')).id).toBe(s.id); // one running open home per campaign
    expect(fake.db._get('openHomeActive/p1')).toEqual({ sessionId: s.id, agentUid: PHIL });
    await svc.endPilotSession(fake.db, { uid: PHIL, sessionId: s.id, env: live });
    expect((await start('live')).id).not.toBe(s.id); // a finished one doesn't block the next
  });

  it('a preview deployment connected to live data can’t write', async () => {
    await rejects(svc.startPilotSession(fake.db, { uid: PHIL, propertyId: 'p1', mode: 'live', env: { VERCEL_ENV: 'preview' } }), 403, 'preview-read-only');
  });

  it('sessions codes are unguessable and well-formed', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => svc.newSessionCode()));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(svc.isSessionCode(c)).toBe(true);
  });
});

describe('buyer: public visit, check-in, opinion, interest', () => {
  it('the public visit shows the property and branding only: no vendor details, price, ids or counts', async () => {
    const s = await start();
    const v = await svc.publicVisit(fake.db, { code: s.id, env: live });
    expect(Object.keys(v).sort()).toEqual(['brand', 'mode', 'noticeVersion', 'property', 'range', 'state']);
    expect(v.property).toEqual({ street: '23 Esplanade', suburb: 'Jacobs Well QLD 4208', imageUrl: 'https://cdn.example/p1.jpg', agentName: 'Phil Chillemi' });
    expect(v.brand).toEqual({ name: 'Harcourts Property Hub', logoUrl: 'https://premarket.homes/offices/hph/logo-colour.png', primary: '#001f49' });
    expect(v.range).toEqual(RANGE);
    expect(JSON.stringify(v)).not.toMatch(/Vendor|vendor@|0400000000|1400000|NwnuzW7|p1"|checkIn/);
    await rejects(svc.publicVisit(fake.db, { code: 'not-a-code', env: live }), 404);
    await rejects(svc.publicVisit(fake.db, { code: svc.newSessionCode(), env: live }), 404);
  });

  it('formats the address shapes found on real campaigns', () => {
    expect(svc.publicAddress({ formattedAddress: '23 Esplanade, Jacobs Well QLD 4208, Australia' })).toEqual({ street: '23 Esplanade', suburb: 'Jacobs Well QLD 4208' });
    expect(svc.publicAddress({ formattedAddress: '1 Greenwich Avenue, Pimpama QLD, Australia, 4209' })).toEqual({ street: '1 Greenwich Avenue', suburb: 'Pimpama QLD 4209' });
    expect(svc.publicAddress({ formattedAddress: '137-139 Crescent Ave, Hope Island QLD 4212, Australia' })).toEqual({ street: '137-139 Crescent Ave', suburb: 'Hope Island QLD 4212' });
    expect(svc.publicAddress({ showSuburbOnly: true, formattedAddress: '5 Secret St, Robina QLD 4226, Australia', address: 'Robina QLD Australia' })).toEqual({ street: 'Robina QLD', suburb: '' });
    expect(svc.publicAddress({})).toEqual({ street: 'This property', suburb: '' });
  });

  it('honours “show suburb only”', async () => {
    const s = await start('live', 'p4');
    expect((await svc.publicVisit(fake.db, { code: s.id, env: live })).property).toMatchObject({ street: 'Jacobs Well QLD', suburb: '' });
  });

  it('check-in stores identity only (to the minute) and rejects bad details without storing anything', async () => {
    const now = Date.parse('2026-11-29T00:04:37Z');
    const s = await svc.startPilotSession(fake.db, { uid: PHIL, propertyId: 'p1', mode: 'live', env: live, now: now - 60000 });
    await rejects(svc.pilotCheckIn(fake.db, { code: s.id, body: { fullName: '', mobile: '1', email: 'x' }, env: live, now }), 400, 'invalid');
    expect(fake.db._all('openHomeAttendance')).toEqual([]);
    const r = await svc.pilotCheckIn(fake.db, { code: s.id, body: { ...BUYER, updatesOptIn: true, offerAmount: 999 }, env: live, now });
    const [rec] = fake.db._all('openHomeAttendance');
    expect(rec.id).toBe(r.ref);
    expect(Object.keys(rec).sort()).toEqual(['agentUid', 'checkedInAt', 'email', 'fullName', 'id', 'interest', 'marketingConsent', 'mobile', 'mode', 'noticeVersion', 'propertyId', 'sessionId']);
    expect(rec).toMatchObject({ fullName: 'Olivia Bennett', mobile: '+61491570006', email: 'olivia@example.com', marketingConsent: true, noticeVersion: svc.NOTICE_VERSION, interest: null });
    expect(rec.checkedInAt.toISOString()).toBe('2026-11-29T00:04:00.000Z');
    expect(fake.db._get(`openHomeSessions/${s.id}`).checkInCount).toBe(1);
  });

  it('an opinion stores only the amount in the session’s sorted list, with no time, buyer or reference', async () => {
    const s = await start();
    const { ref } = await svc.pilotCheckIn(fake.db, { code: s.id, body: BUYER, env: live });
    await svc.pilotCheckIn(fake.db, { code: s.id, body: { ...BUYER, email: 'b@example.com' }, env: live });
    const hi = RANGE.min + 300000;
    const lo = RANGE.min + 100000;
    expect(await svc.pilotOpinion(fake.db, { code: s.id, amount: hi, device: 'device-one-0123456789', env: live })).toEqual({ ok: true });
    expect(await svc.pilotOpinion(fake.db, { code: s.id, amount: lo, device: 'device-two-0123456789', env: live })).toEqual({ ok: true });
    const op = fake.db._get(`openHomeOpinions/${s.id}`);
    expect(op).toEqual({ propertyId: 'p1', agentUid: PHIL, mode: 'live', amounts: [lo, hi], count: 2 });
    const guards = fake.db._get(`openHomeOpinionGuards/${s.id}`);
    expect(Object.keys(guards)).toEqual(['hashes']);
    expect(guards.hashes).toHaveLength(2);
    expect(guards.hashes.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    expect(JSON.stringify(guards)).not.toContain('device-one');
    // the identity side never learns anything about it
    expect(JSON.stringify(fake.db._all('openHomeAttendance'))).not.toMatch(new RegExp(`${hi}|${lo}|device`));
    expect(JSON.stringify(op)).not.toContain(ref);
  });

  it('ignores an accidental repeat from the same phone, refuses off-slider amounts and caps the total', async () => {
    const s = await start();
    await svc.pilotCheckIn(fake.db, { code: s.id, body: BUYER, env: live });
    const device = 'same-phone-0123456789';
    await svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.min, device, env: live });
    expect(await svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.max, device, env: live })).toEqual({ ok: true, duplicate: true });
    expect(fake.db._get(`openHomeOpinions/${s.id}`).amounts).toEqual([RANGE.min]);
    await rejects(svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.max + 10000, device: 'd2-0123456789abcdef', env: live }), 400, 'bad-amount');
    await rejects(svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.min + 5000, device: 'd2-0123456789abcdef', env: live }), 400, 'bad-amount');
    await rejects(svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.min, device: 'short', env: live }), 400, 'bad-device');
    // 1 check-in + slack of 2 = at most 3 opinions
    await svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.min, device: 'd2-0123456789abcdef', env: live });
    await svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.min, device: 'd3-0123456789abcdef', env: live });
    await rejects(svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.min, device: 'd4-0123456789abcdef', env: live }), 429, 'limit');
  });

  it('caps check-ins per open home', async () => {
    const s = await start();
    await fake.db.collection('openHomeSessions').doc(s.id).update({ checkInCount: svc.LIMITS.checkInsPerSession });
    await rejects(svc.pilotCheckIn(fake.db, { code: s.id, body: BUYER, env: live }), 429, 'full');
  });

  it('register interest updates only the buyer’s own check-in record', async () => {
    const s = await start();
    const { ref } = await svc.pilotCheckIn(fake.db, { code: s.id, body: BUYER, env: live });
    await svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.min, device: 'device-xyz-0123456789', env: live });
    await svc.pilotInterest(fake.db, { code: s.id, ref, wants: ['call', 'hack', 'call'], env: live });
    expect(fake.db._get(`openHomeAttendance/${ref}`).interest).toEqual({ wants: ['call'] });
    expect(fake.db._get(`openHomeOpinions/${s.id}`).amounts).toEqual([RANGE.min]);
    const other = await start('live', 'p4');
    await rejects(svc.pilotInterest(fake.db, { code: other.id, ref, wants: [], env: live }), 404, 'bad-ref');
  });

  it('ended open homes take no more check-ins or opinions; removing the agent from the pilot switches the QR off', async () => {
    const s = await start();
    await svc.endPilotSession(fake.db, { uid: PHIL, sessionId: s.id, env: live });
    await rejects(svc.pilotCheckIn(fake.db, { code: s.id, body: BUYER, env: live }), 410, 'ended');
    await rejects(svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.min, device: 'device-xyz-0123456789', env: live }), 410, 'ended');
    expect((await svc.publicVisit(fake.db, { code: s.id, env: live })).state).toBe('ended');
    // a staging test agent's session stops working the moment they're off the list
    const t = await svc.startPilotSession(fake.db, { uid: OTHER, propertyId: 'p3', mode: 'live', env: staging });
    expect((await svc.publicVisit(fake.db, { code: t.id, env: staging })).state).toBe('active');
    await rejects(svc.publicVisit(fake.db, { code: t.id, env: { FIREBASE_PROJECT_ID: 'premarket-ows-staging-dbf1' } }), 404);
  });

  it('a session expires on its own after 12 hours', async () => {
    const t0 = Date.now();
    const s = await svc.startPilotSession(fake.db, { uid: PHIL, propertyId: 'p1', mode: 'live', env: live, now: t0 });
    await rejects(svc.pilotCheckIn(fake.db, { code: s.id, body: BUYER, env: live, now: t0 + 12.5 * 3600 * 1000 }), 410, 'ended');
  });
});

describe('agent: what the report shows', () => {
  async function withOpinions(n, { end = false } = {}) {
    const s = await start();
    for (let i = 0; i < n; i += 1) {
      await svc.pilotCheckIn(fake.db, { code: s.id, body: { ...BUYER, email: `b${i}@example.com` }, env: live });
      await svc.pilotOpinion(fake.db, { code: s.id, amount: RANGE.min + i * 20000, device: `device-${i}-0123456789ab`, env: live });
    }
    if (end) await svc.endPilotSession(fake.db, { uid: PHIL, sessionId: s.id, env: live });
    return s;
  }

  it('live: the register plus a stepped count, never an amount', async () => {
    const s = await withOpinions(6);
    const r = await svc.pilotSessionReport(fake.db, { uid: PHIL, sessionId: s.id, env: live });
    expect(r.opinions).toEqual({ state: 'live', live: { label: '5+', atLeast: 5 } });
    expect(r.attendance).toHaveLength(6);
    expect(Object.keys(r.attendance[0]).sort()).toEqual(['checkedInAt', 'email', 'fullName', 'interest', 'marketingConsent', 'mobile']);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/amounts|hashes|"ref"|sessionId|1090000|1110000/);
  });

  it('ended with 5+: combined results only; ended with fewer: nothing about price', async () => {
    const big = await withOpinions(6, { end: true });
    const r = await svc.pilotSessionReport(fake.db, { uid: PHIL, sessionId: big.id, env: live });
    expect(r.opinions.state).toBe('ready');
    expect(Object.keys(r.opinions).sort()).toEqual(['bands', 'count', 'middle', 'state', 'typical']);
    fake.db = createFakeFirestore({ properties: { p1: PROPERTY }, users: {} });
    const small = await withOpinions(3, { end: true });
    expect((await svc.pilotSessionReport(fake.db, { uid: PHIL, sessionId: small.id, env: live })).opinions).toEqual({ state: 'too-few', minimum: 5 });
  });

  it('another account can’t see or end Phil’s open home', async () => {
    const s = await start();
    await rejects(svc.pilotSessionReport(fake.db, { uid: OTHER, sessionId: s.id, env: staging }), 404, 'no-session');
    await rejects(svc.endPilotSession(fake.db, { uid: OTHER, sessionId: s.id, env: staging }), 404, 'no-session');
  });

  it('test open homes can be deleted with everything in them; live ones can’t', async () => {
    const t = await start('test');
    await svc.pilotCheckIn(fake.db, { code: t.id, body: BUYER, env: live });
    await svc.pilotOpinion(fake.db, { code: t.id, amount: RANGE.min, device: 'device-xyz-0123456789', env: live });
    expect(await svc.deleteTestSession(fake.db, { uid: PHIL, sessionId: t.id, env: live })).toEqual({ ok: true, deleted: 1 });
    for (const c of ['openHomeSessions', 'openHomeAttendance', 'openHomeOpinions', 'openHomeOpinionGuards', 'openHomeActive']) expect(fake.db._all(c)).toEqual([]);
    const l = await start('live');
    await rejects(svc.deleteTestSession(fake.db, { uid: PHIL, sessionId: l.id, env: live }), 400, 'not-test');
  });
});

describe('API routes', () => {
  const req = (url, { method = 'GET', token, body, type = 'application/json' } = {}) => new NextRequest(`https://premarket.homes${url}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': type } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const ctx = (p) => ({ params: Promise.resolve(p) });

  it('agent routes need a signed-in pilot account', async () => {
    expect((await routes.pilot.GET(req('/api/open-home/pilot'))).status).toBe(401);
    expect(await (await routes.pilot.GET(req('/api/open-home/pilot', { token: 'other-token' }))).json()).toEqual({ enabled: false });
    expect(await (await routes.pilot.GET(req('/api/open-home/pilot', { token: 'phil-token' }))).json()).toEqual({ enabled: true });
    expect((await routes.sessions.POST(req('/api/open-home/sessions', { method: 'POST', token: 'other-token', body: { propertyId: 'p3', mode: 'live' } }))).status).toBe(403);
    const ok = await routes.sessions.POST(req('/api/open-home/sessions', { method: 'POST', token: 'phil-token', body: { propertyId: 'p1', mode: 'test' } }));
    expect(ok.status).toBe(201);
    const { session } = await ok.json();
    expect((await routes.session.GET(req(`/api/open-home/sessions/${session.id}`), ctx({ id: session.id }))).status).toBe(401);
    expect((await routes.session.GET(req(`/api/open-home/sessions/${session.id}`, { token: 'phil-token' }), ctx({ id: session.id }))).status).toBe(200);
  });

  it('buyer routes work without any login, JSON only, and the opinion route stores nothing but the amount', async () => {
    const s = await start();
    expect((await routes.visit.GET(req(`/api/open-home/visit/${s.id}`), ctx({ code: s.id }))).status).toBe(200);
    expect((await routes.checkIn.POST(req(`/api/open-home/visit/${s.id}/check-in`, { method: 'POST', body: 'fullName=x', type: 'application/x-www-form-urlencoded' }), ctx({ code: s.id }))).status).toBe(415);
    const ci = await routes.checkIn.POST(req(`/api/open-home/visit/${s.id}/check-in`, { method: 'POST', body: BUYER }), ctx({ code: s.id }));
    expect(ci.status).toBe(201);
    const { ref } = await ci.json();
    const op = await routes.opinion.POST(req(`/api/open-home/visit/${s.id}/opinion`, { method: 'POST', token: 'phil-token', body: { amount: RANGE.min, device: 'device-route-0123456', ref, fullName: 'Olivia Bennett', at: Date.now() } }), ctx({ code: s.id }));
    expect(op.status).toBe(201);
    // The extra fields sent with it (check-in reference, name, time, an Authorization header) are ignored entirely.
    expect(JSON.stringify(fake.db._get(`openHomeOpinions/${s.id}`))).not.toMatch(new RegExp(`${ref}|Olivia|"at"`));
    expect(JSON.stringify(fake.db._get(`openHomeOpinionGuards/${s.id}`))).not.toMatch(new RegExp(`${ref}|Olivia`));
    expect(fake.db._get(`openHomeOpinions/${s.id}`).amounts).toEqual([RANGE.min]);
    const interest = await routes.interest.POST(req(`/api/open-home/visit/${s.id}/interest`, { method: 'POST', body: { ref, wants: ['call'] } }), ctx({ code: s.id }));
    expect(interest.status).toBe(200);
    expect((await routes.visit.GET(req('/api/open-home/visit/zzzz'), ctx({ code: 'zzzz' }))).status).toBe(404);
  });

  it('errors never echo request bodies to the logs', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.db = { collection: () => { throw Object.assign(new Error('boom Olivia Bennett 0491570006'), { name: 'FirebaseError' }); } };
    const res = await routes.checkIn.POST(req(`/api/open-home/visit/${svc.newSessionCode()}/check-in`, { method: 'POST', body: BUYER }), ctx({ code: svc.newSessionCode() }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Olivia|0491|boom/);
    spy.mockRestore();
  });
});

describe('isolation from everything that exists today', () => {
  const ROOT = path.resolve(__dirname, '../../src/app');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('pilot code never touches offers, the kiosk, reports or emails', () => {
    const files = ['api/services/openHomePilot.js', 'api/open-home/_http.js', 'open-home/liveService.js', 'open-home/[code]/OpenHomeVisitClient.js', 'dashboard/open-home/page.js', 'dashboard/open-home/sign/page.js'];
    for (const f of files) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/'offers'|"offers"|kioskPersistence|kioskOutbox|reportService|resendService|sendEmail|twilio|sms/i);
    }
  });

  it('the buyer’s phone sends no cookies and keeps the check-in reference out of the opinion request', () => {
    const live = read('open-home/liveService.js');
    expect(live).toMatch(/credentials: 'omit'/);
    expect(live).toMatch(/submitOpinion: \(amount\) => post\(code, '\/opinion', \{ amount, device: deviceToken\(code\) \}\)/);
    expect(read('api/open-home/visit/[code]/opinion/route.js')).toMatch(/const \{ amount, device \} = await readJson\(request\);/);
  });

  it('new collections are server-only: no Firestore rule opens them, and the default deny is in place', () => {
    const rules = fs.readFileSync(path.resolve(ROOT, '../../firestore.rules'), 'utf8');
    for (const c of Object.values(svc.COLLECTIONS)) expect(rules).not.toContain(c);
    expect(rules).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
    const serverOnly = fs.readFileSync(path.resolve(ROOT, '../../tests/rules/server-only.test.js'), 'utf8');
    for (const c of Object.values(svc.COLLECTIONS)) expect(serverOnly).toContain(`'${c}'`);
  });

  it('the dashboard shows the Open Home link only when the server says so', () => {
    const dash = read('dashboard/page.js');
    expect(dash).toMatch(/\.\.\.\(openHomePilot \? \[\{ id: 'open-home', label: 'Open Home', icon: QrCode, href: '\/dashboard\/open-home' \}\] : \[\]\)/);
    expect(dash).toMatch(/authFetch\('\/api\/open-home\/pilot'\)/);
  });
});
