import { describe, it, expect } from 'vitest';
import {
  PUBLIC_PROFILE_FIELDS,
  pickPublicProfile,
  parseProfileIds,
  getPublicAgentProfiles,
  getBuyerProfilesForProperty,
} from '../../src/app/api/services/publicProfileService';
import { pickNotificationUser, NOTIFICATION_USER_FIELDS } from '../../src/app/utils/notificationUser';

const require_ = (await import('node:module')).createRequire(import.meta.url);
const scrub = require_('../../scripts/lib/notificationUserScrub');

// Minimal in-memory Firestore: collection().doc().get(), .where().get(), .limit(), .batch()
function makeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed));
  const col = (name) => ({
    doc: (id) => ({
      id,
      async get() { const d = store[name]?.[id]; return { exists: !!d, id, data: () => d }; },
    }),
    where(field, op, value) {
      const run = () => Object.entries(store[name] || {}).filter(([, d]) => d[field] === value);
      const q = {
        limit: () => q,
        async get() { const rows = run(); return { empty: rows.length === 0, size: rows.length, docs: rows.map(([id, d]) => ({ id, data: () => d })) }; },
      };
      return q;
    },
    async get() { const rows = Object.entries(store[name] || {}); return { size: rows.length, docs: rows.map(([id, d]) => ({ id, data: () => d })) }; },
  });
  return { collection: col, store };
}

const SECRET = 'REDACTED-TEST-VALUE';
const seed = {
  users: {
    agent1: { firstName: 'Ann', lastName: 'Agent', agent: true, avatar: 'a.png', phone: '0400', email: 'ann@x.test',
      xeroAuth: { refresh_token: SECRET }, apiAccess: { apiKey: SECRET }, fcmToken: SECRET, superAdmin: true },
    owner1: { firstName: 'Olly', roles: [], email: 'o@x.test', subscription: { customerId: SECRET } },
    buyer1: { firstName: 'Bea', lastName: 'Buyer', email: 'bea@x.test', phone: '0411', buyerPreferences: { locations: ['X'] }, fcmToken: SECRET },
    liker1: { firstName: 'Lou', email: 'lou@x.test', phone: '0422' },
  },
  properties: { p1: { userId: 'agent1' }, p2: { userId: 'owner1' } },
  offers: {
    o1: { propertyId: 'p1', type: 'opinion', serious: true, userId: 'buyer1' },
    o2: { propertyId: 'p1', type: 'opinion', serious: false, userId: 'liker1' },
    o3: { propertyId: 'p2', type: 'opinion', serious: true, userId: 'liker1' },
  },
};

describe('pickPublicProfile', () => {
  it('returns only allowlisted fields and never credentials or contact email', () => {
    const out = pickPublicProfile(seed.users.agent1);
    expect(Object.keys(out).every((k) => PUBLIC_PROFILE_FIELDS.includes(k))).toBe(true);
    const json = JSON.stringify(out);
    for (const banned of ['xeroAuth', 'apiAccess', 'fcmToken', 'superAdmin', 'email', 'refresh_token']) {
      expect(json).not.toContain(banned);
    }
    expect(out.firstName).toBe('Ann');
  });
});

describe('parseProfileIds', () => {
  it('dedupes, drops junk and caps the list', () => {
    expect(parseProfileIds('abcdef1,abcdef1,,x, bad id ,abcdef2')).toEqual(['abcdef1', 'abcdef2']);
    expect(parseProfileIds(Array.from({ length: 60 }, (_, i) => `user${String(i).padStart(4, '0')}`).join(',')).length).toBe(25);
    expect(parseProfileIds(null)).toEqual([]);
  });
});

describe('getPublicAgentProfiles', () => {
  it('serves agents and property owners, but never a buyer who only liked a listing', async () => {
    const out = await getPublicAgentProfiles(makeDb(seed), ['agent1', 'owner1', 'buyer1', 'liker1', 'missing1']);
    expect(Object.keys(out).sort()).toEqual(['agent1', 'owner1']);
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(JSON.stringify(out)).not.toContain('@x.test');
  });
});

describe('getBuyerProfilesForProperty', () => {
  it('lets the listing agent see only serious-offer buyers, with limited fields', async () => {
    const r = await getBuyerProfilesForProperty(makeDb(seed), { uid: 'agent1', propertyId: 'p1' });
    expect(r.status).toBe(200);
    expect(Object.keys(r.buyers)).toEqual(['buyer1']);
    expect(Object.keys(r.buyers.buyer1).sort()).toEqual(['buyerPreferences', 'email', 'firstName', 'lastName', 'phone']);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
  it('refuses a different agent and unknown properties', async () => {
    expect((await getBuyerProfilesForProperty(makeDb(seed), { uid: 'owner1', propertyId: 'p1' })).status).toBe(403);
    expect((await getBuyerProfilesForProperty(makeDb(seed), { uid: 'agent1', propertyId: 'nope' })).status).toBe(404);
  });
  it('lets a superAdmin view any listing', async () => {
    const r = await getBuyerProfilesForProperty(makeDb(seed), { uid: 'agent1', propertyId: 'p2' }); // agent1 is superAdmin in seed
    expect(r.status).toBe(200);
  });
});

describe('notification user copies', () => {
  it('pickNotificationUser keeps contact fields only', () => {
    const out = pickNotificationUser(seed.users.agent1, 'agent1');
    expect(out.uid).toBe('agent1');
    expect(Object.keys(out).every((k) => k === 'uid' || NOTIFICATION_USER_FIELDS.includes(k))).toBe(true);
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
  it('the cleanup script keeps exactly the same fields (plus uid)', () => {
    expect([...scrub.KEEP_FIELDS].sort()).toEqual(['uid', ...NOTIFICATION_USER_FIELDS].sort());
  });
  it('scrub plan flags copies with extra fields and ignores clean ones', async () => {
    const db = makeDb({ notifications: {
      n1: { user: { firstName: 'A', xeroAuth: { t: SECRET }, fcmToken: SECRET } },
      n2: { user: { firstName: 'B', email: 'b@x.test' } },
      n3: { type: 'newLike' },
    } });
    const plan = await scrub.planNotificationScrub(db);
    expect(plan.toScrub).toEqual(['n1']);
    expect(plan.removedFieldCounts).toEqual({ xeroAuth: 1, fcmToken: 1 });
    expect(JSON.stringify(plan)).not.toContain(SECRET);
    expect(scrub.scrubUser({ firstName: 'A', xeroAuth: 1, uid: 'u' })).toEqual({ uid: 'u', firstName: 'A' });
  });
});
