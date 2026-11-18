import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// Office admin Dashboard: every campaign in THEIR office (via the existing office admin route), nothing from other offices.

// ── In-memory Firestore: doc get, where ('==' / 'in') ──
let store;
function ref(c, id) {
  return { id, get: async () => ({ exists: store[c]?.[id] !== undefined, id, data: () => store[c]?.[id] }) };
}
function col(c, filters = []) {
  const docs = () => Object.entries(store[c] || {})
    .filter(([, d]) => filters.every(([f, op, v]) => (op === 'in' ? v.includes(d[f]) : op === '==' ? d[f] === v : true)))
    .map(([id, d]) => ({ id, ref: ref(c, id), data: () => d }));
  return {
    doc: (id) => ref(c, id),
    where: (f, op, v) => col(c, [...filters, [f, op, v]]),
    get: async () => { const ds = docs(); return { docs: ds, empty: ds.length === 0, size: ds.length }; },
  };
}
const fakeDb = { collection: (c) => col(c) };
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => fakeDb[p] }) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUser: async (uid) => ({ uid, disabled: false }) }) }));
vi.mock('../../src/app/api/services/resendService', () => ({ sendEmail: vi.fn(), sendPropertyReadyEmail: vi.fn() }));
vi.mock('../../src/app/api/middleware/auth', () => ({
  verifyAuth: async (req) => {
    const uid = req.headers.get('x-test-uid');
    return uid ? { authenticated: true, uid } : { authenticated: false, error: 'Unauthorized', status: 401 };
  },
}));

const { listOfficeCampaigns } = await import('../../src/app/api/services/managedCampaignService');
const { GET } = await import('../../src/app/api/offices/[officeId]/campaigns/route');

const person = (first, last, extra = {}) => ({ firstName: first, lastName: last, agent: true, officeId: 'hph', accountStatus: 'active', ...extra });
const prop = (userId, address, extra = {}) => ({ userId, formattedAddress: address, address: 'Suburb', visibility: false, archived: false, createdAt: '2026-11-17T00:00:00Z', stats: { views: 0 }, ...extra });
beforeEach(() => {
  process.env.MANAGED_CAMPAIGNS_ENABLED = '1';
  store = {
    officeAdminInfo: {
      hph: { name: 'Harcourts Property Hub', status: 'active', officeAdminUids: ['accounts', 'jess'], bsoUids: ['peta'] },
      other: { name: 'Other Agency', status: 'active', officeAdminUids: ['otheradmin'], bsoUids: [] },
    },
    users: {
      accounts: person('Premarket', 'Accounts', { isOfficeAdmin: true }),
      jess: person('Jessica', 'Charley', { agent: false, isOfficeAdmin: true }),
      peta: person('Peta', 'Harris'),
      ellen: person('Ellen', 'Bian'),
      rob: person('Rob', 'Ross'),
      outsider: person('Olive', 'Other', { officeId: 'other' }),
      otheradmin: person('Oscar', 'Admin', { officeId: 'other', isOfficeAdmin: true }),
    },
    properties: {
      p1: prop('ellen', '2401/65 Varsity Parade, Varsity Lakes QLD 4227, Australia', { visibility: true, stats: { views: 40 } }),
      // Uploaded by the BSO under the agent's account and managed by the BSO
      p2: prop('rob', '194/2 Bella Avenue, Robina QLD 4226, Australia', { createdByUid: 'peta', createdByRole: 'bso', managedByUid: 'peta', managedCreation: true, stats: { views: 7 } }),
      // Older campaign under the BSO's own account for an assigned roster agent
      p3: prop('peta', '6/9 Australia Avenue, Broadbeach QLD 4218, Australia', { agentId: 'a1', agentName: 'Rob Ross', visibility: true, stats: { views: 3 } }),
      p4: prop('ellen', '1 Sold Street, Robina QLD 4226, Australia', { archived: true, archivedReason: 'sold' }),
      p5: prop('rob', '2 Archive Road, Robina QLD 4226, Australia', { archived: true }),
      p6: prop('ellen', 'Hidden', { hidden: true }),
      x1: prop('outsider', '9 Other Agency Street, Sydney NSW 2000, Australia', { visibility: true, stats: { views: 999 } }),
    },
    offers: {
      o1: { propertyId: 'p1', type: 'opinion' }, o2: { propertyId: 'p1', type: 'opinion' }, o3: { propertyId: 'p1', type: 'offer' },
      o4: { propertyId: 'p3', type: 'opinion' }, o5: { propertyId: 'x1', type: 'opinion' },
    },
  };
});
const get = (uid, officeId, qs = '?stats=1') => GET(
  new Request(`http://x/api/offices/${officeId}/campaigns${qs}`, { headers: uid ? { 'x-test-uid': uid } : {} }),
  { params: Promise.resolve({ officeId }) },
);

describe('office admin Dashboard: every HPH campaign, whoever uploaded it', () => {
  it('lists every non-hidden campaign of the office with full address, selling agent, views and opinion counts', async () => {
    const { campaigns } = await listOfficeCampaigns(fakeDb, 'hph', { withStats: true });
    const byId = Object.fromEntries(campaigns.map((c) => [c.id, c]));
    expect(Object.keys(byId).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']); // not hidden p6, never the other office's x1
    expect(byId.p1).toMatchObject({ address: '2401/65 Varsity Parade, Varsity Lakes QLD 4227, Australia', views: 40, opinions: 2, access: 'officeAdmin' });
    expect(byId.p1.sellingAgent.name).toBe('Ellen Bian');
    expect(byId.p2.sellingAgent.name).toBe('Rob Ross'); // BSO upload: the selling agent, never the BSO
    expect(byId.p3.sellingAgent.name).toBe('Rob Ross'); // assigned roster agent, not the uploader's account
    expect(byId.p3.opinions).toBe(1);
    expect(byId.p4.status).toBe('sold');
    expect(byId.p5).toMatchObject({ archived: true, status: 'archived' });
  });

  it('Office → Campaigns (no stats) is unchanged', async () => {
    const { campaigns } = await listOfficeCampaigns(fakeDb, 'hph');
    for (const c of campaigns) {
      expect(c).not.toHaveProperty('views');
      expect(c).not.toHaveProperty('opinions');
      expect(c).not.toHaveProperty('access');
    }
  });

  it('only that office\'s administrators get the list (server-side, every call)', async () => {
    const ok = await get('accounts', 'hph');
    expect(ok.status).toBe(200);
    expect((await ok.json()).campaigns.map((c) => c.id)).not.toContain('x1');
    expect((await get('jess', 'hph')).status).toBe(200);
    for (const uid of ['ellen', 'peta', 'outsider', 'otheradmin']) expect((await get(uid, 'hph')).status).toBe(403); // agents, BSOs, other offices
    expect((await get('accounts', 'other')).status).toBe(403); // an HPH admin never sees another agency
    expect((await get(null, 'hph')).status).toBe(401);
  });
});

describe('Dashboard wiring (display only; the server decides)', () => {
  const dash = readFileSync('src/app/dashboard/page.js', 'utf8');
  const hook = readFileSync('src/app/dashboard/components/BsoCampaigns.js', 'utf8');
  it('a non-BSO office admin loads the office list with stats; a 403 falls back to their own dashboard', () => {
    expect(hook).toContain('`/api/offices/${encodeURIComponent(officeId)}/campaigns?stats=1`');
    expect(hook).toContain("if (res.status !== 403) throw");
    expect(dash).toContain("isOfficeAdmin: userData?.isOfficeAdmin === true");
  });
  it('shows Total Properties / Public Listings / Total Views / Buyer Opinions from the office campaigns', () => {
    const block = dash.slice(dash.indexOf('data-testid="office-stats"'), dash.indexOf('data-testid="bso-stats"'));
    for (const l of ['Total Properties', 'Public Listings', 'Total Views', 'Buyer Opinions']) expect(block).toContain(`label="${l}"`);
    expect(block).toContain('bsoStats.campaigns');
  });
  it('office admins get Edit only on office-managed campaigns (same rule as Office → Campaigns)', () => {
    expect(hook).toContain("(c.access !== 'officeAdmin' || c.officeManaged) && <Link href={`/dashboard/edit/${c.id}`}");
  });
});
