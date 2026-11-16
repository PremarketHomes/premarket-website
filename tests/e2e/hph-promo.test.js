/**
 * HPHNOVEMBER promotion: END-TO-END against the local Firestore EMULATOR (real transactions and real contention).
 * Runs the real services, route handlers and billing code. Only the signed-in user (verifyAuth) and the campaign-link
 * email are faked. Refuses to run unless FIRESTORE_EMULATOR_HOST points at localhost, so it can never touch production.
 *
 *   npx firebase emulators:exec --only firestore --project demo-premarket-promo 'npx vitest run tests/e2e/hph-promo.test.js'
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FS = process.env.FIRESTORE_EMULATOR_HOST;
process.env.MANAGED_CAMPAIGNS_ENABLED = '1'; // the office-admin / BSO create route is switched on in production
const ON = Boolean(FS && /^(localhost|127\.0\.0\.1)/.test(FS) && !process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.FIREBASE_PROJECT_ID);

vi.mock('../../src/app/api/middleware/auth', () => ({
  verifyAuth: async (req) => {
    const uid = req.headers.get('x-test-uid');
    return uid ? { authenticated: true, uid } : { authenticated: false, error: 'Missing or invalid Authorization header', status: 401 };
  },
}));
const emails = [];
vi.mock('../../src/app/api/services/agentNotificationService', () => ({
  sendCampaignLinkOnce: async ({ propertyId, recipientUid }) => { emails.push({ propertyId, recipientUid }); return { reason: 'sent' }; },
}));

const { adminDb: db } = await import('../../src/app/firebase/adminApp');
const { createManagedProperty } = await import('../../src/app/api/services/managedCampaignService');
const { createOwnPromoProperty } = await import('../../src/app/api/services/promoCampaignService');
const { HPH_OFFICE_ID, PROMOTIONS, PROMO_MESSAGES } = await import('../../src/app/api/services/promotions');
const { recordPropertyCharge, reconcileMissingCharges } = await import('../../src/app/api/services/billingService');
const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService');
const { POST: checkRoute } = await import('../../src/app/api/promo/check/route');
const { POST: promoCreateRoute } = await import('../../src/app/api/properties/promo-create/route');
const { POST: managedRoute } = await import('../../src/app/api/properties/managed/route');

const { getApps } = await import('firebase-admin/app');
const PROJECT = getApps()[0]?.options?.projectId || 'premarket-homes'; // adminApp's project id, served by the EMULATOR here
const OTHER = 'otherOffice';
const { TEST_CAMPAIGN_CREATOR_UIDS } = await import('../../src/app/api/services/testCampaigns');
const TESTER = TEST_CAMPAIGN_CREATOR_UIDS[0]; // the one account allowed to tick "Test campaign"
const promo = PROMOTIONS.HPHNOVEMBER;
let seq = 0;
const rid = () => `req-${Date.now().toString(36)}-${(++seq).toString(36).padStart(8, '0')}`;
const input = (n = 1) => ({ address: `${n} Test Street, Hope Island QLD`, formattedAddress: `${n} Test Street, Hope Island QLD 4212, Australia`, price: '1250000', bedrooms: 4, bathrooms: 2, carSpaces: 2, propertyType: 1, imageUrls: ['https://premarketvideos.b-cdn.net/a.jpg'], title: `Campaign ${n}` });
const managed = (actorUid, ownerUid, extra = {}) => createManagedProperty(db, { actorUid, ownerUid, requestId: rid(), input: input(++seq), acceptTerms: true, managerUid: null, testCampaign: null, promoCode: 'HPHNOVEMBER', ...extra });
const own = (uid, extra = {}) => createOwnPromoProperty(db, { uid, requestId: rid(), input: input(++seq), acceptTerms: true, agentId: null, pendingPhotos: 0, promoCode: 'HPHNOVEMBER', ...extra });
const statusOf = async (p) => p.then((r) => (r.duplicate ? 'duplicate' : 'created'), (e) => e.code || e.reason || e.message);
const all = async (c, f = (q) => q) => (await f(db.collection(c)).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const req = (uid, body) => new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json', ...(uid ? { 'x-test-uid': uid } : {}) }, body: JSON.stringify(body) });

async function clear() {
  const r = await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!r.ok) throw new Error('could not clear emulator');
}
const agent = (uid, officeId = HPH_OFFICE_ID, extra = {}) => db.collection('users').doc(uid).set({ firstName: uid[0].toUpperCase() + uid.slice(1), lastName: 'Agent', email: `${uid}@hph.test`, agent: true, roles: ['agent'], officeId, accountStatus: 'active', ...extra });
const AGENTS50 = Array.from({ length: 50 }, (_, i) => `agent${String(i).padStart(2, '0')}`);
async function seed() {
  await db.collection('settings').doc('invoicing').set({ pricePerListing: 200, gstRate: 0, billingActivatedAt: new Date('2026-10-21T01:03:29Z'), excludeAgentIds: [] });
  await db.collection('officeAdminInfo').doc(HPH_OFFICE_ID).set({ name: 'Harcourts Property Hub', status: 'active', officeAdminUids: ['hannahAdmin'], bsoUids: ['hannah', 'bob', TESTER], retailCampaignPrice: 349 });
  await db.collection('billingContacts').doc(`office:${HPH_OFFICE_ID}`).set({ billingEntityKey: `office:${HPH_OFFICE_ID}`, status: 'confirmed', name: 'HPH Accounts', email: 'accounts@hph.test', billingName: 'Harcourts Property Hub' });
  await db.collection('officeAdminInfo').doc(OTHER).set({ name: 'Other Realty', status: 'active', officeAdminUids: ['otherAdmin'], bsoUids: [] });
  await Promise.all(['phil', 'dave', 'trevor', 'zara', 'mia', 'nora', 'hannah', 'bob', 'hannahAdmin', TESTER, ...AGENTS50].map((u) => agent(u)));
  await agent('outsider', OTHER); await agent('otherAdmin', OTHER);
}

describe.skipIf(!ON)('HPHNOVEMBER — one free campaign per assigned HPH selling agent (Firestore emulator)', () => {
  beforeEach(async () => { await clear(); await seed(); emails.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('BSO Hannah: free for Phil, Dave and Trevor; each redemption is the SELLING AGENT\'s, recorded atomically with an excluded charge', async () => {
    for (const a of ['phil', 'dave', 'trevor']) {
      const r = await managed('hannah', a);
      expect(r).toMatchObject({ duplicate: false, promoCode: 'HPHNOVEMBER', charge: 'promo-excluded', role: 'bso' });
      const prop = (await db.collection('properties').doc(r.propertyId).get()).data();
      const charge = (await db.collection('propertyCharges').doc(r.propertyId).get()).data();
      const red = (await db.collection('promoRedemptions').doc(`HPHNOVEMBER_${a}`).get()).data();
      expect(prop.userId).toBe(a);
      expect(charge).toMatchObject({ status: 'excluded', promoCode: 'HPHNOVEMBER', promoRedemptionId: `HPHNOVEMBER_${a}`, agentUserId: a, runId: null });
      expect(charge.testCampaign).toBeUndefined(); // a real campaign: counts in reporting
      expect(red).toMatchObject({ code: 'HPHNOVEMBER', agentUid: a, officeId: HPH_OFFICE_ID, propertyId: r.propertyId, uploadedByUid: 'hannah', uploadedByRole: 'bso', creationPath: 'managed' });
      expect(red.redeemedAt).toBeTruthy();
      // nothing about the promotion is written on the public property document
      expect(JSON.stringify(prop)).not.toMatch(/promo|HPHNOVEMBER/i);
    }
    expect((await db.collection('promoRedemptions').doc('HPHNOVEMBER_hannah').get()).exists).toBe(false); // uploader never consumes her own
    expect(emails.map((e) => e.recipientUid).sort()).toEqual(['dave', 'phil', 'trevor']); // campaign-link emails unchanged
  });

  it('Phil already redeemed: Hannah again, another BSO (Bob), the office admin and Phil himself are all rejected; nothing is created', async () => {
    await managed('hannah', 'phil');
    const before = (await all('properties')).length;
    for (const attempt of [() => managed('hannah', 'phil'), () => managed('bob', 'phil'), () => managed('hannahAdmin', 'phil'), () => own('phil')]) {
      await expect(attempt()).rejects.toMatchObject({ status: 409, message: PROMO_MESSAGES.alreadyRedeemed });
    }
    expect((await all('properties')).length).toBe(before);
    expect((await all('propertyCharges')).length).toBe(before);
    expect((await all('promoRedemptions')).length).toBe(1);
  });

  it('an agent who redeemed their own campaign cannot get a second one through a BSO', async () => {
    const r = await own('nora');
    expect(r).toMatchObject({ duplicate: false, promoCode: 'HPHNOVEMBER' });
    expect((await db.collection('promoRedemptions').doc('HPHNOVEMBER_nora').get()).data()).toMatchObject({ uploadedByUid: 'nora', uploadedByRole: 'agent', creationPath: 'agent-wizard', propertyId: r.propertyId });
    await expect(managed('hannah', 'nora')).rejects.toMatchObject({ status: 409 });
  });

  it('one BSO can redeem for 50 different eligible agents: 50 free campaigns, one each', async () => {
    const res = await Promise.all(AGENTS50.map((a) => statusOf(managed('hannah', a))));
    expect(res.filter((x) => x === 'created')).toHaveLength(50);
    const reds = await all('promoRedemptions');
    expect(reds).toHaveLength(50);
    expect(new Set(reds.map((r) => r.agentUid)).size).toBe(50);
    expect((await all('propertyCharges')).every((c) => c.status === 'excluded')).toBe(true);
  });

  it('CONCURRENCY: 12 simultaneous attempts for one agent (agent tabs + two BSOs + office admin) → exactly one free campaign', async () => {
    const attempts = [
      ...Array.from({ length: 4 }, () => own('zara')),
      ...Array.from({ length: 3 }, () => managed('hannah', 'zara')),
      ...Array.from({ length: 3 }, () => managed('bob', 'zara')),
      ...Array.from({ length: 2 }, () => managed('hannahAdmin', 'zara')),
    ];
    const res = await Promise.all(attempts.map(statusOf));
    expect(res.filter((x) => x === 'created')).toHaveLength(1);
    expect(res.filter((x) => x === 'already-redeemed')).toHaveLength(11);
    expect((await all('properties', (q) => q.where('userId', '==', 'zara'))).length).toBe(1);
    expect((await all('promoRedemptions')).length).toBe(1);
    const charges = await all('propertyCharges');
    expect(charges).toHaveLength(1);
    expect(charges[0].status).toBe('excluded');
  });

  it('RETRIES: the same request sent 6 times at once (double click / network retry) → one campaign, one redemption, no charge', async () => {
    const requestId = rid();
    const res = await Promise.all(Array.from({ length: 6 }, () => statusOf(createManagedProperty(db, { actorUid: 'hannah', ownerUid: 'mia', requestId, input: input(1), acceptTerms: true, managerUid: null, testCampaign: null, promoCode: 'HPHNOVEMBER' }))));
    expect(res.filter((x) => x === 'created')).toHaveLength(1);
    expect(res.filter((x) => x === 'duplicate')).toHaveLength(5);
    expect((await all('properties')).length).toBe(1);
    expect((await all('promoRedemptions')).length).toBe(1);
    expect((await all('propertyCharges')).filter((c) => c.status === 'pending')).toHaveLength(0);
    const ownId = rid();
    const resOwn = await Promise.all(Array.from({ length: 4 }, () => statusOf(createOwnPromoProperty(db, { uid: 'dave', requestId: ownId, input: input(2), acceptTerms: true, agentId: null, pendingPhotos: 3, promoCode: 'HPHNOVEMBER' }))));
    expect(resOwn.filter((x) => x === 'created')).toHaveLength(1);
    expect((await all('properties', (q) => q.where('userId', '==', 'dave'))).length).toBe(1);
  });

  it('BILLING: hourly sweep, record-charge retries and the invoice run never bill a promo campaign; normal campaigns bill exactly as before', async () => {
    const free = await managed('hannah', 'phil');
    const freeOwn = await own('dave');
    const normal = await createManagedProperty(db, { actorUid: 'hannah', ownerUid: 'phil', requestId: rid(), input: input(9), acceptTerms: true, managerUid: null, testCampaign: null });
    expect(normal.charge).toBe('recorded'); // normal pricing unchanged, including for Phil's later campaigns
    for (let i = 0; i < 3; i++) await reconcileMissingCharges(); // hourly sweep
    for (const id of [free.propertyId, freeOwn.propertyId]) {
      expect(await recordPropertyCharge({ id, ...(await db.collection('properties').doc(id).get()).data() })).toMatchObject({ created: false, reason: 'already-recorded' });
      expect((await db.collection('propertyCharges').doc(id).get()).data().status).toBe('excluded');
    }
    expect((await db.collection('propertyCharges').doc(normal.propertyId).get()).data()).toMatchObject({ status: 'pending', totalInc: 200 });
    const pending = await all('propertyCharges', (q) => q.where('status', '==', 'pending'));
    expect(pending.map((c) => c.propertyId)).toEqual([normal.propertyId]);
    const run = await createInvoiceRunFromPendingCharges({ createdBy: 'test' });
    const items = await all('invoiceRunItems');
    const lines = JSON.stringify(items);
    expect(lines).toContain(normal.propertyId);
    expect(lines).not.toContain(free.propertyId);
    expect(lines).not.toContain(freeOwn.propertyId);
    expect(run).toBeTruthy();
  });

  it('EXPIRY: 29 Nov 2026 23:59:59.999 Queensland time works; 30 Nov 00:00 Queensland time is rejected and creates nothing', async () => {
    expect(promo.endsAtMs).toBe(Date.parse('2026-11-29T14:00:00.000Z'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(promo.endsAtMs - 1));
    await expect(managed('hannah', 'phil')).resolves.toMatchObject({ promoCode: 'HPHNOVEMBER' });
    vi.setSystemTime(new Date(promo.endsAtMs));
    await expect(managed('hannah', 'dave')).rejects.toMatchObject({ status: 400, message: PROMO_MESSAGES.expired(promo) });
    await expect(own('trevor')).rejects.toMatchObject({ status: 400 });
    vi.useRealTimers();
    expect((await all('properties')).length).toBe(1);
    expect((await all('promoRedemptions')).length).toBe(1);
  });

  it('ELIGIBILITY: other offices, unknown codes and test campaigns are refused; the code is case-insensitive', async () => {
    await expect(own('outsider')).rejects.toMatchObject({ status: 403, message: PROMO_MESSAGES.notEligible });
    await expect(managed('otherAdmin', 'phil')).rejects.toMatchObject({ status: 404 }); // can't even reach another office's agent
    await expect(managed('hannah', 'phil', { promoCode: 'HPHDECEMBER' })).rejects.toMatchObject({ status: 400, message: PROMO_MESSAGES.invalid });
    await expect(managed('hannah', 'phil', { testCampaign: true })).rejects.toMatchObject({ status: 403 }); // not a test account
    await expect(managed(TESTER, 'phil', { testCampaign: true })).rejects.toMatchObject({ status: 400, message: PROMO_MESSAGES.withTestCampaign });
    await expect(managed('hannah', 'phil', { promoCode: '  hphNovember ' })).resolves.toMatchObject({ promoCode: 'HPHNOVEMBER' });
    expect((await all('promoRedemptions')).map((r) => r.agentUid)).toEqual(['phil']);
  });

  it('ROUTES: Apply checks the selling agent with creation authority; nothing is reserved; promo-create and managed routes enforce the same rules', async () => {
    const ok = await (await checkRoute(req('hannah', { code: 'hphnovember', ownerUid: 'phil' }))).json();
    expect(ok).toMatchObject({ ok: true, code: 'HPHNOVEMBER', message: 'HPHNOVEMBER applied — this agent’s first Premarket campaign is FREE.', agentName: 'Phil Agent' });
    expect((await all('promoRedemptions')).length).toBe(0); // checking reserves nothing
    expect((await checkRoute(req('otherAdmin', { code: 'HPHNOVEMBER', ownerUid: 'phil' }))).status).toBe(404);
    expect((await checkRoute(req(null, { code: 'HPHNOVEMBER' }))).status).toBe(401);
    expect(await (await checkRoute(req('outsider', { code: 'HPHNOVEMBER' }))).json()).toMatchObject({ ok: false, reason: 'not-eligible' });
    expect(await (await checkRoute(req('phil', { code: 'NOPE' }))).json()).toMatchObject({ ok: false, reason: 'invalid' });

    const created = await promoCreateRoute(req('phil', { requestId: rid(), promoCode: 'HPHNOVEMBER', acceptTerms: true, property: input(3), pendingPhotos: 2 }));
    expect(created.status).toBe(201);
    const { propertyId } = await created.json();
    expect((await db.collection('properties').doc(propertyId).get()).data()).toMatchObject({ userId: 'phil', vendorUploaded: true, imageUploadProgress: { uploaded: 0, total: 2, inProgress: true } });
    expect(await (await checkRoute(req('hannah', { code: 'HPHNOVEMBER', ownerUid: 'phil' }))).json()).toMatchObject({ ok: false, reason: 'already-redeemed', message: PROMO_MESSAGES.alreadyRedeemed });
    const again = await managedRoute(req('hannah', { ownerUid: 'phil', requestId: rid(), acceptTerms: true, promoCode: 'HPHNOVEMBER', property: input(4) }));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe(PROMO_MESSAGES.alreadyRedeemed);
  });
});
