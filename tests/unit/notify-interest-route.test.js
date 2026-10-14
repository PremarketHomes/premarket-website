import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { offers: {}, properties: {}, users: {} };

function makeDocRef(collectionName, id) {
  return {
    id,
    collectionName,
    get: vi.fn(async () => {
      const data = state[collectionName]?.[id];
      return { exists: !!data, data: () => data };
    }),
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => ({
      doc: (id) => makeDocRef(name, id),
    }),
    runTransaction: async (fn) => {
      const tx = {
        get: async (ref) => ref.get(),
        update: (ref, updates) => {
          state[ref.collectionName][ref.id] = { ...state[ref.collectionName][ref.id], ...updates };
        },
      };
      return fn(tx);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP' },
}));

vi.mock('../../src/app/api/services/resendService', () => ({
  sendNewBuyerInterestEmail: vi.fn(async () => ({ id: 'mock-email-id' })),
}));

function makeRequest(body) {
  return new Request('http://localhost/api/offers/notify-interest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function resetState() {
  state.offers = {
    'offer-1': {
      propertyId: 'prop-1',
      serious: true,
      buyerName: 'Jane Buyer',
      buyerEmail: 'jane@example.com',
      buyerPhone: '0400 000 000',
      nextAction: 'contact',
    },
  };
  state.properties = {
    'prop-1': { userId: 'agent-1', formattedAddress: '1 Example St, Testville' },
  };
  state.users = {
    'agent-1': { email: 'agent@example.com', firstName: 'Alex' },
  };
}

describe('POST /api/offers/notify-interest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('sends exactly once for a genuine new registration', async () => {
    const { POST } = await import('../../src/app/api/offers/notify-interest/route');
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');

    const res = await POST(makeRequest({ offerId: 'offer-1', propertyId: 'prop-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: true });
    expect(sendNewBuyerInterestEmail).toHaveBeenCalledTimes(1);
    expect(sendNewBuyerInterestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        agentEmail: 'agent@example.com',
        agentFirstName: 'Alex',
        buyerName: 'Jane Buyer',
        buyerEmail: 'jane@example.com',
        buyerPhone: '0400 000 000',
      })
    );
  });

  it('never sends a second email for the same offer — a double-click, a client retry, or a resubmit after refresh', async () => {
    const { POST } = await import('../../src/app/api/offers/notify-interest/route');
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');

    const first = await POST(makeRequest({ offerId: 'offer-1', propertyId: 'prop-1' }));
    expect((await first.json())).toEqual({ sent: true });

    // Simulate two further calls for the exact same offer, as if the
    // buyer's client retried or they resubmitted after a refresh.
    const second = await POST(makeRequest({ offerId: 'offer-1', propertyId: 'prop-1' }));
    const third = await POST(makeRequest({ offerId: 'offer-1', propertyId: 'prop-1' }));

    expect((await second.json())).toEqual({ skipped: true, reason: 'already notified' });
    expect((await third.json())).toEqual({ skipped: true, reason: 'already notified' });
    expect(sendNewBuyerInterestEmail).toHaveBeenCalledTimes(1);
  });

  it('never sends for an offer that is not a genuine registration (serious !== true)', async () => {
    state.offers['offer-2'] = { propertyId: 'prop-1', serious: false };
    const { POST } = await import('../../src/app/api/offers/notify-interest/route');
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');

    const res = await POST(makeRequest({ offerId: 'offer-2', propertyId: 'prop-1' }));
    expect((await res.json())).toEqual({ skipped: true, reason: 'not a genuine registration' });
    expect(sendNewBuyerInterestEmail).not.toHaveBeenCalled();
  });

  it('never sends when the property has no owning agent', async () => {
    state.properties['prop-1'] = { formattedAddress: '1 Example St' }; // no userId
    const { POST } = await import('../../src/app/api/offers/notify-interest/route');
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');

    const res = await POST(makeRequest({ offerId: 'offer-1', propertyId: 'prop-1' }));
    expect((await res.json())).toEqual({ skipped: true, reason: 'no owning agent on this property' });
    expect(sendNewBuyerInterestEmail).not.toHaveBeenCalled();
  });

  it('never sends when the agent has no email on file', async () => {
    state.users['agent-1'] = { firstName: 'Alex' }; // no email
    const { POST } = await import('../../src/app/api/offers/notify-interest/route');
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');

    const res = await POST(makeRequest({ offerId: 'offer-1', propertyId: 'prop-1' }));
    expect((await res.json())).toEqual({ skipped: true, reason: 'agent has no email on file' });
    expect(sendNewBuyerInterestEmail).not.toHaveBeenCalled();
  });

  it('rejects a mismatched propertyId rather than trusting the client pairing', async () => {
    state.properties['prop-2'] = { userId: 'agent-1', formattedAddress: 'Somewhere else' };
    const { POST } = await import('../../src/app/api/offers/notify-interest/route');
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');

    const res = await POST(makeRequest({ offerId: 'offer-1', propertyId: 'prop-2' }));
    expect((await res.json())).toEqual({ skipped: true, reason: 'propertyId mismatch' });
    expect(sendNewBuyerInterestEmail).not.toHaveBeenCalled();
  });

  it('requires offerId and propertyId', async () => {
    const { POST } = await import('../../src/app/api/offers/notify-interest/route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns a clean 404-equivalent for an offer that does not exist, rather than throwing', async () => {
    const { POST } = await import('../../src/app/api/offers/notify-interest/route');
    const res = await POST(makeRequest({ offerId: 'does-not-exist', propertyId: 'prop-1' }));
    expect((await res.json())).toEqual({ skipped: true, reason: 'offer not found' });
  });
});
