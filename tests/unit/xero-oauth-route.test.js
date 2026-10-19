import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyAdmin = vi.fn();
vi.mock('../../src/app/api/middleware/auth', () => ({
  verifyAdmin: (...args) => mockVerifyAdmin(...args),
}));

function makeFakeDb() {
  const store = {};
  return {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({ exists: !!(store[name] && store[name][id]), data: () => store[name]?.[id] }),
      }),
    }),
    _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; },
  };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

const mockSaveXeroTokens = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  saveXeroTokens: (...args) => mockSaveXeroTokens(...args),
}));

function cookieFromSetCookie(res, name) {
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(new RegExp(`${name}=([^;]*)`));
  return match ? match[1] : null;
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
  process.env.XERO_CLIENT_ID = 'client1';
  process.env.XERO_CLIENT_SECRET = 'secret1';
  process.env.XERO_REDIRECT_URI = 'https://premarket.homes/api/auth/xero/callback';
});

describe('GET /api/auth/xero — starts the flow with a CSRF nonce', () => {
  it('sets an httpOnly nonce cookie and embeds the same nonce in state', async () => {
    mockVerifyAdmin.mockResolvedValue({ authenticated: true, uid: 'admin1' });
    const { GET } = await import('../../src/app/api/auth/xero/route.js');
    const res = await GET(new Request('http://localhost/api/auth/xero'));
    const body = await res.json();

    const cookieNonce = cookieFromSetCookie(res, 'xero_oauth_nonce');
    expect(cookieNonce).toBeTruthy();

    const url = new URL(body.url);
    const state = JSON.parse(Buffer.from(url.searchParams.get('state'), 'base64').toString());
    expect(state.nonce).toBe(cookieNonce);
    expect(state.adminUid).toBe('admin1');
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  });

  it('requests the granular accounting.invoices scope, never the retired broad accounting.transactions scope', async () => {
    // Xero rejects accounting.transactions with invalid_scope for any
    // app created on/after 2 March 2026 — this Premarket app is one.
    // accounting.invoices is the correct granular replacement for
    // creating invoices and reading their status back.
    mockVerifyAdmin.mockResolvedValue({ authenticated: true, uid: 'admin1' });
    const { GET } = await import('../../src/app/api/auth/xero/route.js');
    const res = await GET(new Request('http://localhost/api/auth/xero'));
    const body = await res.json();

    const url = new URL(body.url);
    const scopes = url.searchParams.get('scope').split(' ');
    expect(scopes).toContain('accounting.invoices');
    expect(scopes).toContain('accounting.contacts');
    expect(scopes).not.toContain('accounting.transactions');
  });

  it('refuses non-admins before ever generating a nonce', async () => {
    mockVerifyAdmin.mockResolvedValue({ authenticated: false, error: 'Forbidden', status: 403 });
    const { GET } = await import('../../src/app/api/auth/xero/route.js');
    const res = await GET(new Request('http://localhost/api/auth/xero'));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('GET /api/auth/xero/callback — CSRF nonce is enforced', () => {
  beforeEach(() => {
    fakeDb._seed('users', 'admin1', { superAdmin: true });
  });

  function makeCallbackRequest({ code = 'auth-code', adminUid = 'admin1', nonce = 'nonce-abc', cookieNonce = 'nonce-abc' } = {}) {
    const state = Buffer.from(JSON.stringify({ adminUid, nonce })).toString('base64');
    const url = `http://localhost/api/auth/xero/callback?code=${code}&state=${encodeURIComponent(state)}`;
    const headers = cookieNonce ? { cookie: `xero_oauth_nonce=${cookieNonce}` } : {};
    return new Request(url, { headers });
  }

  it('rejects when there is no nonce cookie at all (e.g. a replayed/forged link)', async () => {
    const { GET } = await import('../../src/app/api/auth/xero/callback/route.js');
    const res = await GET(makeCallbackRequest({ cookieNonce: null }));
    expect(res.status).toBe(307); // redirect
    const location = res.headers.get('location');
    expect(location).toContain('reason=csrf');
    expect(mockSaveXeroTokens).not.toHaveBeenCalled();
  });

  it('rejects when the cookie nonce does not match the state nonce', async () => {
    const { GET } = await import('../../src/app/api/auth/xero/callback/route.js');
    const res = await GET(makeCallbackRequest({ nonce: 'nonce-abc', cookieNonce: 'nonce-DIFFERENT' }));
    const location = res.headers.get('location');
    expect(location).toContain('reason=csrf');
    expect(mockSaveXeroTokens).not.toHaveBeenCalled();
  });

  it('clears the nonce cookie even on a CSRF rejection', async () => {
    const { GET } = await import('../../src/app/api/auth/xero/callback/route.js');
    const res = await GET(makeCallbackRequest({ cookieNonce: null }));
    expect(res.headers.get('set-cookie')).toMatch(/xero_oauth_nonce=;/);
  });

  it('proceeds to token exchange when the nonce matches and the admin is valid', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', refresh_token: 'ref' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ tenantId: 'tenant1' }]) });

    const { GET } = await import('../../src/app/api/auth/xero/callback/route.js');
    const res = await GET(makeCallbackRequest());

    expect(mockSaveXeroTokens).toHaveBeenCalledTimes(1);
    expect(res.headers.get('location')).toContain('xero=connected');
  });

  it('rejects when the state claims an admin who is not actually a superAdmin', async () => {
    fakeDb._seed('users', 'not-admin', { superAdmin: false });
    const { GET } = await import('../../src/app/api/auth/xero/callback/route.js');
    const res = await GET(makeCallbackRequest({ adminUid: 'not-admin' }));
    expect(res.headers.get('location')).toContain('reason=unauthorized');
    expect(mockSaveXeroTokens).not.toHaveBeenCalled();
  });
});
