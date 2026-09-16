import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const state = { users: {} };
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'users') {
        return {
          doc: (id) => ({
            get: vi.fn(async () => (state.users[id] ? { exists: true, data: () => state.users[id] } : { exists: false })),
          }),
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  },
}));

const mockCreateLinks = vi.fn();
const mockGetEngagement = vi.fn();
const mockResolveToken = vi.fn();
const mockRecordEngagement = vi.fn();
vi.mock('../../src/app/api/services/recipientLinkService', () => ({
  createRecipientLinksForProperty: (...args) => mockCreateLinks(...args),
  getRecipientEngagementForProperty: (...args) => mockGetEngagement(...args),
  resolveRecipientToken: (...args) => mockResolveToken(...args),
  recordRecipientEngagement: (...args) => mockRecordEngagement(...args),
}));

vi.mock('../../src/app/utils/scannerDetection', () => ({
  isLikelyScanner: vi.fn(() => false),
}));

function makeRequest(url, { method = 'GET', body, authHeader } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

function setupAdmin(uid = 'admin1') {
  mockVerifyIdToken.mockResolvedValue({ uid, email: 'admin@example.com' });
  state.users[uid] = { superAdmin: true };
}

function setupNonAdmin(uid = 'agent1') {
  mockVerifyIdToken.mockResolvedValue({ uid, email: 'agent@example.com' });
  state.users[uid] = { superAdmin: false };
}

function resetState() {
  state.users = {};
}

describe('POST /api/admin/recipient-links/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns 401 without auth', async () => {
    const { POST } = await import('../../src/app/api/admin/recipient-links/create/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/create', { method: 'POST', body: { propertyId: 'p1', recipients: [{ email: 'a@example.com' }] } }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for an authenticated non-admin', async () => {
    setupNonAdmin();
    const { POST } = await import('../../src/app/api/admin/recipient-links/create/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/create', { method: 'POST', body: { propertyId: 'p1', recipients: [{ email: 'a@example.com' }] }, authHeader: 'Bearer valid' }));
    expect(res.status).toBe(403);
    expect(mockCreateLinks).not.toHaveBeenCalled();
  });

  it('rejects a batch larger than 25 without calling the service', async () => {
    setupAdmin();
    const recipients = Array.from({ length: 26 }, (_, i) => ({ email: `b${i}@example.com` }));
    const { POST } = await import('../../src/app/api/admin/recipient-links/create/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/create', { method: 'POST', body: { propertyId: 'p1', recipients }, authHeader: 'Bearer valid' }));
    expect(res.status).toBe(400);
    expect(mockCreateLinks).not.toHaveBeenCalled();
  });

  it('rejects a recipient with neither name nor email', async () => {
    setupAdmin();
    const { POST } = await import('../../src/app/api/admin/recipient-links/create/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/create', { method: 'POST', body: { propertyId: 'p1', recipients: [{}] }, authHeader: 'Bearer valid' }));
    expect(res.status).toBe(400);
  });

  it('creates links for an admin and returns them', async () => {
    setupAdmin();
    mockCreateLinks.mockResolvedValue([{ recipientId: 'rec1', token: 'rl_abc', url: 'https://premarket.homes/find-property?propertyId=p1&rlt=rl_abc', name: 'Luke', email: 'luke@example.com' }]);
    const { POST } = await import('../../src/app/api/admin/recipient-links/create/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/create', { method: 'POST', body: { propertyId: 'p1', recipients: [{ name: 'Luke', email: 'luke@example.com' }], isTest: true }, authHeader: 'Bearer valid' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.links).toHaveLength(1);
    expect(mockCreateLinks).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 'p1', createdBy: 'admin1', isTest: true }));
  });

  it('maps a not-found property to 404', async () => {
    setupAdmin();
    mockCreateLinks.mockRejectedValue(new Error('PROPERTY_NOT_FOUND'));
    const { POST } = await import('../../src/app/api/admin/recipient-links/create/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/create', { method: 'POST', body: { propertyId: 'missing', recipients: [{ email: 'a@example.com' }] }, authHeader: 'Bearer valid' }));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/recipient-links/engagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns 401 without auth', async () => {
    const { GET } = await import('../../src/app/api/admin/recipient-links/engagement/route');
    const res = await GET(makeRequest('http://localhost/api/admin/recipient-links/engagement?propertyId=p1'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin', async () => {
    setupNonAdmin();
    const { GET } = await import('../../src/app/api/admin/recipient-links/engagement/route');
    const res = await GET(makeRequest('http://localhost/api/admin/recipient-links/engagement?propertyId=p1', { authHeader: 'Bearer valid' }));
    expect(res.status).toBe(403);
  });

  it('returns per-recipient rows for an admin, including PII fields (admin-only surface)', async () => {
    setupAdmin();
    mockGetEngagement.mockResolvedValue([{ recipientId: 'rec1', name: 'Luke Wilson', email: 'luke@example.com', attributableOpens: 3, meaningfulSessionCount: 2 }]);
    const { GET } = await import('../../src/app/api/admin/recipient-links/engagement/route');
    const res = await GET(makeRequest('http://localhost/api/admin/recipient-links/engagement?propertyId=p1', { authHeader: 'Bearer valid' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.rows[0]).toMatchObject({ name: 'Luke Wilson', attributableOpens: 3 });
  });
});

describe('POST /api/admin/recipient-links/simulate-open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns 401 without auth', async () => {
    const { POST } = await import('../../src/app/api/admin/recipient-links/simulate-open/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/simulate-open', { method: 'POST', body: { token: 'rl_x', propertyId: 'p1' } }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin', async () => {
    setupNonAdmin();
    const { POST } = await import('../../src/app/api/admin/recipient-links/simulate-open/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/simulate-open', { method: 'POST', body: { token: 'rl_x', propertyId: 'p1' }, authHeader: 'Bearer valid' }));
    expect(res.status).toBe(403);
  });

  it('reports attributed: false for an invalid token without throwing', async () => {
    setupAdmin();
    mockResolveToken.mockResolvedValue(null);
    const { POST } = await import('../../src/app/api/admin/recipient-links/simulate-open/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/simulate-open', { method: 'POST', body: { token: 'garbage', propertyId: 'p1' }, authHeader: 'Bearer valid' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.attributed).toBe(false);
    expect(mockRecordEngagement).not.toHaveBeenCalled();
  });

  it('simulates an attributed open for a valid token', async () => {
    setupAdmin();
    mockResolveToken.mockResolvedValue({ recipientId: 'rec1', propertyId: 'p1', agencyOwnerId: 'agent1' });
    mockRecordEngagement.mockResolvedValue({ scannerSuspected: false, isNewSession: true });
    const { POST } = await import('../../src/app/api/admin/recipient-links/simulate-open/route');
    const res = await POST(makeRequest('http://localhost/api/admin/recipient-links/simulate-open', { method: 'POST', body: { token: 'rl_valid', propertyId: 'p1' }, authHeader: 'Bearer valid' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.attributed).toBe(true);
    expect(body.recipientId).toBe('rec1');
  });
});
