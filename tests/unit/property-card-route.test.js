import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin/auth — same pattern as tests/unit/integration-routes.test.js
const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const state = { properties: {}, users: {}, offers: [] };

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'properties') {
        return {
          doc: (id) => ({
            get: vi.fn().mockResolvedValue(
              state.properties[id]
                ? { exists: true, data: () => state.properties[id] }
                : { exists: false }
            ),
          }),
        };
      }
      if (name === 'users') {
        return {
          doc: (id) => ({
            get: vi.fn().mockResolvedValue(
              state.users[id]
                ? { exists: true, data: () => state.users[id] }
                : { exists: false }
            ),
          }),
        };
      }
      if (name === 'offers') {
        return {
          where: () => ({
            get: vi.fn().mockResolvedValue({ docs: state.offers.map((o) => ({ data: () => o })) }),
          }),
        };
      }
      throw new Error(`Unexpected collection in test: ${name}`);
    },
  },
}));

// sharp is a native binary module — mock it so tests never touch real
// image processing. Each top-level sharp(...) call returns a fresh
// chainable object, matching how the route uses it (resize().toBuffer(),
// then a separate composite().png().toBuffer()).
// sharp is a native binary module, mocked here so these tests never touch
// real image/font processing. Supports both usages the renderer needs:
// sharp(buffer).resize()/composite()/png().toBuffer(), and
// sharp({ text: {...} }).png().toBuffer() followed by
// sharp(buffer).metadata() to measure the rendered text size.
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-png-bytes')),
    metadata: vi.fn().mockResolvedValue({ width: 200, height: 60 }),
  })),
}));

function makeRequest(body, authHeader) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method: 'POST', headers, body: JSON.stringify(body) });
}

function setupValidAuth(uid = 'agent1') {
  mockVerifyIdToken.mockResolvedValue({ uid, email: 'agent@example.com' });
}

describe('POST /api/reports/property-card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.properties = {};
    state.users = {};
    state.offers = [];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  });

  it('returns 401 without an auth token', async () => {
    const { POST } = await import('../../src/app/api/reports/property-card/route.js');
    const res = await POST(makeRequest({ propertyId: 'p1' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when propertyId is missing', async () => {
    setupValidAuth();
    const { POST } = await import('../../src/app/api/reports/property-card/route.js');
    const res = await POST(makeRequest({}, 'Bearer valid'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the property does not exist', async () => {
    setupValidAuth();
    const { POST } = await import('../../src/app/api/reports/property-card/route.js');
    const res = await POST(makeRequest({ propertyId: 'missing' }, 'Bearer valid'));
    expect(res.status).toBe(404);
  });

  it('returns 403 when the caller neither owns the property nor is a superAdmin', async () => {
    setupValidAuth('someone-else');
    state.properties.p1 = { userId: 'owner1', imageUrls: ['https://cdn.example/img.jpg'] };
    state.users['someone-else'] = { superAdmin: false };
    const { POST } = await import('../../src/app/api/reports/property-card/route.js');
    const res = await POST(makeRequest({ propertyId: 'p1' }, 'Bearer valid'));
    expect(res.status).toBe(403);
  });

  it('allows a superAdmin to generate a card for a property they do not own', async () => {
    setupValidAuth('admin1');
    state.properties.p1 = { userId: 'owner1', imageUrls: ['https://cdn.example/img.jpg'], stats: { views: 10 } };
    state.users.admin1 = { superAdmin: true };
    const { POST } = await import('../../src/app/api/reports/property-card/route.js');
    const res = await POST(makeRequest({ propertyId: 'p1' }, 'Bearer valid'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('returns 400 when the property has no photos, without attempting generation', async () => {
    setupValidAuth('owner1');
    state.properties.p1 = { userId: 'owner1' }; // no imageUrls/imageUrl/images
    const { POST } = await import('../../src/app/api/reports/property-card/route.js');
    const res = await POST(makeRequest({ propertyId: 'p1' }, 'Bearer valid'));
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 502 when the hero image fails to download', async () => {
    setupValidAuth('owner1');
    state.properties.p1 = { userId: 'owner1', imageUrls: ['https://cdn.example/img.jpg'] };
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const { POST } = await import('../../src/app/api/reports/property-card/route.js');
    const res = await POST(makeRequest({ propertyId: 'p1' }, 'Bearer valid'));
    expect(res.status).toBe(502);
  });

  it('generates a PNG for the owner, reading the same offers the Report reads, and writes nothing', async () => {
    setupValidAuth('owner1');
    state.properties.p1 = {
      userId: 'owner1',
      formattedAddress: '12 Main St, Sydney NSW 2000',
      imageUrls: ['https://cdn.example/img.jpg'],
      stats: { views: 42 },
    };
    state.offers = [
      { type: 'opinion', serious: true, offerAmount: 900000 },
      { type: 'opinion', serious: false, offerAmount: 850000 },
    ];
    const { POST } = await import('../../src/app/api/reports/property-card/route.js');
    const res = await POST(makeRequest({ propertyId: 'p1' }, 'Bearer valid'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(global.fetch).toHaveBeenCalledWith('https://cdn.example/img.jpg');
  });
});
