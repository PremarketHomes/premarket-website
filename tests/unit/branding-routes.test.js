import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

// safeFetchExternalImage (shared by /api/branding/extract-colors) does
// a real DNS lookup before fetching, specifically to block SSRF — see
// safeExternalFetch.test.js for the real dedicated coverage of that
// logic. Here it's just mocked to resolve every test hostname to an
// ordinary public IP, so these tests exercise the mocked global.fetch
// exactly as before, without depending on real network access.
vi.mock('node:dns', () => ({
  default: { promises: { lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) } },
  promises: { lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) },
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
              state.users[id] = { ...(state.users[id] || {}) };
              for (const [key, value] of Object.entries(patch)) {
                if (value === 'DELETE_SENTINEL') delete state.users[id][key];
                else state.users[id][key] = value;
              }
            }),
            where: (field, op, value) => ({
              get: vi.fn().mockImplementation(async () => {
                const docs = Object.entries(state.users)
                  .filter(([, data]) => (op === '!=' ? data[field] !== value && data[field] !== undefined : data[field] === value))
                  .map(([id, data]) => ({ id, data: () => data }));
                return { docs };
              }),
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
            create: vi.fn().mockImplementation(async (data) => {
              if (state.agencyBrands[id]) {
                const err = new Error('ALREADY_EXISTS: Document already exists');
                err.code = 6;
                throw err;
              }
              state.agencyBrands[id] = { ...data };
            }),
          }),
          where: () => ({
            get: vi.fn().mockImplementation(async () => ({
              docs: Object.entries(state.agencyBrands).map(([id, data]) => ({ id, data: () => data })),
            })),
          }),
          get: vi.fn().mockImplementation(async () => ({
            docs: Object.entries(state.agencyBrands).map(([id, data]) => ({ id, data: () => data })),
          })),
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP', delete: () => 'DELETE_SENTINEL' },
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

  it('CORE RULE: with no existing brand, this ESTABLISHES a new shared brand and links only the confirming agent', async () => {
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/branding/confirm/route');
    const res = await POST(makeRequest({ name: 'Harcourts Property Hub', logoUrl: 'https://x/logo.png', primary: '#011d47', secondary: '#01a8ec' }, 'Bearer valid'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.personalOverride).toBe(false);
    expect(state.users.agent1.agencyBrandId).toBe(body.brandId);
    expect(state.agencyBrands[body.brandId].createdBy).toBe('agent1');
  });

  it('establishing requires a name and a primary colour', async () => {
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/branding/confirm/route');

    const noName = await POST(makeRequest({ primary: '#011d47' }, 'Bearer valid'));
    expect(noName.status).toBe(400);

    const noColour = await POST(makeRequest({ name: 'Harcourts Property Hub' }, 'Bearer valid'));
    expect(noColour.status).toBe(400);
  });

  it('rejects an invalid primary colour rather than saving broken branding', async () => {
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/branding/confirm/route');
    const res = await POST(makeRequest({ name: 'Harcourts Property Hub', primary: 'not-a-colour' }, 'Bearer valid'));
    expect(res.status).toBe(500);
    expect(state.users.agent1).toBeUndefined();
  });

  it('CORE RULE: once the caller already has a shared brand linked, confirm is ALWAYS a personal override — never touches the shared brand', async () => {
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/branding/confirm/route');
    const createRes = await POST(makeRequest({ name: 'Harcourts Property Hub', logoUrl: 'https://shared.example.com/logo.png', primary: '#011d47' }, 'Bearer valid'));
    const { brandId } = await createRes.json();
    const sharedBrandBefore = { ...state.agencyBrands[brandId] };

    // agent2 is already linked to the SAME brand (simulating automatic
    // inheritance via autoEstablishBrandForUser) and now personalizes
    // their own logo/colours.
    state.users.agent2 = { companyName: 'Harcourts Property Hub', agencyBrandId: brandId };
    setupValidAuth('agent2');
    const overrideRes = await POST(makeRequest({ logoUrl: 'https://mine.example.com/logo.png', primary: '#ff0000' }, 'Bearer valid'));
    const overrideBody = await overrideRes.json();

    expect(overrideRes.status).toBe(200);
    expect(overrideBody.personalOverride).toBe(true);
    expect(state.users.agent2.logoUrl).toBe('https://mine.example.com/logo.png');
    expect(state.users.agent2.brandColors.primary).toBe('#ff0000');
    // The shared brand itself, and agent1's own account, are completely untouched.
    expect(state.agencyBrands[brandId]).toEqual(sharedBrandBefore);
    expect(state.users.agent1.logoUrl).toBeUndefined();
  });

  it('a personal override can change just the logo, leaving colours untouched, once already linked to a shared brand', async () => {
    setupValidAuth('agent1');
    const { POST } = await import('../../src/app/api/branding/confirm/route');
    const createRes = await POST(makeRequest({ name: 'Harcourts Property Hub', primary: '#011d47' }, 'Bearer valid'));
    const { brandId } = await createRes.json();

    const overrideRes = await POST(makeRequest({ logoUrl: 'https://mine.example.com/logo.png' }, 'Bearer valid'));
    expect(overrideRes.status).toBe(200);
    expect(state.users.agent1.logoUrl).toBe('https://mine.example.com/logo.png');
    expect(state.users.agent1.brandColors).toBeUndefined();
  });
});

describe('POST /api/branding/reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns 401 without auth', async () => {
    const { POST } = await import('../../src/app/api/branding/reset/route');
    const res = await POST(makeRequest(undefined, undefined));
    expect(res.status).toBe(401);
  });

  it('"Reset to Agency Branding": clears the caller\'s personal override, leaves agencyBrandId and other fields untouched', async () => {
    setupValidAuth('agent1');
    state.users.agent1 = {
      firstName: 'Jo',
      agencyBrandId: 'harcourts-property-hub',
      logoUrl: 'https://mine.example.com/logo.png',
      brandColors: { primary: '#ff0000' },
    };
    const { POST } = await import('../../src/app/api/branding/reset/route');
    const res = await POST(makeRequest(undefined, 'Bearer valid'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(state.users.agent1.logoUrl).toBeUndefined();
    expect(state.users.agent1.brandColors).toBeUndefined();
    expect(state.users.agent1.agencyBrandId).toBe('harcourts-property-hub');
    expect(state.users.agent1.firstName).toBe('Jo');
  });

  it('never affects another agent\'s account or the shared brand', async () => {
    setupValidAuth('agent2');
    state.agencyBrands['shared-agency'] = { name: 'Shared Agency', colors: { primary: '#011d47' }, logoUrl: 'https://shared.example.com/logo.png' };
    state.users.agent1 = { agencyBrandId: 'shared-agency', logoUrl: 'https://agent1.example.com/logo.png' };
    state.users.agent2 = { agencyBrandId: 'shared-agency', logoUrl: 'https://agent2.example.com/logo.png', brandColors: { primary: '#ff0000' } };

    const { POST } = await import('../../src/app/api/branding/reset/route');
    await POST(makeRequest(undefined, 'Bearer valid'));

    expect(state.users.agent2.logoUrl).toBeUndefined();
    expect(state.users.agent1.logoUrl).toBe('https://agent1.example.com/logo.png'); // untouched
    expect(state.agencyBrands['shared-agency'].logoUrl).toBe('https://shared.example.com/logo.png'); // untouched
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

  it('returns brand: null and an empty personalOverride for a plain existing agent with no company name and no brand (unaffected by this feature)', async () => {
    setupValidAuth('agent1');
    state.users.agent1 = { firstName: 'Existing', roles: ['agent'] };
    const { GET } = await import('../../src/app/api/branding/mine/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'));
    const body = await res.json();
    expect(body.brand).toBeNull();
    expect(body.personalOverride).toEqual({ logoUrl: null, colors: null });
  });

  it('CORE RULE: automatically JOINS an existing brand on a companyName match — no click, no review, no "suggestion" step', async () => {
    state.agencyBrands['harcourts-property-hub'] = { name: 'Harcourts Property Hub', colors: { primary: '#011d47' }, createdBy: 'agent1' };
    state.users.agent2 = { companyName: 'Harcourts Property Hub' };

    setupValidAuth('agent2');
    const { GET } = await import('../../src/app/api/branding/mine/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'));
    const body = await res.json();

    expect(body.brand?.name).toBe('Harcourts Property Hub');
    expect(state.users.agent2.agencyBrandId).toBe('harcourts-property-hub'); // automatically linked, no agent action required
  });

  it('returns the caller\'s own personal override alongside the shared brand', async () => {
    state.agencyBrands['shared-agency'] = { name: 'Shared Agency', colors: { primary: '#011d47' }, logoUrl: 'https://shared.example.com/logo.png' };
    state.users.agent1 = {
      agencyBrandId: 'shared-agency',
      logoUrl: 'https://mine.example.com/logo.png',
      brandColors: { primary: '#ff0000' },
    };
    setupValidAuth('agent1');
    const { GET } = await import('../../src/app/api/branding/mine/route');
    const res = await GET(makeRequest(undefined, 'Bearer valid', 'GET'));
    const body = await res.json();

    expect(body.brand.name).toBe('Shared Agency');
    expect(body.personalOverride).toEqual({ logoUrl: 'https://mine.example.com/logo.png', colors: { primary: '#ff0000' } });
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
    expect(body.personalOverride).toEqual({ logoUrl: null, colors: null });
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
