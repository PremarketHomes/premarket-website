import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mockVerifyIdToken }) }));
const mockGatherReport = vi.fn(async () => {});
vi.mock('../../src/app/api/services/reportService', () => ({ gatherReport: (...a) => mockGatherReport(...a) }));

// Minimal in-memory Firestore: doc().get(), where().get() (chainable, ==), limit()
function makeFakeDb() {
  const store = {};
  return {
    _store: store,
    _seed(name, id, data) { store[name] = store[name] || {}; store[name][id] = data; },
    collection(name) {
      store[name] = store[name] || {};
      return {
        doc: (id) => ({ id, async get() { const d = store[name][id]; return { exists: !!d, id, data: () => d }; } }),
        where(field, op, value) {
          const rows = () => Object.entries(store[name]).filter(([, d]) => d[field] === value);
          const q = {
            limit: () => q,
            async get() { const r = rows(); return { empty: !r.length, size: r.length, docs: r.map(([id, d]) => ({ id, data: () => d })) }; },
          };
          return q;
        },
      };
    },
  };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

const SECRET = 'REDACTED-TEST-VALUE';
const ts = (iso) => ({ toDate: () => new Date(iso) });

function seedWorld() {
  fakeDb = makeFakeDb();
  // Two offices, each with one admin
  fakeDb._seed('officeAdminInfo', 'officeA', { name: 'A', status: 'active', officeAdminUids: ['adminA'] });
  fakeDb._seed('officeAdminInfo', 'officeB', { name: 'B', status: 'active', officeAdminUids: ['adminB'] });
  fakeDb._seed('officeAdminInfo', 'officeDead', { name: 'D', status: 'disabled', officeAdminUids: ['adminDead'] });
  // Users
  fakeDb._seed('users', 'adminA', { firstName: 'Hannah', officeId: 'officeA', isOfficeAdmin: true });
  fakeDb._seed('users', 'adminB', { firstName: 'Other', officeId: 'officeB', isOfficeAdmin: true });
  fakeDb._seed('users', 'adminDead', { firstName: 'Dead', officeId: 'officeDead' });
  fakeDb._seed('users', 'phil', { firstName: 'Phil', officeId: 'officeA', fcmToken: SECRET });            // member of A
  fakeDb._seed('users', 'memberA2', { firstName: 'Mem', officeId: 'officeA' });                           // ordinary member of A
  fakeDb._seed('users', 'formerA', { firstName: 'Former' });                                              // left office A (no officeId)
  fakeDb._seed('users', 'invitee', { firstName: 'Invitee' });                                             // pending: not linked yet
  fakeDb._seed('users', 'indep', { firstName: 'Indep' });                                                 // independent agent, no office
  fakeDb._seed('users', 'root', { firstName: 'Root', superAdmin: true });
  fakeDb._seed('users', 'buyer1', { firstName: 'Bea', lastName: 'Buyer', email: 'bea@x.test', phone: '0411', fcmToken: SECRET });
  // Listings. Phil's predates joining (createdAt is irrelevant to access).
  fakeDb._seed('properties', 'philOld', { userId: 'phil', createdAt: ts('2026-09-09T00:00:00Z'), formattedAddress: '1 Old St' });
  fakeDb._seed('properties', 'formerListing', { userId: 'formerA' });
  fakeDb._seed('properties', 'inviteeListing', { userId: 'invitee' });
  fakeDb._seed('properties', 'indepListing', { userId: 'indep', soldAt: ts('2026-10-01T00:00:00Z') });
  fakeDb._seed('offers', 'o1', { propertyId: 'philOld', type: 'opinion', serious: true, userId: 'buyer1', createdAt: ts('2026-10-02T00:00:00Z'), offerAmount: 900000 });
  fakeDb._seed('offers', 'o2', { propertyId: 'philOld', type: 'opinion', serious: false, offerAmount: 850000 });
  fakeDb._seed('likes', 'l1', { propertyId: 'philOld', userId: 'buyer1' });
}

const req = (url, { method = 'GET', token = 't', body } = {}) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const as = (uid) => mockVerifyIdToken.mockResolvedValue({ uid });
const ctx = (id) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { seedWorld(); vi.clearAllMocks(); mockGatherReport.mockResolvedValue(undefined); });

describe('getPropertyReportAccess', () => {
  const access = async (uid, propertyId) => {
    const { getPropertyReportAccess } = await import('../../src/app/api/services/propertyAccessService');
    const property = (await fakeDb.collection('properties').doc(propertyId).get()).data();
    return getPropertyReportAccess(fakeDb, { uid, property });
  };

  it('owner and superAdmin keep their access', async () => {
    expect(await access('phil', 'philOld')).toBe('owner');
    expect(await access('root', 'philOld')).toBe('superAdmin');
    expect(await access('root', 'indepListing')).toBe('superAdmin');
  });
  it("an admin of the agent's CURRENT office gets officeAdmin — including a listing created before the agent joined", async () => {
    expect(await access('adminA', 'philOld')).toBe('officeAdmin');
  });
  it('cross-office: an admin of a DIFFERENT office is refused', async () => {
    expect(await access('adminB', 'philOld')).toBeNull();
    expect(await access('adminA', 'indepListing')).toBeNull();
  });
  it('an ordinary agent (same office or not) is refused another agent\'s report', async () => {
    expect(await access('memberA2', 'philOld')).toBeNull();
    expect(await access('indep', 'philOld')).toBeNull();
    expect(await access('buyer1', 'philOld')).toBeNull();
  });
  it('a former member: once the agent has left (no officeId) the office admin loses access', async () => {
    expect(await access('adminA', 'formerListing')).toBeNull();
  });
  it('a pending invitee (not yet linked to the office) exposes nothing to the office admin', async () => {
    expect(await access('adminA', 'inviteeListing')).toBeNull();
  });
  it('an admin of a non-active office is refused', async () => {
    fakeDb._seed('users', 'phil', { firstName: 'Phil', officeId: 'officeDead' });
    expect(await access('adminDead', 'philOld')).toBeNull();
  });
  it('access follows membership live: removing the agent from the office ends it immediately', async () => {
    expect(await access('adminA', 'philOld')).toBe('officeAdmin');
    fakeDb._seed('users', 'phil', { firstName: 'Phil' }); // left
    expect(await access('adminA', 'philOld')).toBeNull();
  });
});

describe('GET /api/properties/[id]/report', () => {
  const call = async (uid, id = 'philOld', opts) => {
    if (uid) as(uid);
    const { GET } = await import('../../src/app/api/properties/[id]/report/route.js');
    return GET(req(`http://localhost/api/properties/${id}/report`, opts), ctx(id));
  };

  it('office admin gets the full report data, read-only, with buyer contact details and no secrets', async () => {
    const res = await call('adminA');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.readOnly).toBe(true);
    expect(body.access).toBe('officeAdmin');
    expect(body.offers).toHaveLength(2);
    expect(body.likes).toHaveLength(1);
    expect(body.buyers.buyer1).toMatchObject({ firstName: 'Bea', email: 'bea@x.test', phone: '0411' });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });
  it('timestamps are sent as ISO strings the page can already format', async () => {
    const body = await (await call('adminA')).json();
    expect(body.property.createdAt).toBe('2026-09-09T00:00:00.000Z');
    expect(body.offers.find((o) => o.id === 'o1').createdAt).toBe('2026-10-02T00:00:00.000Z');
  });
  it('owner and superAdmin are served but are NOT read-only', async () => {
    expect((await (await call('phil')).json()).readOnly).toBe(false);
    expect((await (await call('root')).json()).readOnly).toBe(false);
  });
  it.each([
    ['cross-office admin', 'adminB', 'philOld'],
    ['ordinary agent in the same office', 'memberA2', 'philOld'],
    ['independent agent', 'indep', 'philOld'],
    ['admin after the agent left', 'adminA', 'formerListing'],
    ['admin viewing a pending invitee\'s listing', 'adminA', 'inviteeListing'],
  ])('403 for %s', async (_n, uid, id) => {
    const res = await call(uid, id);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('Bea');
  });
  it('401 when logged out and 404 for an unknown property', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad'));
    expect((await call(null, 'philOld')).status).toBe(401);
    expect((await call('adminA', 'nope')).status).toBe(404);
  });
});

describe('GET /api/properties/[id]/buyer-profiles', () => {
  const call = async (uid, id = 'philOld') => {
    as(uid);
    const { GET } = await import('../../src/app/api/properties/[id]/buyer-profiles/route.js');
    return GET(req(`http://localhost/api/properties/${id}/buyer-profiles`), ctx(id));
  };
  it('owner, superAdmin and the current office admin are served; everyone else is refused', async () => {
    for (const uid of ['phil', 'root', 'adminA']) expect((await call(uid)).status).toBe(200);
    for (const uid of ['adminB', 'memberA2', 'indep', 'buyer1']) expect((await call(uid)).status).toBe(403);
  });
});

describe('POST /api/send-report', () => {
  const send = async (uid, propertyId = 'philOld') => {
    as(uid);
    const { POST } = await import('../../src/app/api/send-report/route.js');
    return POST(req('http://localhost/api/send-report', { method: 'POST', body: { email: 'v@x.test', propertyId, name: 'V' } }));
  };
  it('the listing owner and a superAdmin can send', async () => {
    expect((await send('phil')).status).toBe(200);
    expect((await send('root')).status).toBe(200);
    expect(mockGatherReport).toHaveBeenCalledTimes(2);
  });
  it('an office admin is READ-ONLY: cannot send a report for a member\'s listing', async () => {
    expect((await send('adminA')).status).toBe(403);
    expect(mockGatherReport).not.toHaveBeenCalled();
  });
  it('another agent, a cross-office admin and a buyer cannot send any property\'s report', async () => {
    for (const uid of ['memberA2', 'indep', 'adminB', 'buyer1']) expect((await send(uid)).status).toBe(403);
    expect(mockGatherReport).not.toHaveBeenCalled();
  });
  it('404 for an unknown property, and logged-out is rejected', async () => {
    expect((await send('phil', 'nope')).status).toBe(404);
    const { POST } = await import('../../src/app/api/send-report/route.js');
    const res = await POST(req('http://localhost/api/send-report', { method: 'POST', token: null, body: { email: 'v@x.test', propertyId: 'philOld' } }));
    expect(res.status).toBe(401);
    expect(mockGatherReport).not.toHaveBeenCalled();
  });
});

describe('report page: read-only mode and Team link (source-level)', () => {
  const page = fs.readFileSync(new URL('../../src/app/dashboard/property/[id]/page.js', import.meta.url), 'utf-8');
  const team = fs.readFileSync(new URL('../../src/app/dashboard/office/team/page.js', import.meta.url), 'utf-8');

  it('shows the "Viewing as office admin" indicator only when read-only', () => {
    expect(page).toMatch(/\{readOnly && \([\s\S]{0,400}Viewing as office admin/);
  });
  it('every management action is gated behind !readOnly', () => {
    for (const marker of ['Send Report - primary action', '{/* iPad mode */}', 'Sold Status Action']) {
      const at = page.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      expect(page.slice(Math.max(0, at - 160), at + 260)).toContain('!readOnly');
    }
    expect(page).toContain('onEditImage={readOnly ? undefined');
    expect(page).toContain("const VisibilityTag = readOnly ? 'div' : 'button'");
  });
  it('Copy Link and Preview remain outside the read-only gate', () => {
    const iPad = page.indexOf('{/* iPad mode */}');
    expect(page.indexOf('Copy Link')).toBeLessThan(iPad);
    expect(page.indexOf('Preview Listing')).toBeLessThan(iPad);
  });
  it('owners/superAdmins still read Firestore directly; others go through the server route only', () => {
    expect(page).toContain('const ownListing =');
    expect(page).toContain('/api/properties/${propertyId}/report');
    // the direct offers query lives only inside the ownListing branch
    const direct = page.indexOf("collection(db, 'offers')");
    const branch = page.indexOf('if (ownListing) {');
    const elseBranch = page.indexOf('} else {', branch);
    expect(direct).toBeGreaterThan(branch);
    expect(direct).toBeLessThan(elseBranch);
  });
  it('Team page links each property to its report', () => {
    expect(team).toContain('href={`/dashboard/property/${p.id}`}');
    expect(team).toContain('View report');
  });
  it('does not touch the Firestore rules for offers (still owner/superAdmin only)', () => {
    const rules = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf-8');
    const offers = rules.slice(rules.indexOf('match /offers/{offerId}'), rules.indexOf('match /likes/{likeId}'));
    expect(offers).toContain('isOwnerOfProperty(resource.data.propertyId)');
    expect(offers).not.toMatch(/officeAdmin/i);
  });
});
