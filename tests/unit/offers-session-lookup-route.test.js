import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { offers: [] };

function makeQuery(filters) {
  return {
    where: (field, op, value) => makeQuery([...filters, { field, value }]),
    orderBy: () => makeQuery(filters),
    limit: (n) => ({
      get: vi.fn(async () => {
        const matches = state.offers.filter((o) => filters.every((f) => o[f.field] === f.value));
        const sorted = [...matches].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const docs = sorted.slice(0, n).map((data) => ({
          id: data.id,
          data: () => data,
        }));
        return { empty: docs.length === 0, docs };
      }),
    }),
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'offers') return makeQuery([]);
      throw new Error(`Unexpected collection: ${name}`);
    },
  },
}));

function makeRequest(body) {
  return new Request('http://localhost/api/offers/session-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function resetState() {
  state.offers = [];
}

describe('POST /api/offers/session-lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns the previous offer amount and id for a matching session', async () => {
    state.offers = [
      { id: 'offer1', propertyId: 'p1', sessionId: 's1', offerAmount: 750000, updatedAt: 1, buyerEmail: 'luke@example.com', buyerName: 'Luke Wilson' },
    ];
    const { POST } = await import('../../src/app/api/offers/session-lookup/route');
    const res = await POST(makeRequest({ propertyId: 'p1', sessionId: 's1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ offerId: 'offer1', offerAmount: 750000 });
  });

  it('never returns buyer PII fields, even though they exist on the underlying document', async () => {
    state.offers = [
      { id: 'offer1', propertyId: 'p1', sessionId: 's1', offerAmount: 750000, updatedAt: 1, buyerEmail: 'luke@example.com', buyerName: 'Luke Wilson', buyerPhone: '0400000000' },
    ];
    const { POST } = await import('../../src/app/api/offers/session-lookup/route');
    const res = await POST(makeRequest({ propertyId: 'p1', sessionId: 's1' }));
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['offerAmount', 'offerId']);
    expect(JSON.stringify(body)).not.toContain('luke@example.com');
    expect(JSON.stringify(body)).not.toContain('Luke Wilson');
  });

  it('returns nulls when no matching session offer exists', async () => {
    const { POST } = await import('../../src/app/api/offers/session-lookup/route');
    const res = await POST(makeRequest({ propertyId: 'p1', sessionId: 'unknown-session' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ offerId: null, offerAmount: null });
  });

  it('only matches the exact property + session combination, not another property with the same session', async () => {
    state.offers = [
      { id: 'offer1', propertyId: 'p2', sessionId: 's1', offerAmount: 900000, updatedAt: 1 },
    ];
    const { POST } = await import('../../src/app/api/offers/session-lookup/route');
    const res = await POST(makeRequest({ propertyId: 'p1', sessionId: 's1' }));
    const body = await res.json();

    expect(body).toEqual({ offerId: null, offerAmount: null });
  });

  it('requires propertyId', async () => {
    const { POST } = await import('../../src/app/api/offers/session-lookup/route');
    const res = await POST(makeRequest({ sessionId: 's1' }));
    expect(res.status).toBe(400);
  });

  it('requires sessionId', async () => {
    const { POST } = await import('../../src/app/api/offers/session-lookup/route');
    const res = await POST(makeRequest({ propertyId: 'p1' }));
    expect(res.status).toBe(400);
  });
});
