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

beforeEach(() => { fakeDb = makeFakeDb(); });

describe('fullPropertyAddress', () => {
  it('prefers formattedAddress (full street address) over the suburb-level address', async () => {
    const { fullPropertyAddress } = await import('../../src/app/api/services/chargeAddresses.js');
    expect(fullPropertyAddress({ address: 'Pimpama', formattedAddress: '1 Greenwich Avenue, Pimpama QLD, Australia' }))
      .toBe('1 Greenwich Avenue, Pimpama QLD, Australia');
    expect(fullPropertyAddress({ address: '3 C St' })).toBe('3 C St');
    expect(fullPropertyAddress({ address: '  ', formattedAddress: '' })).toBeNull();
    expect(fullPropertyAddress(null)).toBeNull();
  });
});

describe('GET /api/admin/invoicing/charges — full street address from the linked property', () => {
  const list = async (status) => {
    const { GET } = await import('../../src/app/api/admin/invoicing/charges/route.js');
    const res = await GET(new Request(`http://x/api/admin/invoicing/charges?status=${status}`));
    return (await res.json()).charges;
  };

  for (const status of ['pending', 'excluded', 'reversed']) {
    it(`${status}: shows the property's full address; amounts/status untouched; nothing guessed`, async () => {
      fakeDb._seed('properties', 'p1', { address: 'Robina', formattedAddress: '12 Example Street, Robina QLD, Australia' });
      fakeDb._seed('properties', 'p2', { address: 'Broadbeach' }); // no formattedAddress -> its own address
      // p3 has no property record -> keep the stored charge text
      const charge = (id, addr) => ({ propertyId: id, propertyAddress: addr, status, totalInc: 200, subtotalEx: 200, gstAmount: 0 });
      fakeDb._seed('propertyCharges', 'p1', charge('p1', 'Robina'));
      fakeDb._seed('propertyCharges', 'p2', charge('p2', 'Broadbeach'));
      fakeDb._seed('propertyCharges', 'p3', charge('p3', 'Varsity Lakes'));
      fakeDb._seed('propertyCharges', 'other', { ...charge('p1', 'Robina'), status: 'invoiced' });

      const rows = await list(status);
      expect(rows.map((r) => [r.id, r.propertyAddress])).toEqual([
        ['p1', '12 Example Street, Robina QLD, Australia'],
        ['p2', 'Broadbeach'],
        ['p3', 'Varsity Lakes'],
      ]);
      expect(rows.every((r) => r.status === status && r.totalInc === 200 && r.subtotalEx === 200 && r.gstAmount === 0)).toBe(true);
      // stored records are not modified
      expect(fakeDb._store.propertyCharges.p1.propertyAddress).toBe('Robina');
    });
  }

  it('looks each property up once, even when several charges share it', async () => {
    const { withFullPropertyAddresses } = await import('../../src/app/api/services/chargeAddresses.js');
    fakeDb._seed('properties', 'p1', { formattedAddress: '1 A St, Robina QLD, Australia' });
    const out = await withFullPropertyAddresses([{ propertyId: 'p1', address: 'Robina' }, { propertyId: 'p1', address: 'Robina' }, { address: 'x' }], 'address');
    expect(out.map((r) => r.address)).toEqual(['1 A St, Robina QLD, Australia', '1 A St, Robina QLD, Australia', 'x']);
    expect(fakeDb._reads).toEqual(['properties/p1']);
  });
});
