import { describe, it, expect, vi, beforeEach } from 'vitest';

// Promotional waivers (HPHNOVEMBER) in Admin → Invoicing → Excluded: labelled, totalled, and never billable.

function makeFakeDb() {
  const store = {};
  function col(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        return { async get() { const data = store[name][id]; return { exists: !!data, id, data: () => data }; } };
      },
      where(field, op, value) {
        const q = {
          orderBy: () => q,
          limit: () => q,
          get: async () => {
            const docs = Object.entries(store[name]).filter(([, d]) => d[field] === value).map(([id, d]) => ({ id, data: () => d }));
            return { docs, empty: docs.length === 0, size: docs.length };
          },
        };
        return q;
      },
    };
  }
  return { collection: col, _store: store, _seed: (n, id, d) => { store[n] = store[n] || {}; store[n][id] = d; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }) }));
vi.mock('../../src/app/api/middleware/auth', () => ({ verifyAdmin: async () => ({ authenticated: true, uid: 'admin1' }) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));
vi.mock('../../src/app/api/services/billingService', () => ({ recordPropertyCharge: vi.fn(async () => ({ created: false })) }));

beforeEach(() => { fakeDb = makeFakeDb(); });

const HPH = { billingEntityType: 'office', billingEntityKey: 'office:hph', billingEntityName: 'Harcourts Property Hub', subtotalEx: 200, gstAmount: 0, totalInc: 200 };

function seedExcluded() {
  fakeDb._seed('users', 'mitch', { firstName: 'Mitch', lastName: 'Harrop' });
  fakeDb._seed('properties', 'pPromo1', { userId: 'mitch', address: 'Robina', formattedAddress: '28 Brighton Crescent, Robina QLD, Australia', createdAt: new Date('2026-11-17T03:00:00Z') });
  fakeDb._seed('propertyCharges', 'pPromo1', {
    ...HPH, propertyId: 'pPromo1', propertyAddress: 'Robina', status: 'excluded', createdAt: '2026-11-17T03:00:00Z',
    promoCode: 'HPHNOVEMBER', promoRedemptionId: 'HPHNOVEMBER_mitch',
    adjustment: { action: 'excluded', reason: 'HPHNOVEMBER promotion…', adminUid: null, by: 'promotion' },
  });
  fakeDb._seed('propertyCharges', 'pPromo2', {
    ...HPH, propertyId: 'pPromo2', propertyAddress: 'Broadbeach', status: 'excluded', createdAt: '2026-11-16T03:00:00Z',
    promoCode: 'HPHNOVEMBER', promoRedemptionId: 'HPHNOVEMBER_phil', adjustment: { action: 'excluded', by: 'promotion' },
  });
  fakeDb._seed('propertyCharges', 'pManual', {
    ...HPH, propertyId: 'pManual', propertyAddress: 'Varsity Lakes', status: 'excluded', createdAt: '2026-11-10T00:00:00Z',
    adjustment: { action: 'excluded', reason: 'Duplicate upload', adminUid: 'admin1' },
  });
  fakeDb._seed('propertyCharges', 'pTest', {
    ...HPH, propertyId: 'pTest', propertyAddress: 'Pimpama', status: 'excluded', createdAt: '2026-11-09T00:00:00Z',
    testCampaign: true, adjustment: { action: 'excluded', reason: 'Test campaign' },
  });
  fakeDb._seed('propertyCharges', 'pPending', { ...HPH, propertyId: 'pPending', propertyAddress: 'Southport', status: 'pending', createdAt: '2026-11-18T00:00:00Z' });
}

const list = async (status) => {
  const { GET } = await import('../../src/app/api/admin/invoicing/charges/route.js');
  return (await GET(new Request(`http://x/api/admin/invoicing/charges?status=${status}`))).json();
};

describe('Excluded tab — promotional waivers', () => {
  it('lists promo waivers with their code, full address, selling agent, date and $200 amount, alongside manual/test exclusions', async () => {
    seedExcluded();
    const { charges } = await list('excluded');
    expect(charges.map((c) => c.id)).toEqual(['pPromo1', 'pPromo2', 'pManual', 'pTest']);
    expect(charges[0]).toMatchObject({
      promoCode: 'HPHNOVEMBER', status: 'excluded', totalInc: 200,
      propertyAddress: '28 Brighton Crescent, Robina QLD, Australia', sellingAgentName: 'Mitch Harrop', submittedAt: '2026-11-17T03:00:00.000Z',
    });
    // manual and test exclusions stay distinguishable: no promo code
    expect(charges.find((c) => c.id === 'pManual').promoCode).toBeUndefined();
    expect(charges.find((c) => c.id === 'pTest')).toMatchObject({ testCampaign: true });
  });

  it('totals promotional campaigns and fees waived per code, excluding manual and test exclusions', async () => {
    seedExcluded();
    const { promotions } = await list('excluded');
    expect(promotions).toEqual([{ code: 'HPHNOVEMBER', count: 2, waivedInc: 400 }]);
  });

  it('only the Excluded tab carries the promotion summary; records are not modified', async () => {
    seedExcluded();
    const before = JSON.stringify(fakeDb._store.propertyCharges);
    expect((await list('pending')).promotions).toEqual([]);
    await list('excluded');
    expect(JSON.stringify(fakeDb._store.propertyCharges)).toBe(before);
  });
});

describe('ad-hoc agency invoice never bills a promotional waiver', () => {
  it('skips a promo (or test) charge even if it were pending, and writes nothing', async () => {
    fakeDb._seed('properties', 'pPromo', { userId: 'mitch' });
    fakeDb._seed('propertyCharges', 'pPromo', { ...HPH, propertyId: 'pPromo', status: 'pending', promoCode: 'HPHNOVEMBER', promoRedemptionId: 'HPHNOVEMBER_mitch' });
    fakeDb._seed('properties', 'pTest', { userId: 'mitch' });
    fakeDb._seed('propertyCharges', 'pTest', { ...HPH, propertyId: 'pTest', status: 'pending', testCampaign: true });
    const before = JSON.stringify(fakeDb._store);
    const { POST } = await import('../../src/app/api/admin/invoicing/agency-invoice/route.js');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ propertyIds: ['pPromo', 'pTest'] }) }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.skipped).toEqual([
      { propertyId: 'pPromo', reason: 'not-billable-waiver' },
      { propertyId: 'pTest', reason: 'not-billable-waiver' },
    ]);
    expect(JSON.stringify(fakeDb._store)).toBe(before);
  });
});
