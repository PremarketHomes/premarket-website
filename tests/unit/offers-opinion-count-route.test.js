import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { offers: [] };

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'offers') {
        return {
          where: (field, op, value) => ({
            get: vi.fn(async () => ({
              docs: state.offers
                .filter((o) => o[field] === value)
                .map((data) => ({ data: () => data })),
            })),
          }),
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  },
}));

function makeRequest(url) {
  return new Request(url);
}

function resetState() {
  state.offers = [];
}

describe('GET /api/offers/opinion-count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('requires propertyId', async () => {
    const { GET } = await import('../../src/app/api/offers/opinion-count/route');
    const res = await GET(makeRequest('http://localhost/api/offers/opinion-count'));
    expect(res.status).toBe(400);
  });

  it('counts only type==="opinion" documents for the given property', async () => {
    state.offers = [
      { propertyId: 'p1', type: 'opinion', offerAmount: 1000000, buyerEmail: 'a@example.com' },
      { propertyId: 'p1', type: 'opinion', offerAmount: 1100000 },
      { propertyId: 'p1', type: 'interest-only-placeholder' }, // not an opinion — should not count
      { propertyId: 'p2', type: 'opinion' }, // different property — should not count
    ];
    const { GET } = await import('../../src/app/api/offers/opinion-count/route');
    const res = await GET(makeRequest('http://localhost/api/offers/opinion-count?propertyId=p1'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ count: 2 });
  });

  it('never returns anything beyond a count — no amounts, no buyer fields, no document contents', async () => {
    state.offers = [
      { propertyId: 'p1', type: 'opinion', offerAmount: 1900000, buyerName: 'Luke Wilson', buyerEmail: 'luke@example.com' },
    ];
    const { GET } = await import('../../src/app/api/offers/opinion-count/route');
    const res = await GET(makeRequest('http://localhost/api/offers/opinion-count?propertyId=p1'));
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['count']);
    expect(JSON.stringify(body)).not.toContain('Luke');
    expect(JSON.stringify(body)).not.toContain('1900000');
  });

  it('returns 0 for a property with no opinions yet, not an error', async () => {
    const { GET } = await import('../../src/app/api/offers/opinion-count/route');
    const res = await GET(makeRequest('http://localhost/api/offers/opinion-count?propertyId=brand-new-listing'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ count: 0 });
  });
});
