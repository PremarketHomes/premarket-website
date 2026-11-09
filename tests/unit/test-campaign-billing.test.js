import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// The real allowlist module (everything else in this file sees a copy whose allowlist is ['luke']).
const realRule = await vi.importActual('../../src/app/api/services/testCampaigns');

// ── In-memory Firestore: docs, where ('==' / 'in'), add, atomic batch.create, transactions ──
let store;
const exists = (c, id) => store[c]?.[id] !== undefined;
function alreadyExists() { const e = new Error('ALREADY_EXISTS'); e.code = 6; return e; }
function ref(c, id) {
  return {
    id, _c: c,
    get: async () => ({ exists: exists(c, id), id, data: () => store[c]?.[id] }),
    set: async (d) => { (store[c] ||= {})[id] = { ...d }; },
    create: async (d) => { if (exists(c, id)) throw alreadyExists(); (store[c] ||= {})[id] = { ...d }; },
    update: async (p) => { store[c][id] = { ...store[c][id], ...p }; },
    delete: async () => { delete store[c]?.[id]; },
  };
}
let auto = 0;
function col(c, filters = []) {
  const docs = () => Object.entries(store[c] || {})
    .filter(([, d]) => filters.every(([f, op, v]) => (op === 'in' ? v.includes(d[f]) : op === '==' ? d[f] === v : true)))
    .map(([id, d]) => ({ id, ref: ref(c, id), data: () => d }));
  return {
    doc: (id) => ref(c, id || `auto${++auto}`),
    add: async (d) => { const id = `auto${++auto}`; (store[c] ||= {})[id] = { ...d }; return { id }; },
    where: (f, op, v) => col(c, [...filters, [f, op, v]]),
    get: async () => { const ds = docs(); return { docs: ds, empty: ds.length === 0, size: ds.length }; },
  };
}
const fakeDb = {
  collection: (c) => col(c),
  batch: () => {
    const ops = [];
    return {
      create: (r, d) => ops.push({ r, d }),
      commit: async () => { if (ops.some(({ r }) => exists(r._c, r.id))) throw alreadyExists(); ops.forEach(({ r, d }) => { (store[r._c] ||= {})[r.id] = { ...d }; }); },
    };
  },
  runTransaction: async (fn) => {
    const w = [];
    const out = await fn({
      get: (r) => r.get(),
      set: (r, d) => w.push(() => { (store[r._c] ||= {})[r.id] = { ...d }; }),
      update: (r, p) => w.push(() => { store[r._c][r.id] = { ...store[r._c][r.id], ...p }; }),
    });
    w.forEach((x) => x());
    return out;
  },
};
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => fakeDb[p] }) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUser: async (uid) => ({ uid, disabled: false }) }) }));
const sendEmail = vi.fn(async () => ({ id: 'email' }));
vi.mock('../../src/app/api/services/resendService', () => ({ sendEmail: (...a) => sendEmail(...a), sendPropertyReadyEmail: vi.fn() }));
vi.mock('../../src/app/api/services/testCampaigns', async (importOriginal) => {
  const m = await importOriginal();
  return { ...m, canCreateTestCampaign: (u) => m.canCreateTestCampaign(u, ['luke']) };
});

const { createManagedProperty, resendCampaignLink, listOfficeCampaigns, listBsoCampaigns, listAssignableAgents, reassignManager } =
  await import('../../src/app/api/services/managedCampaignService');
const billing = await import('../../src/app/api/services/billingService');
const { loadTestCampaignIds, isTestCampaignId } = await import('../../src/app/api/services/testCampaigns');

const ACTIVATED = new Date('2026-10-21T00:00:00Z');
const agent = (first, extra = {}) => ({ firstName: first, lastName: 'X', email: `${first.toLowerCase()}@hph.example`, agent: true, officeId: 'hph', accountStatus: 'active', ...extra });
beforeEach(() => {
  sendEmail.mockClear();
  store = {
    settings: { invoicing: { pricePerListing: 200, gstRate: 0, excludeAgentIds: [], billingActivatedAt: ACTIVATED } },
    officeAdminInfo: { hph: { name: 'Harcourts Property Hub', status: 'active', officeAdminUids: ['hannah'], bsoUids: ['luke', 'peta'] } },
    users: { luke: agent('Luke'), peta: agent('Peta'), hannah: agent('Hannah'), phil: agent('Phil'), jo: agent('Jo') },
  };
});
const input = (address) => ({ address: 'Robina QLD Australia', formattedAddress: address, price: '$950,000', bedrooms: 3, bathrooms: 2, carSpaces: 2, propertyType: 'House', listingStatus: 'pre-market', title: address, location: { latitude: -28, longitude: 153 }, imageUrls: [] });
let n = 0;
const create = (actorUid, ownerUid, extra = {}) => createManagedProperty(fakeDb, {
  actorUid, ownerUid, requestId: `req-${String(++n).padStart(16, '0')}`, input: input(`${n} Test St`), acceptTerms: true, managerUid: null, ...extra,
});
const charge = (id) => store.propertyCharges?.[id];
const audits = (id) => Object.values(store.officeCampaignAudit || {}).filter((a) => a.propertyId === id);
const campaignLinkEmails = () => sendEmail.mock.calls.filter(([a]) => /campaign/i.test(JSON.stringify(a)));

describe('the allowlist', () => {
  it('only the listed creator uid may create test campaigns', () => {
    expect(realRule.canCreateTestCampaign('luke', ['luke'])).toBe(true);
    for (const u of ['peta', 'hannah', '', undefined, null]) expect(realRule.canCreateTestCampaign(u, ['luke'])).toBe(false);
  });
  it('ships frozen with at most one Firebase uid (never office-wide, never an email)', () => {
    expect(Object.isFrozen(realRule.TEST_CAMPAIGN_CREATOR_UIDS)).toBe(true);
    expect(realRule.TEST_CAMPAIGN_CREATOR_UIDS.length).toBeLessThanOrEqual(1);
    for (const uid of realRule.TEST_CAMPAIGN_CREATOR_UIDS) expect(uid).toMatch(/^[A-Za-z0-9]{20,128}$/);
  });
  it('the allowlist stays server-side: no client page imports it', () => {
    for (const p of ['src/app/dashboard/add/page.js', 'src/app/dashboard/page.js', 'src/app/dashboard/components/BsoCampaigns.js', 'src/app/dashboard/office/campaigns/page.js']) {
      expect(readFileSync(p, 'utf8')).not.toMatch(/testCampaigns|TEST_CAMPAIGN_CREATOR_UIDS/);
    }
  });
});

describe('creating a test campaign for a real selling agent (Luke as BSO, Phil as selling agent)', () => {
  it('Phil owns it; NO pending charge — only a server-side EXCLUDED record with reason and approver; audited', async () => {
    const r = await create('luke', 'phil', { testCampaign: true });
    expect(r).toMatchObject({ duplicate: false, role: 'bso', testCampaign: true, charge: 'test-campaign', notification: 'sent' });
    const p = store.properties[r.propertyId];
    expect(p).toMatchObject({ userId: 'phil', managedByUid: 'luke', createdByUid: 'luke', testCampaign: true, testCampaignBy: 'luke' });
    expect(charge(r.propertyId)).toMatchObject({
      status: 'excluded', testCampaign: true, testCampaignApprovedBy: 'luke', agentUserId: 'phil', billingEntityKey: 'office:hph',
      adjustment: { action: 'excluded', adminUid: 'luke' },
    });
    expect(charge(r.propertyId).adjustment.reason).toMatch(/Test campaign/);
    expect(Object.values(store.propertyCharges).filter((c) => c.status === 'pending')).toHaveLength(0);
    expect(audits(r.propertyId).map((a) => a.action).sort()).toEqual(['campaign.create', 'campaign.testCampaignBillingExempt']);
    expect(audits(r.propertyId).find((a) => a.action === 'campaign.create').testCampaign).toBe(true);
  });

  it('apart from billing it is a normal campaign: Phil gets the campaign-link email and notification, and resend works', async () => {
    const r = await create('luke', 'phil', { testCampaign: true });
    const toPhil = () => sendEmail.mock.calls.filter(([a]) => JSON.stringify(a.to) .includes('phil@hph.example'));
    expect(toPhil()).toHaveLength(1);
    expect(Object.values(store.notifications || {}).filter((x) => x.type === 'newProspect' && x.property.userId === 'phil')).toHaveLength(1);
    const resend = await resendCampaignLink(fakeDb, { actorUid: 'luke', propertyId: r.propertyId });
    expect(resend).toMatchObject({ sent: true });
    expect(toPhil()).toHaveLength(2);
    expect(charge(r.propertyId).status).toBe('excluded'); // still not billed
  });

  it('works for any HPH selling agent', async () => {
    for (const owner of ['phil', 'jo', 'hannah']) {
      const r = await create('luke', owner, { testCampaign: true });
      expect(charge(r.propertyId)).toMatchObject({ status: 'excluded', agentUserId: owner });
    }
  });

  it('a double submit / retry returns the same campaign and still has exactly one excluded record', async () => {
    const args = { actorUid: 'luke', ownerUid: 'phil', requestId: 'req-retry-000000000001', input: input('1 Retry St'), acceptTerms: true, managerUid: null, testCampaign: true };
    const a = await createManagedProperty(fakeDb, args);
    const b = await createManagedProperty(fakeDb, args);
    expect(b).toEqual({ propertyId: a.propertyId, duplicate: true });
    expect(Object.keys(store.propertyCharges)).toEqual([a.propertyId]);
  });
});

describe('everything else stays billable', () => {
  it("Luke's NORMAL campaign for Phil: $200 pending charge on the office, Phil emailed, as before", async () => {
    const r = await create('luke', 'phil');
    expect(r.testCampaign).toBe(false);
    expect(charge(r.propertyId)).toMatchObject({ status: 'pending', totalInc: 200, billingEntityKey: 'office:hph', agentUserId: 'phil' });
    expect(charge(r.propertyId).testCampaign).toBeUndefined();
    expect(store.properties[r.propertyId].testCampaign).toBeUndefined();
    expect(campaignLinkEmails().length).toBe(1);
  });

  it('another BSO (Peta) or an office admin asking for a test campaign is refused; nothing is created or charged', async () => {
    await expect(create('peta', 'phil', { testCampaign: true })).rejects.toMatchObject({ status: 403 });
    await expect(create('hannah', 'phil', { testCampaign: true })).rejects.toMatchObject({ status: 403 });
    expect(store.properties).toBeUndefined();
    expect(store.propertyCharges).toBeUndefined();
  });

  it('only a strict boolean true counts; any other value is rejected', async () => {
    await expect(create('luke', 'phil', { testCampaign: 'true' })).rejects.toThrow(/Invalid test campaign/);
    await expect(create('luke', 'phil', { testCampaign: 1 })).rejects.toThrow(/Invalid test campaign/);
    const r = await create('luke', 'phil', { testCampaign: false });
    expect(charge(r.propertyId).status).toBe('pending');
  });

  it('nobody can bypass billing by editing campaign fields: a forged normal campaign is still charged by the sweep', async () => {
    // Phil's normal campaign whose charge never got recorded (e.g. a failed call)...
    store.properties = { forged: { userId: 'phil', createdAt: new Date(), managedCreation: true, createdByUid: 'luke', managedByUid: 'luke', testCampaign: true, testCampaignBy: 'luke' } };
    const swept = await billing.reconcileMissingCharges(); // hourly cron and before every invoice run
    expect(swept.created).toBe(1);
    expect(charge('forged')).toMatchObject({ status: 'pending', totalInc: 200 });
    expect(await isTestCampaignId(fakeDb, 'forged')).toBe(false);
    expect((await loadTestCampaignIds(fakeDb)).has('forged')).toBe(false);
  });
});

describe('an approved test campaign can never become a charge later', () => {
  it('retries, the hourly / pre-invoice sweeps and office join/leave settlement add nothing', async () => {
    const r = await create('luke', 'phil', { testCampaign: true });
    const before = { ...charge(r.propertyId) };
    await billing.recordPropertyCharge({ id: r.propertyId, ...store.properties[r.propertyId] });
    await billing.reconcileMissingCharges();
    await billing.settleChargesForAgent('phil');
    expect(charge(r.propertyId)).toEqual(before);
    expect(Object.keys(store.propertyCharges)).toEqual([r.propertyId]);
  });

  it('reassigning the selling agent or the managing BSO, or removing the display flag, adds no charge', async () => {
    const r = await create('luke', 'phil', { testCampaign: true });
    await reassignManager(fakeDb, { actorUid: 'hannah', propertyId: r.propertyId, managerUid: 'peta' });
    store.properties[r.propertyId] = { ...store.properties[r.propertyId], userId: 'jo', testCampaign: false, testCampaignBy: null }; // new selling agent, flag stripped
    await billing.reconcileMissingCharges();
    await billing.settleChargesForAgent('jo');
    expect(store.properties[r.propertyId].managedByUid).toBe('peta');
    expect(charge(r.propertyId)).toMatchObject({ status: 'excluded', testCampaign: true });
    expect(Object.values(store.propertyCharges).filter((c) => c.status === 'pending')).toHaveLength(0);
  });

  it('invoice runs and the daily dry run only ever select pending charges', () => {
    expect(readFileSync('src/app/api/services/invoiceRunService.js', 'utf8')).toContain(".collection('propertyCharges').where('status', '==', 'pending')");
    expect(readFileSync('src/app/api/cron/invoice-dry-run/route.js', 'utf8')).toContain(".collection('propertyCharges').where('status', '==', 'pending')");
  });

  it('existing charges, pricing and billing settings are untouched', async () => {
    store.propertyCharges = { old: { status: 'invoiced', totalInc: 200, agentUserId: 'phil' } };
    await create('luke', 'phil', { testCampaign: true });
    expect(store.propertyCharges.old).toEqual({ status: 'invoiced', totalInc: 200, agentUserId: 'phil' });
    expect(billing.DEFAULT_PRICE_PER_LISTING).toBe(200);
    expect(store.settings.invoicing).toEqual({ pricePerListing: 200, gstRate: 0, excludeAgentIds: [], billingActivatedAt: ACTIVATED });
  });
});

describe('labels, reporting and emails read the server-only record', () => {
  it('Office > Campaigns and My Campaigns label the test campaign, not the normal one (or a forged flag)', async () => {
    const t = await create('luke', 'phil', { testCampaign: true });
    const normal = await create('luke', 'phil');
    store.properties[normal.propertyId].testCampaign = true; // forged display flag: ignored
    const office = await listOfficeCampaigns(fakeDb, 'hph');
    const bso = await listBsoCampaigns(fakeDb, 'luke');
    for (const list of [office.campaigns, bso.campaigns]) {
      expect(list.find((c) => c.id === t.propertyId).testCampaign).toBe(true);
      expect(list.find((c) => c.id === normal.propertyId).testCampaign).toBe(false);
    }
  });

  it('the agents list tells only the allowlisted creator that the option is available', async () => {
    expect((await listAssignableAgents(fakeDb, 'luke')).testCampaignAllowed).toBe(true);
    expect((await listAssignableAgents(fakeDb, 'peta')).testCampaignAllowed).toBe(false);
    expect((await listAssignableAgents(fakeDb, 'hannah')).testCampaignAllowed).toBe(false);
  });

  it('Leadership and Team Dashboards leave test campaigns out', () => {
    const read = (p) => readFileSync(p, 'utf8');
    expect(read('src/app/api/services/leadershipService.js')).toContain('.filter((p) => !testIds.has(p.id))');
    expect(read('src/app/api/services/teamService.js')).toContain("d.data().hidden !== true && !testIds.has(d.id)");
  });

  it('email and notification paths have no test-campaign special case (campaign link, buyer interest, follow-ups)', () => {
    const read = (p) => readFileSync(p, 'utf8');
    for (const p of ['src/app/api/services/agentNotificationService.js', 'src/app/api/offers/notify-interest/route.js', 'src/app/api/cron/property-followup/route.js', 'src/app/api/services/notificationService.js']) {
      expect(read(p)).not.toMatch(/testCampaign|isTestCampaignId|loadTestCampaignIds/);
    }
  });

  it('the upload page offers the option only when the server allows it, only for a selling agent, before submission', () => {
    const add = readFileSync('src/app/dashboard/add/page.js', 'utf8');
    expect(add).toContain('const testCampaignOffered = assignable.testCampaignAllowed === true && !!ownerUid;');
    expect(add).toContain('{testCampaignOffered && (');
    expect(add).toContain('...(testCampaign && testCampaignOffered ? { testCampaign: true } : {}),');
    // The agent's own (client-side) upload never carries it.
    const own = add.slice(add.indexOf('// Save property metadata immediately'), add.indexOf('const docRef = await addDoc'));
    expect(own).not.toContain('testCampaign');
    expect(readFileSync('src/app/api/properties/managed/route.js', 'utf8')).toContain('testCampaign: body.testCampaign ?? null');
  });
});
