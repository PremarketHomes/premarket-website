import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeFakeDb() {
  const store = {};
  const reads = [];
  function col(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        return {
          async get() {
            reads.push(`${name}/${id}`);
            const data = store[name][id];
            return { exists: !!data, id, data: () => data };
          },
        };
      },
      where(field, op, value) {
        const q = {
          orderBy: () => q,
          limit: () => q,
          get: async () => ({
            docs: Object.entries(store[name])
              .filter(([, d]) => d[field] === value)
              .map(([id, d]) => ({ id, data: () => d })),
          }),
        };
        return q;
      },
    };
  }
  return { collection: col, _store: store, _reads: reads, _seed: (n, id, d) => { store[n] = store[n] || {}; store[n][id] = d; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));
vi.mock('../../src/app/api/middleware/auth', () => ({
  verifyAdmin: async () => ({ authenticated: true, uid: 'admin1' }),
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));
vi.mock('../../src/app/api/services/billingService', () => ({ releaseCharges: vi.fn() }));
vi.mock('../../src/app/api/services/xeroService', () => ({ sendInvoice: vi.fn() }));

beforeEach(() => { fakeDb = makeFakeDb(); });

// The record shapes the details are read from:
//  - pAssigned: uploaded by a BSO (userId) for a roster-assigned agent (agentId/agentName)
//  - pOwn:      an agent's own listing (no agentId) -> the owner is the selling agent
//  - pBare:     a property record with nothing usable on it
//  - (pGone):   no property record at all
function seedProperties() {
  fakeDb._seed('users', 'bso1', { firstName: 'Betty', lastName: 'Bso' });
  fakeDb._seed('users', 'agentPhil', { firstName: 'Phil', lastName: 'Chillemi' });
  fakeDb._seed('properties', 'pAssigned', {
    userId: 'bso1', agentId: 'roster1', agentName: 'Mitch Harrop',
    address: 'Robina', formattedAddress: '28 Brighton Crescent, Robina QLD, Australia',
    createdAt: { toDate: () => new Date('2026-11-17T03:00:00Z') },
  });
  fakeDb._seed('properties', 'pOwn', {
    userId: 'agentPhil', address: 'Pimpama', formattedAddress: '1 Greenwich Avenue, Pimpama QLD, Australia',
    createdAt: { toDate: () => new Date('2026-11-12T23:30:00Z') }, // 13 Nov in Brisbane
  });
  fakeDb._seed('properties', 'pBare', { userId: 'ghost', address: ' ' });
}

describe('chargeLine formatting', () => {
  it('formats the submission date as "17 Nov 2026" on the Brisbane calendar, and never invents one', async () => {
    const { formatChargeDate } = await import('../../src/app/utils/chargeLine.js');
    expect(formatChargeDate('2026-11-17T03:00:00Z')).toBe('17 Nov 2026');
    expect(formatChargeDate('2026-11-12T23:30:00Z')).toBe('13 Nov 2026');
    expect(formatChargeDate('2026-09-01T00:00:00Z')).toBe('1 Sep 2026');
    expect(formatChargeDate(null)).toBeNull();
    expect(formatChargeDate('not a date')).toBeNull();
  });

  it('builds "address — agent — date", leaving out anything missing', async () => {
    const { chargeLineDescription } = await import('../../src/app/utils/chargeLine.js');
    expect(chargeLineDescription({ address: '28 Brighton Crescent, Robina', sellingAgentName: 'Mitch Harrop', submittedAt: '2026-11-17T03:00:00Z' }))
      .toBe('28 Brighton Crescent, Robina — Mitch Harrop — 17 Nov 2026');
    expect(chargeLineDescription({ address: 'Varsity Lakes', sellingAgentName: null, submittedAt: null })).toBe('Varsity Lakes');
  });
});

describe('withChargeDetails', () => {
  it('reads full address, ASSIGNED selling agent (never the uploader) and submission date from the property record', async () => {
    const { withChargeDetails } = await import('../../src/app/api/services/chargeDetails.js');
    seedProperties();
    const rows = await withChargeDetails([
      { propertyId: 'pAssigned', address: 'Robina', agentName: 'Betty Bso' },
      { propertyId: 'pOwn', address: 'Pimpama' },
      { propertyId: 'pBare', address: 'Varsity Lakes' },
      { propertyId: 'pGone', address: 'Broadbeach' },
    ], 'address');
    expect(rows.map((r) => [r.address, r.sellingAgentName, r.submittedAt])).toEqual([
      ['28 Brighton Crescent, Robina QLD, Australia', 'Mitch Harrop', '2026-11-17T03:00:00.000Z'],
      ['1 Greenwich Avenue, Pimpama QLD, Australia', 'Phil Chillemi', '2026-11-12T23:30:00.000Z'],
      ['Varsity Lakes', null, null],
      ['Broadbeach', null, null],
    ]);
    // the stored agentName is left on the row untouched; display uses sellingAgentName
    expect(rows[0].agentName).toBe('Betty Bso');
  });

  it('falls back to the roster record name for an assigned agent with no denormalised name', async () => {
    const { withChargeDetails } = await import('../../src/app/api/services/chargeDetails.js');
    fakeDb._seed('properties', 'p1', { userId: 'bso1', agentId: 'roster1', agentName: '' });
    fakeDb._seed('agents', 'roster1', { name: 'Mitch Harrop' });
    const [row] = await withChargeDetails([{ propertyId: 'p1', address: 'x' }], 'address');
    expect(row.sellingAgentName).toBe('Mitch Harrop');
  });

  it('looks each record up once, even when several rows share a property or owner', async () => {
    const { withChargeDetails } = await import('../../src/app/api/services/chargeDetails.js');
    seedProperties();
    await withChargeDetails([{ propertyId: 'pOwn' }, { propertyId: 'pOwn' }, { address: 'no id' }], 'address');
    expect(fakeDb._reads.sort()).toEqual(['properties/pOwn', 'users/agentPhil']);
  });
});

describe('GET /api/admin/invoicing/charges', () => {
  const list = async (status) => {
    const { GET } = await import('../../src/app/api/admin/invoicing/charges/route.js');
    const res = await GET(new Request(`http://x/api/admin/invoicing/charges?status=${status}`));
    return (await res.json()).charges;
  };

  for (const status of ['pending', 'excluded', 'reversed']) {
    it(`${status}: full address, selling agent, submission date; newest submission first; amounts/status/records untouched`, async () => {
      seedProperties();
      const charge = (id, addr, agentName, createdAt) => ({
        propertyId: id, propertyAddress: addr, agentName, status, billingEntityName: 'Harcourts Property Hub',
        totalInc: 200, subtotalEx: 200, gstAmount: 0, createdAt,
      });
      fakeDb._seed('propertyCharges', 'pOwn', charge('pOwn', 'Pimpama', 'Phil Chillemi', '2026-11-18T00:00:00Z'));
      fakeDb._seed('propertyCharges', 'pAssigned', charge('pAssigned', 'Robina', 'Betty Bso', '2026-11-17T03:00:01Z'));
      fakeDb._seed('propertyCharges', 'pGone', charge('pGone', 'Broadbeach', 'Someone', '2026-11-01T00:00:00Z'));
      fakeDb._seed('propertyCharges', 'other', { ...charge('pOwn', 'Pimpama', 'x', '2026-11-18T00:00:00Z'), status: 'invoiced' });

      const rows = await list(status);
      expect(rows.map((r) => [r.id, r.propertyAddress, r.sellingAgentName, r.submittedAt])).toEqual([
        ['pAssigned', '28 Brighton Crescent, Robina QLD, Australia', 'Mitch Harrop', '2026-11-17T03:00:00.000Z'],
        ['pOwn', '1 Greenwich Avenue, Pimpama QLD, Australia', 'Phil Chillemi', '2026-11-12T23:30:00.000Z'],
        ['pGone', 'Broadbeach', null, null],
      ]);
      expect(rows.every((r) => r.status === status && r.totalInc === 200 && r.subtotalEx === 200 && r.gstAmount === 0
        && r.billingEntityName === 'Harcourts Property Hub')).toBe(true);
      expect(fakeDb._store.propertyCharges.pAssigned).toMatchObject({ propertyAddress: 'Robina', agentName: 'Betty Bso' });
    });
  }
});

describe('GET /api/admin/invoicing/runs/[runId] — property rows (including runs drafted earlier)', () => {
  it('adds full address, selling agent, submission date and charge status per property; stored run untouched', async () => {
    seedProperties();
    fakeDb._seed('invoiceRuns', 'run1', { status: 'draft' });
    const properties = [
      { propertyId: 'pAssigned', address: 'Robina', agentName: 'Betty Bso', totalInc: 200 },
      { propertyId: 'pGone', address: 'Broadbeach', agentName: 'Someone', totalInc: 200 },
    ];
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', totalInc: 400, properties });
    fakeDb._seed('propertyCharges', 'pAssigned', { status: 'queued' });

    const { GET } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const body = await (await GET(new Request('http://x'), { params: Promise.resolve({ runId: 'run1' }) })).json();
    expect(body.items[0].totalInc).toBe(400);
    expect(body.items[0].properties.map((p) => [p.address, p.sellingAgentName, p.submittedAt, p.chargeStatus, p.totalInc])).toEqual([
      ['28 Brighton Crescent, Robina QLD, Australia', 'Mitch Harrop', '2026-11-17T03:00:00.000Z', 'queued', 200],
      ['Broadbeach', null, null, null, 200],
    ]);
    expect(fakeDb._store.invoiceRunItems.item1.properties).toEqual(properties);
  });
});
