import { describe, it, expect, vi, beforeEach } from 'vitest';

// Admin "Apply HPHNOVEMBER" to a pending charge whose agent forgot the code.

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

function makeFakeDb() {
  const store = {};
  let seq = 0;
  const data = (name, id) => store[name]?.[id];
  const ref = (name, id) => ({ _col: name, id });
  function col(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        const docId = id || `auto${++seq}`;
        return { ...ref(name, docId), async get() { const d = data(name, docId); return { exists: !!d, id: docId, data: () => d }; } };
      },
      where(field, op, value) {
        const q = {
          orderBy: () => q, limit: () => q,
          get: async () => ({ docs: Object.entries(store[name]).filter(([, d]) => d[field] === value).map(([i, d]) => ({ id: i, data: () => d })) }),
        };
        return q;
      },
    };
  }
  async function runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async (r) => { const d = data(r._col, r.id); return { exists: !!d, id: r.id, data: () => d }; },
      create: (r, d) => writes.push(() => {
        if (data(r._col, r.id)) throw new Error(`ALREADY_EXISTS ${r._col}/${r.id}`);
        store[r._col] = store[r._col] || {}; store[r._col][r.id] = d;
      }),
      update: (r, patch) => writes.push(() => { store[r._col][r.id] = { ...store[r._col][r.id], ...patch }; }),
    };
    const result = await fn(tx);
    writes.forEach((w) => w()); // all-or-nothing: only applied when the callback didn't throw
    return result;
  }
  return { collection: col, runTransaction, _store: store, _seed: (n, id, d) => { store[n] = store[n] || {}; store[n][id] = d; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => fakeDb[p] }) }));
vi.mock('../../src/app/api/middleware/auth', () => ({ verifyAdmin: async () => ({ authenticated: true, uid: 'admin1' }) }));

const HPH = 'ioxigzf4hcRtowqL4C94';
const ENV = {}; // no staging test office

function seedEligible(over = {}) {
  fakeDb._seed('officeAdminInfo', HPH, { status: 'active', name: 'Harcourts Property Hub' });
  fakeDb._seed('users', 'ellen', { firstName: 'Ellen', lastName: 'Agent', agent: true, officeId: HPH });
  fakeDb._seed('users', 'admin1', { firstName: 'Luke', lastName: 'Admin', superAdmin: true });
  fakeDb._seed('properties', 'p1', {
    userId: 'ellen', address: 'Varsity Lakes', formattedAddress: '2401/65 Varsity Parade, Varsity Lakes QLD, Australia',
    createdAt: { toDate: () => new Date('2026-11-17T02:00:00Z') }, ...over.property,
  });
  fakeDb._seed('propertyCharges', 'p1', {
    propertyId: 'p1', propertyAddress: 'Varsity Lakes', agentUserId: 'ellen', status: 'pending', runId: null,
    billingEntityType: 'office', billingEntityKey: `office:${HPH}`, billingEntityName: 'Harcourts Property Hub', officeId: HPH,
    subtotalEx: 200, gstAmount: 0, totalInc: 200, adjustment: null, createdAt: '2026-11-17T02:00:01Z', ...over.charge,
  });
}

const svc = () => import('../../src/app/api/services/retroPromotion.js');
const refusal = async (p) => { try { await p; return null; } catch (e) { return e.reason; } };

beforeEach(() => { fakeDb = makeFakeDb(); });

describe('applyRetroPromotion', () => {
  it('atomically creates the redemption, moves the SAME charge to excluded (HPHNOVEMBER, $200 waived) and audits who/when', async () => {
    seedEligible();
    const { applyRetroPromotion } = await svc();
    const out = await applyRetroPromotion(fakeDb, { chargeId: 'p1', adminUid: 'admin1', env: ENV });
    expect(out).toEqual({ chargeId: 'p1', promoCode: 'HPHNOVEMBER', redemptionId: 'HPHNOVEMBER_ellen' });

    const charge = fakeDb._store.propertyCharges.p1;
    expect(charge).toMatchObject({
      status: 'excluded', promoCode: 'HPHNOVEMBER', promoRedemptionId: 'HPHNOVEMBER_ellen',
      subtotalEx: 200, gstAmount: 0, totalInc: 200, // amounts untouched
      adjustment: { action: 'excluded', by: 'promotion', retroactive: true, adminUid: 'admin1', at: 'TS' },
    });
    expect(fakeDb._store.promoRedemptions.HPHNOVEMBER_ellen).toMatchObject({
      code: 'HPHNOVEMBER', agentUid: 'ellen', officeId: HPH, propertyId: 'p1', creationPath: 'admin-retroactive',
      retroactive: true, appliedByUid: 'admin1', redeemedAt: 'TS',
    });
    const audits = Object.values(fakeDb._store.officeCampaignAudit);
    expect(audits).toEqual([expect.objectContaining({ action: 'campaign.promoAppliedRetroactively', propertyId: 'p1', actorUid: 'admin1', promoCode: 'HPHNOVEMBER', at: 'TS' })]);
    // nothing deleted
    expect(Object.keys(fakeDb._store.propertyCharges)).toEqual(['p1']);
    expect(fakeDb._store.properties.p1).toBeTruthy();
  });

  it('a second apply (double click / retry) is refused and never creates a duplicate redemption', async () => {
    seedEligible();
    const { applyRetroPromotion } = await svc();
    await applyRetroPromotion(fakeDb, { chargeId: 'p1', adminUid: 'admin1', env: ENV });
    expect(await refusal(applyRetroPromotion(fakeDb, { chargeId: 'p1', adminUid: 'admin1', env: ENV }))).toBe('already-promo');
    expect(Object.keys(fakeDb._store.promoRedemptions)).toEqual(['HPHNOVEMBER_ellen']);
    expect(Object.values(fakeDb._store.officeCampaignAudit)).toHaveLength(1);
  });

  const unchanged = (before) => expect(fakeDb._store.propertyCharges.p1).toEqual(before);

  it.each([
    ['agent already redeemed HPHNOVEMBER', () => fakeDb._seed('promoRedemptions', 'HPHNOVEMBER_ellen', { propertyId: 'other' }), 'already-redeemed'],
    ['charge is in a draft invoice run', () => Object.assign(fakeDb._store.propertyCharges.p1, { status: 'queued', runId: 'run1' }), 'in-draft-run'],
    ['charge already sent to Xero', () => Object.assign(fakeDb._store.propertyCharges.p1, { status: 'invoiced', runId: 'run1' }), 'already-invoiced'],
    ['charge already reversed', () => Object.assign(fakeDb._store.propertyCharges.p1, { status: 'reversed' }), 'already-invoiced'],
    ['charge manually excluded', () => Object.assign(fakeDb._store.propertyCharges.p1, { status: 'excluded' }), 'not-pending'],
    ['test campaign', () => Object.assign(fakeDb._store.propertyCharges.p1, { testCampaign: true }), 'test-campaign'],
    ['not billed to HPH', () => Object.assign(fakeDb._store.propertyCharges.p1, { officeId: 'otherOffice', billingEntityKey: 'office:otherOffice' }), 'not-eligible'],
    ['independent (not an office) charge', () => Object.assign(fakeDb._store.propertyCharges.p1, { billingEntityType: 'independent', officeId: undefined }), 'not-eligible'],
    ['agent no longer in HPH', () => Object.assign(fakeDb._store.users.ellen, { officeId: 'elsewhere' }), 'not-eligible'],
    ['created at/after the 30 Nov cutoff', () => Object.assign(fakeDb._store.properties.p1, { createdAt: new Date('2026-11-29T14:00:00Z') }), 'after-cutoff'],
    ['no creation date on record', () => Object.assign(fakeDb._store.properties.p1, { createdAt: null }), 'no-date'],
    ['assigned to a different roster agent than the owner', () => Object.assign(fakeDb._store.properties.p1, { agentId: 'r1', agentName: 'Someone Else' }), 'assigned-elsewhere'],
    ['charge agent differs from the campaign owner', () => Object.assign(fakeDb._store.propertyCharges.p1, { agentUserId: 'bso1' }), 'agent-mismatch'],
  ])('refuses when %s, changing nothing', async (_, mutate, reason) => {
    seedEligible();
    mutate();
    const before = { ...fakeDb._store.propertyCharges.p1 };
    const { applyRetroPromotion } = await svc();
    expect(await refusal(applyRetroPromotion(fakeDb, { chargeId: 'p1', adminUid: 'admin1', env: ENV }))).toBe(reason);
    unchanged(before);
    expect(fakeDb._store.officeCampaignAudit).toBeUndefined();
  });

  it('allows a roster-assigned listing when the assigned agent is the owner themself', async () => {
    seedEligible({ property: { agentId: 'r1', agentName: 'Ellen  Agent' } });
    const { applyRetroPromotion } = await svc();
    await applyRetroPromotion(fakeDb, { chargeId: 'p1', adminUid: 'admin1', env: ENV });
    expect(fakeDb._store.propertyCharges.p1.status).toBe('excluded');
  });

  it('allows a campaign created just before the cutoff even when applied after it', async () => {
    seedEligible({ property: { createdAt: new Date('2026-11-29T13:59:59Z') } });
    const { applyRetroPromotion } = await svc();
    await applyRetroPromotion(fakeDb, { chargeId: 'p1', adminUid: 'admin1', env: ENV });
    expect(fakeDb._store.propertyCharges.p1.promoCode).toBe('HPHNOVEMBER');
  });
});

describe('admin route + Charges list', () => {
  it('POST apply-promo applies it; a refusal returns the reason and changes nothing', async () => {
    seedEligible();
    const { POST } = await import('../../src/app/api/admin/invoicing/charges/[chargeId]/apply-promo/route.js');
    const call = () => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ code: 'HPHNOVEMBER' }) }), { params: Promise.resolve({ chargeId: 'p1' }) });
    const ok = await call();
    expect(ok.status).toBe(200);
    expect((await ok.json()).success).toBe(true);
    const again = await call();
    expect(again.status).toBe(409);
    expect((await again.json()).reason).toBe('already-promo');
  });

  it('POST apply-promo rejects any other code', async () => {
    seedEligible();
    const { POST } = await import('../../src/app/api/admin/invoicing/charges/[chargeId]/apply-promo/route.js');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ code: 'FREEBIE' }) }), { params: Promise.resolve({ chargeId: 'p1' }) });
    expect(res.status).toBe(400);
    expect(fakeDb._store.propertyCharges.p1.status).toBe('pending');
  });

  it('Pending tab marks eligible HPH charges (read-only); after applying, Excluded shows HPHNOVEMBER with who applied it and when', async () => {
    seedEligible();
    fakeDb._seed('propertyCharges', 'pOther', { propertyId: 'pOther', status: 'pending', billingEntityType: 'independent', totalInc: 200, createdAt: '2026-11-01' });
    const { GET } = await import('../../src/app/api/admin/invoicing/charges/route.js');
    const get = async (s) => (await GET(new Request(`http://x/api/admin/invoicing/charges?status=${s}`))).json();

    // (the fake creates an empty collection object on a read; ignore those, compare real documents)
    const snapshot = () => JSON.stringify(Object.fromEntries(Object.entries(fakeDb._store).filter(([, docs]) => Object.keys(docs).length)));
    const before = snapshot();
    const pending = await get('pending');
    expect(snapshot()).toBe(before);
    expect(pending.charges.find((c) => c.id === 'p1').promoHint).toEqual({ code: 'HPHNOVEMBER', eligible: true });
    expect(pending.charges.find((c) => c.id === 'pOther').promoHint).toBeUndefined();

    const { applyRetroPromotion } = await svc();
    await applyRetroPromotion(fakeDb, { chargeId: 'p1', adminUid: 'admin1' });
    fakeDb._store.propertyCharges.p1.adjustment.at = { toDate: () => new Date('2026-11-18T01:00:00Z') };
    const excluded = await get('excluded');
    expect(excluded.charges[0]).toMatchObject({ id: 'p1', promoCode: 'HPHNOVEMBER', totalInc: 200, promoAppliedBy: 'Luke Admin', promoAppliedAt: '2026-11-18T01:00:00.000Z' });
    expect(excluded.promotions).toEqual([{ code: 'HPHNOVEMBER', count: 1, waivedInc: 200 }]);
  });
});
