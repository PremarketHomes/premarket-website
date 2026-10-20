import { describe, it, expect, vi, beforeEach } from 'vitest';

// Rex/AgentBox import are not agent-facing features — no link to
// either exists anywhere in the regular agent dashboard, confirmed by
// reading the actual nav. No agent has ever seen a billing disclosure
// for a CRM-synced property, so these routes must never create a
// charge, in either demo or real mode, regardless of what else
// changes about the sync/matching logic.

const mockVerifyAuth = vi.fn();
vi.mock('../../src/app/api/middleware/auth', () => ({
  verifyAuth: (...args) => mockVerifyAuth(...args),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

const mockCreatePropertyAndChargeAtomically = vi.fn();
vi.mock('../../src/app/api/services/billingService', () => ({
  createPropertyAndChargeAtomically: (...args) => mockCreatePropertyAndChargeAtomically(...args),
}));

function makeFakeDb() {
  const store = {};
  function col(name) {
    store[name] = store[name] || {};
    function query() {
      return {
        where: () => query(),
        get: async () => ({ docs: [], empty: true }),
      };
    }
    return {
      doc(id) {
        return { async set() {}, async get() { return { exists: false, data: () => undefined }; } };
      },
      ...query(),
    };
  }
  return { collection: col };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

const mockAgentboxGetCredentials = vi.fn();
const mockAgentboxFetchListingById = vi.fn();
const mockAgentboxMapListing = vi.fn();
vi.mock('../../src/app/api/services/agentboxService', () => ({
  getCredentials: (...args) => mockAgentboxGetCredentials(...args),
  fetchListingById: (...args) => mockAgentboxFetchListingById(...args),
  mapListingToProperty: (...args) => mockAgentboxMapListing(...args),
}));
vi.mock('../../src/app/api/services/agentboxDemoData', () => ({
  DEMO_LISTINGS: [{ id: 'demo1', address: '1 Demo St' }],
}));

const mockRexGetCredentials = vi.fn();
const mockRexFetchListingById = vi.fn();
const mockRexMapListing = vi.fn();
vi.mock('../../src/app/api/services/rexService', () => ({
  getCredentials: (...args) => mockRexGetCredentials(...args),
  fetchListingById: (...args) => mockRexFetchListingById(...args),
  mapRexListingToProperty: (...args) => mockRexMapListing(...args),
}));
vi.mock('../../src/app/api/services/rexDemoData', () => ({
  DEMO_LISTINGS: [{ id: 'demo1', address: '1 Demo St' }],
}));

function makeRequest(body) {
  const headers = new Headers({ authorization: 'Bearer t', 'Content-Type': 'application/json' });
  return new Request('http://localhost/test', { method: 'POST', headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
  mockVerifyAuth.mockResolvedValue({ authenticated: true, uid: 'agent1' });
  mockCreatePropertyAndChargeAtomically.mockResolvedValue({ propertyId: 'prop1', charged: false });
  mockAgentboxMapListing.mockReturnValue({ address: '1 Demo St' });
  mockRexMapListing.mockReturnValue({ address: '1 Demo St' });
  mockAgentboxFetchListingById.mockResolvedValue({ response: { listing: { id: 'real1', address: '1 Real St' } } });
  mockRexFetchListingById.mockResolvedValue({ response: { listing: { id: 'real1', address: '1 Real St' } } });
});

describe('AgentBox import — never creates a charge', () => {
  it('skipCharge is true for a demo-mode import', async () => {
    mockAgentboxGetCredentials.mockResolvedValue({ status: 'connected', mode: 'demo', clientId: 'demo', apiKey: 'demo' });
    const { POST } = await import('../../src/app/api/integrations/agentbox/import/route.js');
    await POST(makeRequest({ listingIds: ['demo1'] }));
    expect(mockCreatePropertyAndChargeAtomically).toHaveBeenCalledWith(expect.anything(), { skipCharge: true });
  });

  it('skipCharge is STILL true for a real (non-demo) import — the actual fix', async () => {
    mockAgentboxGetCredentials.mockResolvedValue({ status: 'connected', mode: 'real', clientId: 'real-client', apiKey: 'real-key' });
    const { POST } = await import('../../src/app/api/integrations/agentbox/import/route.js');
    await POST(makeRequest({ listingIds: ['real1'] }));
    expect(mockCreatePropertyAndChargeAtomically).toHaveBeenCalledWith(expect.anything(), { skipCharge: true });
  });
});

describe('Rex import — never creates a charge', () => {
  it('skipCharge is true for a demo-mode import', async () => {
    mockRexGetCredentials.mockResolvedValue({ status: 'connected', mode: 'demo', accountId: 'demo', apiSecret: 'demo' });
    const { POST } = await import('../../src/app/api/integrations/rex/import/route.js');
    await POST(makeRequest({ listingIds: ['demo1'] }));
    expect(mockCreatePropertyAndChargeAtomically).toHaveBeenCalledWith(expect.anything(), { skipCharge: true });
  });

  it('skipCharge is STILL true for a real (non-demo) import — the actual fix', async () => {
    mockRexGetCredentials.mockResolvedValue({ status: 'connected', mode: 'real', accountId: 'real-account', apiSecret: 'real-secret' });
    const { POST } = await import('../../src/app/api/integrations/rex/import/route.js');
    await POST(makeRequest({ listingIds: ['real1'] }));
    expect(mockCreatePropertyAndChargeAtomically).toHaveBeenCalledWith(expect.anything(), { skipCharge: true });
  });
});
