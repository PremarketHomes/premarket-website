import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin/auth
const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

// Mock adminDb
const state = vi.hoisted(() => ({ emailLog: {} }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => ({
      // Property documents are owned by 'user123' (the user setupValidAuth signs in as), which send-report needs:
      // only the listing owner / a superAdmin may send. emailLog is the durable counter store used by send-link.
      doc: (id) => ({
        collectionName: name, id,
        get: vi.fn().mockImplementation(async () => (name === 'emailLog'
          ? { exists: !!state.emailLog[id], data: () => state.emailLog[id] }
          : { exists: true, data: () => ({ userId: 'user123' }) })),
      }),
    }),
    runTransaction: async (fn) => fn({
      get: (ref) => ref.get(),
      set: (ref, data) => { state[ref.collectionName][ref.id] = { ...data }; },
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
  const OWN = 'test@example.com';
  const LINK = 'https://premarket.homes/find-property?propertyId=abc123';
  beforeEach(async () => {
    vi.clearAllMocks();
    state.emailLog = {};
    handler = (await import('../../src/app/api/send-link/route.js')).POST;
  });

  it('returns 401 without auth', async () => {
    const res = await handler(makeRequest({ link: LINK }));
    expect(res.status).toBe(401);
  });

  it('returns 400 with a missing link', async () => {
    setupValidAuth();
    const res = await handler(makeRequest({ email: OWN }, 'Bearer valid-token'));
    expect(res.status).toBe(400);
  });

  it('sends a Premarket link to the signed-in user\'s own email (the email field is optional)', async () => {
    setupValidAuth();
    const { sendLink } = await import('../../src/app/api/services/resendService');
    expect((await handler(makeRequest({ link: LINK }, 'Bearer valid-token'))).status).toBe(200);
    expect((await handler(makeRequest({ link: LINK, email: 'TEST@example.com' }, 'Bearer valid-token'))).status).toBe(200);
    expect(sendLink).toHaveBeenCalledTimes(2);
    expect(sendLink.mock.calls[0]).toEqual([LINK, OWN]);
  });

  it('refuses to send to anyone else (no open relay)', async () => {
    setupValidAuth();
    const { sendLink } = await import('../../src/app/api/services/resendService');
    const res = await handler(makeRequest({ link: LINK, email: 'victim@elsewhere.com' }, 'Bearer valid-token'));
    expect(res.status).toBe(403);
    expect(sendLink).not.toHaveBeenCalled();
  });

  it('refuses links that are not Premarket links', async () => {
    setupValidAuth();
    const { sendLink } = await import('../../src/app/api/services/resendService');
    for (const link of ['https://x.com', 'http://premarket.homes/x', 'https://premarket.homes.evil.com/x', 'https://evil.com/?u=https://premarket.homes', 'https://user:pw@premarket.homes/x', 'https://premarket.homes:8443/x', 'javascript:alert(1)', 'not a url', 'https://premarket.homes/' + 'a'.repeat(700)]) {
      expect((await handler(makeRequest({ link }, 'Bearer valid-token'))).status).toBe(400);
    }
    expect(sendLink).not.toHaveBeenCalled();
  });

  it('normalises the link so nothing can break out of the email\'s href', async () => {
    setupValidAuth();
    const { sendLink } = await import('../../src/app/api/services/resendService');
    await handler(makeRequest({ link: 'https://premarket.homes/find-property?propertyId=x"onmouseover="alert(1)<b>' }, 'Bearer valid-token'));
    const sent = sendLink.mock.calls[0][0];
    expect(sent).not.toMatch(/["<>]/);
    expect(sent.startsWith('https://premarket.homes/')).toBe(true);
  });

  it('limits each user to 20 sends a day', async () => {
    setupValidAuth();
    const { sendLink } = await import('../../src/app/api/services/resendService');
    for (let i = 0; i < 20; i++) expect((await handler(makeRequest({ link: LINK }, 'Bearer valid-token'))).status).toBe(200);
    expect((await handler(makeRequest({ link: LINK }, 'Bearer valid-token'))).status).toBe(429);
    expect(sendLink).toHaveBeenCalledTimes(20);
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
