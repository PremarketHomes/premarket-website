import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// The real module (billing below sees a mocked copy whose allowlist is ['luke']).
const realRule = await vi.importActual('../../src/app/utils/testCampaign');

// ── The rule itself, with an explicit allowlist (the shipped list is exercised separately below) ──
const ALLOW = ['luke'];
const own = (extra = {}) => ({ userId: 'luke', testCampaign: true, ...extra });

describe('isTestCampaign: the one rule billing, reporting and labels share', () => {
  it('is a test campaign only when flagged, owned by the authorised account, and created by it for itself', () => {
    expect(realRule.isTestCampaign(own(), ALLOW)).toBe(true);
    expect(realRule.isTestCampaign(own({ createdByUid: 'luke' }), ALLOW)).toBe(true);
  });
  it('anything else is a normal, billable campaign', () => {
    expect(realRule.isTestCampaign(own({ testCampaign: undefined }), ALLOW)).toBe(false);
    expect(realRule.isTestCampaign(own({ testCampaign: false }), ALLOW)).toBe(false);
    expect(realRule.isTestCampaign(own({ testCampaign: 'true' }), ALLOW)).toBe(false); // strictly boolean true
    expect(realRule.isTestCampaign({ userId: 'jo', testCampaign: true }, ALLOW)).toBe(false); // any other agent
    expect(realRule.isTestCampaign({ uid: 'luke', userId: 'jo', testCampaign: true }, ALLOW)).toBe(false); // billed owner is jo
    expect(realRule.isTestCampaign({ userId: 'jo', createdByUid: 'luke', managedCreation: true, testCampaign: true }, ALLOW)).toBe(false); // Luke for a selling agent
    expect(realRule.isTestCampaign(own({ managedCreation: true }), ALLOW)).toBe(false);
    expect(realRule.isTestCampaign(own({ createdByUid: 'hannah' }), ALLOW)).toBe(false); // uploaded by someone else
    expect(realRule.isTestCampaign(own({ agentId: 'roster1' }), ALLOW)).toBe(false); // own account, for a roster selling agent
    expect(realRule.isTestCampaign(null, ALLOW)).toBe(false);
    expect(realRule.canCreateTestCampaign('', ALLOW)).toBe(false);
    expect(realRule.canCreateTestCampaign(undefined, ALLOW)).toBe(false);
  });
  it('the shipped allowlist is frozen and holds at most one named test account (never an office-wide exemption)', () => {
    expect(Object.isFrozen(realRule.TEST_CAMPAIGN_ACCOUNT_UIDS)).toBe(true);
    expect(realRule.TEST_CAMPAIGN_ACCOUNT_UIDS.length).toBeLessThanOrEqual(1);
    for (const uid of realRule.TEST_CAMPAIGN_ACCOUNT_UIDS) expect(uid).toMatch(/^[A-Za-z0-9]{20,128}$/); // a Firebase uid, not an email
    // With the shipped list, an account that is not on it is never exempt, whatever it stores.
    expect(realRule.isTestCampaign({ userId: 'not-on-the-list', testCampaign: true })).toBe(false);
  });
});

// ── Billing, end to end through billingService with an in-memory Firestore ──
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));
vi.mock('../../src/app/utils/testCampaign', async (importOriginal) => {
  const m = await importOriginal();
  return { ...m, isTestCampaign: (p) => m.isTestCampaign(p, ['luke']), canCreateTestCampaign: (u) => m.canCreateTestCampaign(u, ['luke']) };
});

let store;
function ref(col, id) {
  return {
    id, _col: col,
    get: async () => ({ exists: store[col]?.[id] !== undefined, id, data: () => store[col]?.[id] }),
    set: async (d) => { (store[col] ||= {})[id] = { ...d }; },
    create: async (d) => { if (store[col]?.[id]) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; } (store[col] ||= {})[id] = { ...d }; },
    update: async (p) => { store[col][id] = { ...store[col][id], ...p }; },
  };
}
let auto = 0;
const fakeDb = {
  collection: (col) => ({
    doc: (id) => ref(col, id || `auto${++auto}`),
    get: async () => ({ docs: Object.entries(store[col] || {}).map(([id, d]) => ({ id, data: () => d })) }),
    where: (f, op, v) => ({ get: async () => ({ docs: Object.entries(store[col] || {}).filter(([, d]) => d[f] === v).map(([id, d]) => ({ id, data: () => d })) }) }),
  }),
  runTransaction: async (fn) => { const w = []; await fn({ set: (r, d) => w.push(() => { (store[r._col] ||= {})[r.id] = { ...d }; }) }); w.forEach((x) => x()); },
};
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => fakeDb[p] }) }));

const ACTIVATED = new Date('2026-10-21T00:00:00Z');
beforeEach(() => {
  store = {
    settings: { invoicing: { pricePerListing: 200, gstRate: 0, excludeAgentIds: [], billingActivatedAt: ACTIVATED } },
    officeAdminInfo: { hph: { name: 'Harcourts Property Hub', status: 'active', officeAdminUids: ['hannah'] } },
    users: {
      luke: { firstName: 'Luke', lastName: 'W', email: 'luke@example.com', agent: true, officeId: 'hph' },
      jo: { firstName: 'Jo', lastName: 'Lee', email: 'jo@example.com', agent: true, officeId: 'hph' },
      hannah: { firstName: 'Hannah', lastName: 'A', email: 'h@example.com', agent: true, officeId: 'hph' },
    },
  };
});
const now = () => new Date();
const charge = (id) => store.propertyCharges?.[id];
const audits = () => Object.values(store.officeCampaignAudit || {});

describe('billing: test campaigns are never charged; every other campaign is billed exactly as before', () => {
  it("Luke's own TEST campaign: no charge, no billable event, one audit entry with the reason", async () => {
    const { recordPropertyCharge } = await import('../../src/app/api/services/billingService.js');
    const r = await recordPropertyCharge({ id: 'p1', ...own(), address: '1 Test St', createdAt: now() });
    expect(r).toEqual({ created: false, reason: 'test-campaign' });
    expect(store.propertyCharges).toBeUndefined();
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ action: 'campaign.testCampaignBillingExempt', propertyId: 'p1', ownerUid: 'luke', officeId: 'hph' });
    expect(audits()[0].reason).toMatch(/no charge recorded/);
  });

  it('retries and the hourly / pre-invoice sweeps never charge it either, and audit it only once', async () => {
    const { recordPropertyCharge, reconcileMissingCharges } = await import('../../src/app/api/services/billingService.js');
    store.properties = { p1: { ...own(), address: '1 Test St', createdAt: now() } };
    await recordPropertyCharge({ id: 'p1', ...store.properties.p1 });
    await recordPropertyCharge({ id: 'p1', ...store.properties.p1 }); // client retry
    await reconcileMissingCharges(); // hourly cron + before every invoice run
    await reconcileMissingCharges();
    expect(store.propertyCharges).toBeUndefined();
    expect(audits()).toHaveLength(1);
  });

  it("Luke's NORMAL campaign (not ticked) is billed at $200 to the office, as before", async () => {
    const { recordPropertyCharge } = await import('../../src/app/api/services/billingService.js');
    const r = await recordPropertyCharge({ id: 'p2', userId: 'luke', address: '2 Real St', createdAt: now() });
    expect(r.created).toBe(true);
    expect(charge('p2')).toMatchObject({ status: 'pending', totalInc: 200, billingEntityKey: 'office:hph', agentUserId: 'luke' });
    expect(audits()).toHaveLength(0);
  });

  it('a campaign Luke creates for a selling agent is billed at $200, even if it somehow carries the test flag', async () => {
    const { recordPropertyCharge } = await import('../../src/app/api/services/billingService.js');
    const r = await recordPropertyCharge({ id: 'p3', userId: 'jo', createdByUid: 'luke', createdByRole: 'officeAdmin', managedCreation: true, testCampaign: true, address: '3 Agent St', createdAt: now() });
    expect(r.created).toBe(true);
    expect(charge('p3')).toMatchObject({ totalInc: 200, billingEntityKey: 'office:hph', agentUserId: 'jo' });
  });

  it("Luke's own-account upload for a roster selling agent is billed, even if ticked", async () => {
    const { recordPropertyCharge } = await import('../../src/app/api/services/billingService.js');
    expect((await recordPropertyCharge({ id: 'p4', ...own({ agentId: 'roster1' }), createdAt: now() })).created).toBe(true);
  });

  it('other agents, BSOs and office admins stay billable even if their campaign stores testCampaign: true', async () => {
    const { recordPropertyCharge } = await import('../../src/app/api/services/billingService.js');
    expect((await recordPropertyCharge({ id: 'p5', userId: 'jo', testCampaign: true, createdAt: now() })).created).toBe(true);
    expect((await recordPropertyCharge({ id: 'p6', userId: 'hannah', testCampaign: true, createdAt: now() })).created).toBe(true);
    expect(charge('p5').totalInc).toBe(200);
    expect(charge('p6').totalInc).toBe(200);
  });

  it('a sweep over a mixed office charges every campaign except the test one', async () => {
    const { reconcileMissingCharges } = await import('../../src/app/api/services/billingService.js');
    store.properties = {
      t1: { ...own(), createdAt: now() },
      n1: { userId: 'luke', createdAt: now() },
      a1: { userId: 'jo', createdAt: now() },
      a2: { userId: 'jo', testCampaign: true, createdAt: now() },
      m1: { userId: 'jo', createdByUid: 'luke', managedCreation: true, testCampaign: true, createdAt: now() },
    };
    const r = await reconcileMissingCharges();
    expect(r).toEqual({ created: 4, skipped: 1 });
    expect(Object.keys(store.propertyCharges).sort()).toEqual(['a1', 'a2', 'm1', 'n1']);
  });

  it('existing charges are never altered or reversed, even if a campaign is later flagged', async () => {
    const { recordPropertyCharge } = await import('../../src/app/api/services/billingService.js');
    await recordPropertyCharge({ id: 'p7', userId: 'luke', createdAt: now() });
    const before = { ...charge('p7') };
    const r = await recordPropertyCharge({ id: 'p7', ...own(), createdAt: now() });
    expect(r.reason).toBe('already-recorded');
    expect(charge('p7')).toEqual(before);
    expect(audits()).toHaveLength(0);
  });

  it('the server-side create-and-charge path (imports) honours the same rule', async () => {
    const { createPropertyAndChargeAtomically } = await import('../../src/app/api/services/billingService.js');
    const t = await createPropertyAndChargeAtomically({ ...own(), address: '8 Test St' });
    expect(t.charged).toBe(false);
    expect(store.properties[t.propertyId].testCampaign).toBe(true);
    expect(audits()).toHaveLength(1);
    const n = await createPropertyAndChargeAtomically({ userId: 'luke', address: '9 Real St' });
    expect(n.charged).toBe(true);
    expect(charge(n.propertyId).totalInc).toBe(200);
  });

  it('pricing and billing configuration are untouched', async () => {
    const svc = await import('../../src/app/api/services/billingService.js');
    expect(svc.DEFAULT_PRICE_PER_LISTING).toBe(200);
    expect(store.settings.invoicing).toEqual({ pricePerListing: 200, gstRate: 0, excludeAgentIds: [], billingActivatedAt: ACTIVATED });
  });
});

describe('labels, reporting and the upload option', () => {
  const read = (p) => readFileSync(p, 'utf8');
  it('Leadership and Team Dashboards leave test campaigns out; Office > Campaigns and the owner dashboard label them', () => {
    expect(read('src/app/api/services/leadershipService.js')).toContain('.filter((p) => !isTestCampaign(p))');
    expect(read('src/app/api/services/teamService.js')).toContain("d.data().hidden !== true && !isTestCampaign(d.data())");
    expect(read('src/app/api/services/managedCampaignService.js')).toContain('testCampaign: isTestCampaign(p),');
    expect(read('src/app/dashboard/office/campaigns/page.js')).toContain('{c.testCampaign && <span');
    expect(read('src/app/dashboard/page.js')).toContain('{isTestCampaign(property) && (');
  });
  it('the upload page offers the option only to the authorised account, only for its own campaign, before submission', () => {
    const add = read('src/app/dashboard/add/page.js');
    expect(add).toContain('const testCampaignEligible = canCreateTestCampaign(user?.uid) && !ownerUid && !selectedAgentId;');
    expect(add).toContain('{testCampaignEligible && (');
    expect(add).toContain('...(testCampaign && testCampaignEligible ? { testCampaign: true, testCampaignMarkedAt: serverTimestamp() } : {}),');
    // The managed (for a selling agent) payload never carries it.
    const managed = add.slice(add.indexOf('if (ownerUid) {'), add.indexOf('// Separate pre-existing URLs'));
    expect(managed).not.toContain('testCampaign');
    // The $200 pricing disclosure and terms checkbox are still shown on the same step.
    expect(add).toContain('I have read and agree to the terms and conditions');
    expect(add).toContain("retail.state === 'none' && (");
  });
});
