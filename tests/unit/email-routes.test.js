import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin/auth
const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

// Mock adminDb
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: () => ({
      // Every document is owned by 'user123' (the user setupValidAuth signs in as),
      // which send-report needs: only the listing owner / a superAdmin may send.
      doc: () => ({ get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ userId: 'user123' }) }) }),
    }),
  },
}));

// Mock services
vi.mock('../../src/app/api/services/resendService', () => ({
  sendLink: vi.fn().mockResolvedValue(true),
  sendPropertyLiveEmail: vi.fn().mockResolvedValue(true),
  sendPropertyAgentEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/app/api/services/reportService', () => ({
  gatherReport: vi.fn().mockResolvedValue(true),
}));

function makeRequest(body, authHeader, url = 'http://localhost/test') {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// Helper to set up valid auth
function setupValidAuth() {
  mockVerifyIdToken.mockResolvedValue({ uid: 'user123', email: 'test@example.com' });
}

describe('POST /api/send-link', () => {
  let handler;
  beforeEach(async () => {
    vi.clearAllMocks();
    handler = (await import('../../src/app/api/send-link/route.js')).POST;
  });

  it('returns 401 without auth', async () => {
    const res = await handler(makeRequest({ email: 'a@b.com', link: 'https://x.com' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 with missing fields', async () => {
    setupValidAuth();
    const res = await handler(makeRequest({ email: 'a@b.com' }, 'Bearer valid-token'));
    expect(res.status).toBe(400);
  });

  it('succeeds with valid auth and body', async () => {
    setupValidAuth();
    const res = await handler(makeRequest({ email: 'a@b.com', link: 'https://x.com' }, 'Bearer valid-token'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/send-report', () => {
  let handler;
  beforeEach(async () => {
    vi.clearAllMocks();
    handler = (await import('../../src/app/api/send-report/route.js')).POST;
  });

  it('returns 401 without auth', async () => {
    const res = await handler(makeRequest({ email: 'a@b.com', propertyId: 'p1' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 with missing fields', async () => {
    setupValidAuth();
    const res = await handler(makeRequest({ email: 'a@b.com' }, 'Bearer valid-token'));
    expect(res.status).toBe(400);
  });

  it('succeeds with valid auth and body', async () => {
    setupValidAuth();
    const res = await handler(makeRequest(
      { email: 'a@b.com', propertyId: 'p1', name: 'Test' },
      'Bearer valid-token',
    ));
    expect(res.status).toBe(200);
  });

  it('returns 403 when the caller does not own the property (see office-admin-property-reports.test.js for the full matrix)', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'someone-else', email: 'x@example.com' });
    const res = await handler(makeRequest(
      { email: 'a@b.com', propertyId: 'p1', name: 'Test' },
      'Bearer valid-token',
    ));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/emails', () => {
  let handler;
  beforeEach(async () => {
    vi.clearAllMocks();
    handler = (await import('../../src/app/api/emails/route.js')).POST;
  });

  it('returns 401 without auth', async () => {
    const res = await handler(makeRequest({ email: 'a@b.com', address: '123 St' }));
    expect(res.status).toBe(401);
  });

  it('succeeds with valid auth and body', async () => {
    setupValidAuth();
    const res = await handler(makeRequest(
      { email: 'a@b.com', name: 'Test', address: '123 St', visibility: true },
      'Bearer valid-token',
      'http://localhost/api/emails',
    ));
    expect(res.status).toBe(200);
  });
});
