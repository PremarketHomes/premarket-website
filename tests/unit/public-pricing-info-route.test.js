import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeFakeDb() {
  const store = {};
  return {
    collection(name) {
      store[name] = store[name] || {};
      return {
        doc(id) {
          return {
            async get() {
              const data = store[name][id];
              return { exists: !!data, data: () => data };
            },
          };
        },
      };
    },
    _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; },
  };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
});

describe('GET /api/public/pricing-info', () => {
  it('returns the real configured price, GST rate, and payment terms', async () => {
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0, paymentTermsDays: 14 });
    const { GET } = await import('../../src/app/api/public/pricing-info/route.js');
    const res = await GET();
    const data = await res.json();

    expect(data).toEqual({ pricePerListing: 200, gstRate: 0, paymentTermsDays: 14 });
  });

  it('reflects a changed price immediately, never a stale hardcoded value', async () => {
    fakeDb._seed('settings', 'invoicing', { pricePerListing: 250, gstRate: 0.1, paymentTermsDays: 30 });
    const { GET } = await import('../../src/app/api/public/pricing-info/route.js');
    const res = await GET();
    const data = await res.json();

    expect(data).toEqual({ pricePerListing: 250, gstRate: 0.1, paymentTermsDays: 30 });
  });

  it('falls back to the real defaults when settings/invoicing has no document at all', async () => {
    const { GET } = await import('../../src/app/api/public/pricing-info/route.js');
    const res = await GET();
    const data = await res.json();

    expect(data).toEqual({ pricePerListing: 200, gstRate: 0, paymentTermsDays: 14 });
  });

  it('never exposes anything beyond the three safe fields, even if the document has more', async () => {
    fakeDb._seed('settings', 'invoicing', {
      pricePerListing: 200, gstRate: 0, paymentTermsDays: 14,
      cronEnabled: true, billingActivatedAt: '2026-01-01', excludeAgentIds: ['secret-agent'], xeroAccountCode: '200',
    });
    const { GET } = await import('../../src/app/api/public/pricing-info/route.js');
    const res = await GET();
    const data = await res.json();

    expect(Object.keys(data).sort()).toEqual(['gstRate', 'paymentTermsDays', 'pricePerListing']);
  });

  it('requires no authentication at all — a public route by design', async () => {
    const { GET } = await import('../../src/app/api/public/pricing-info/route.js');
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
