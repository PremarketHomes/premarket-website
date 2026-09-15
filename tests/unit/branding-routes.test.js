import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const state = { users: {}, agencyBrands: {} };

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'users') {
        return {
          doc: (id) => ({
            get: vi.fn().mockImplementation(async () => (
              state.users[id] ? { exists: true, data: () => state.users[id] } : { exists: false }
            )),
            update: vi.fn().mockImplementation(async (patch) => {
              state.users[id] = { ...(state.users[id] || {}), ...patch };
            }),
          }),
        };
      }
      if (name === 'agencyBrands') {
        return {
          doc: (id) => ({
            get: vi.fn().mockImplementation(async () => (
              state.agencyBrands[id] ? { exists: true, data: () => state.agencyBrands[id] } : { exists: false }
            )),
            set: vi.fn().mockImplementation(async (data) => { state.agencyBrands[id] = data; }),
          }),
          where: () => ({
            get: vi.fn().mockImplementation(async () => ({
              docs: Object.entries(state.agencyBrands).map(([id, data]) => ({ id, data: () => data })),
            })),
          }),
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

function makeRequest(body, authHeader, method = 'POST') {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method, headers, body: method !== 'GET' ? JSON.stringify(body) : undefined });
}

function setupValidAuth(uid = 'agent1') {
  mockVerifyIdToken.mockResolvedValue({ uid, email: 'agent@example.com' });
}

function resetState() {
  state.users = {};
  state.agencyBrands = {};
}

describe('POST /api/branding/extract-colors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    global.fetch = vi.fn();
  });

  it('returns 401 without auth', async () => {
    const { POST } = await import('../../src/app/api/branding/extract-colors/route');
    const res = await POST(makeRequest({ logoUrl: 'https://example.com/logo.png' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when logoUrl is missing', async () => {
    setupValidAuth();
    const { POST } = await import('../../src/app/api/branding/extract-colors/route');
    const res = await POST(makeRequest({}, 'Bearer valid'));
    expect(res.status).toBe(400);
  });

  it('returns 502 when the logo cannot be downloaded', async () => {
    setupValidAuth();
    global.fetch.mockResolvedValue({ ok: false });
    const { POST } = await import('../../src/app/api/branding/extract-colors/route');
    const res = await POST(makeRequest({ logoUrl: 'https://example.com/logo.png' }, 'Bearer valid'));
    expect(res.status).toBe(502);
  });

  it('does not write anything — this route only ever suggests', async () => {
    setupValidAuth();
    global.fetch.mockResolvedValue({ ok: false });
    const { POST } = await import('../../src/app/api/branding/extract-colors/route');
    await POST(makeRequest({ logoUrl: 'https://example.com/logo.png' }, 'Bearer valid'));
    expect(state.users).toEqual({});
    expect(state.agencyBrands).toEqual({});
  });
});

describe('POST /api/branding/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns 401 without auth', async () => {
    const { POST } = await import('../../src/app/api/branding/confirm/route');
    const res = await POST(makeRequest({ name: 'Harcourts Property Hub', primary: '#011d47' }));
    expect(res.status).toBe(401);
  });

  it('creates a new brand and links only the confirming agent', async () => {
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/branding/confirm/route');
    const res = await POST(makeRequest({ name: 'Harcourts Property Hub', logoUrl: 'https://x/logo.png', primary: '#011d47', secondary: '#01a8ec' }, 'Bearer valid'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(state.users.agent1.agencyBrandId).toBe(body.brandId);
  });

  it('rejects an invalid primary colour rather than saving broken branding', async () => {
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/branding/confirm/route');
    const res = await POST(makeRequest({ name: 'Harcourts Property Hub', primary: 'not-a-colour' }, 'Bearer valid'));
    expect(res.status).toBe(500);
    expect(state.users.agent1).toBeUndefined();
  });

  it('joining an existing brand only touches the joining agent\'s own account, when their companyName matches the brand', async () => {
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/branding/confirm/route');
    const createRes = await POST(makeRequest({ name: 'Harcourts Property Hub', primary: '#011d47' }, 'Bearer valid'));
    const { brandId } = await createRes.json();

    state.users.agent2 = { companyName: 'Harcourts Property Hub' };
    setupValidAuth('agent2');
    const joinRes = await POST(makeRequest({ brandId }, 'Bearer valid'));
    expect(joinRes.status).toBe(200);
    expect(state.users.agent2.agencyBrandId).toBe(brandId);
    expect(state.users.agent1.agencyBrandId).toBe(brandId); // unaffected by agent2 joining
  });

  it('rejects joining a brand whose name does not match the caller\'s own companyName (no self-assigning another agency\'s brand)', async () => {
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/branding/confirm/route');
    const createRes = await POST(makeRequest({ name: 'Harcourts Property Hub', primary: '#011d47' }, 'Bearer valid'));
    const { brandId } = await createRes.json();

    state.users.agent2 = { companyName: 'Some Rival Agency' };
    setupValidAuth('agent2');
    const joinRes = await POST(makeRequest({ brandId }, 'Bearer valid'));
    expect(joinRes.status).toBe(500);
    expect(state.users.agent2.agencyBrandId).toBeUndefined();
  });
});

describe('GET /api/branding/mine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns 401 without auth', async () => {
    const { GET } = await import('../../src/app/api/branding/mine/route');
    const res = await GET(makeRequest(undefined, undefined, 'GET'));
    expect(res.status).toBe(401);
  });

  it('returns brand: null, suggestion: null for a plain existing agent with no company name and no brand (unaffected by this feature)', async () => {
    setupValidAuth('agent1');
    state.users.agent1 = { firstName: 'Existing', roles: ['agent'] };
    const { GET } = await import('../../src/app/api/branding/mine/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'));
    const body = await res.json();
    expect(body.brand).toBeNull();
    expect(body.suggestion).toBeNull();
  });

  it('automatically joins an existing brand on an exact companyName match — no separate approval step required', async () => {
    setupValidAuth('agent1');
    state.agencyBrands['harcourts-property-hub'] = { name: 'Harcourts Property Hub', colors: { primary: '#011d47' } };
    state.users.agent2 = { companyName: 'Harcourts Property Hub' };

    setupValidAuth('agent2');
    const { GET } = await import('../../src/app/api/branding/mine/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'));
    const body = await res.json();

    // Simply loading /api/branding/mine (e.g. on dashboard mount) is now
    // enough to establish branding — no "Apply Branding" click required.
    expect(body.brand?.name).toBe('Harcourts Property Hub');
    expect(body.suggestion).toBeNull();
    expect(state.users.agent2.agencyBrandId).toBe('harcourts-property-hub');
  });

  it('automatically creates a brand from an agent\'s own logo when no existing brand matches their company', async () => {
    setupValidAuth('agent1');
    state.users.agent1 = { companyName: 'Brand New Agency', logoUrl: 'https://example.com/logo.png' };
    const sharp = (await import('sharp')).default;
    const buffer = await sharp(Buffer.from(
      '<svg width="120" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="120" fill="#ffffff"/><rect x="20" y="20" width="80" height="80" fill="#7a1f2b"/></svg>'
    )).png().toBuffer();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => buffer });

    const { GET } = await import('../../src/app/api/branding/mine/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'));
    const body = await res.json();

    expect(body.brand?.name).toBe('Brand New Agency');
    expect(state.users.agent1.agencyBrandId).toBeTruthy();
  });

  it('does not auto-establish anything for an agent with no logo and no matching existing brand — stays on default branding', async () => {
    setupValidAuth('agent1');
    state.users.agent1 = { companyName: 'Nobody Else Here Agency' };

    const { GET } = await import('../../src/app/api/branding/mine/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'));
    const body = await res.json();

    expect(body.brand).toBeNull();
    expect(body.suggestion).toBeNull();
    expect(state.users.agent1.agencyBrandId).toBeUndefined();
  });

  it('returns the resolved brand once an agent has confirmed one', async () => {
    setupValidAuth('agent1');
    state.agencyBrands['harcourts-property-hub'] = { name: 'Harcourts Property Hub', colors: { primary: '#011d47' } };
    state.users.agent1 = { agencyBrandId: 'harcourts-property-hub' };

    const { GET } = await import('../../src/app/api/branding/mine/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'));
    const body = await res.json();
    expect(body.brand.name).toBe('Harcourts Property Hub');
  });
});
