import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

// Incident, Nov 2026: automatic photo compression is paused by default (it rewrites listings' imageUrls while legacy photos
// are being migrated), and /api/images/compress no longer accepts anonymous callers.

const state = { verify: null, role: null, docs: {}, updates: [], collections: [], fetches: 0 };

vi.mock('../../src/app/firebase/adminApp', () => {
  const col = (name) => {
    state.collections.push(name);
    const empty = { get: async () => ({ docs: [] }) };
    return {
      doc: (id) => ({
        get: async () => { const d = state.docs[`${name}/${id}`]; return { exists: !!d, data: () => d }; },
        update: async (patch) => { state.updates.push({ path: `${name}/${id}`, patch }); },
      }),
      where: () => ({ limit: () => empty }),
      orderBy: () => ({ limit: () => empty }),
      get: async () => ({ docs: [] }),
    };
  };
  return { adminDb: { collection: col, batch: () => ({ update() {}, commit: async () => {} }) } };
});
vi.mock('../../src/app/api/middleware/auth', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: async () => state.verify,
}));
vi.mock('../../src/app/api/services/managedCampaignService', () => ({
  resolveCampaignRole: async () => state.role,
}));
vi.mock('sharp', () => ({ default: () => ({ resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from('x') }) }) }) }));

const SIGNED_IN = { authenticated: true, uid: 'agent-1', email: null };
const ANON = { authenticated: false, error: 'Missing or invalid Authorization header', status: 401 };
const BUNNY = 'https://premarketvideos.b-cdn.net/images/p1/a.jpg';

const post = (body = { propertyId: 'p1' }) => new Request('http://localhost/api/images/compress', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const cron = (path) => new Request(`http://localhost${path}`, { headers: { authorization: 'Bearer test-secret' } });

let env;
beforeEach(() => {
  env = { ...process.env };
  process.env.CRON_SECRET = 'test-secret';
  delete process.env.IMAGE_COMPRESSION_ENABLED;
  Object.assign(state, { verify: SIGNED_IN, role: null, docs: {}, updates: [], collections: [], fetches: 0 });
  vi.stubGlobal('fetch', async () => { state.fetches++; return new Response('', { status: 500 }); });
});
afterEach(() => { process.env = env; vi.unstubAllGlobals(); });

describe('imageCompressionEnabled', () => {
  it('is off unless IMAGE_COMPRESSION_ENABLED is exactly "true"', async () => {
    const { imageCompressionEnabled } = await import('../../src/app/api/services/imageCompression.js');
    expect(imageCompressionEnabled({})).toBe(false);
    expect(imageCompressionEnabled({ IMAGE_COMPRESSION_ENABLED: '1' })).toBe(false);
    expect(imageCompressionEnabled({ IMAGE_COMPRESSION_ENABLED: 'TRUE' })).toBe(false);
    expect(imageCompressionEnabled({ IMAGE_COMPRESSION_ENABLED: 'true' })).toBe(true);
  });
});

describe('/api/cron/compress-images', () => {
  it('still refuses a request without the cron secret', async () => {
    const { GET } = await import('../../src/app/api/cron/compress-images/route.js');
    const res = await GET(new Request('http://localhost/x'));
    expect(res.status).toBe(401);
    expect(state.collections).toEqual([]);
  });

  it('is paused by default: reads and writes nothing', async () => {
    const { GET } = await import('../../src/app/api/cron/compress-images/route.js');
    const res = await GET(cron('/api/cron/compress-images'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paused: true, processed: 0 });
    expect(state.collections).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it('runs again once IMAGE_COMPRESSION_ENABLED=true', async () => {
    process.env.IMAGE_COMPRESSION_ENABLED = 'true';
    const { GET } = await import('../../src/app/api/cron/compress-images/route.js');
    const res = await GET(cron('/api/cron/compress-images'));
    expect(await res.json()).toMatchObject({ processed: 0 });
    expect(state.collections).toContain('properties');
  });
});

describe('/api/images/backfill-compress', () => {
  it('is paused by default: flags nothing', async () => {
    const { GET } = await import('../../src/app/api/images/backfill-compress/route.js');
    const res = await GET(cron('/api/images/backfill-compress'));
    expect(await res.json()).toMatchObject({ paused: true, flagged: 0 });
    expect(state.collections).toEqual([]);
  });
});

describe('/api/images/compress', () => {
  it('refuses anonymous callers before touching anything', async () => {
    state.verify = ANON;
    const { POST } = await import('../../src/app/api/images/compress/route.js');
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(state.collections).toEqual([]);
  });

  it('does nothing for a signed-in caller while paused', async () => {
    const { POST } = await import('../../src/app/api/images/compress/route.js');
    const res = await POST(post());
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ paused: true });
    expect(state.collections).toEqual([]);
    expect(state.fetches).toBe(0);
  });

  describe('when compression is enabled', () => {
    beforeEach(() => {
      process.env.IMAGE_COMPRESSION_ENABLED = 'true';
      process.env.BUNNY_STORAGE_ACCESS_KEY = 'test-only';
      state.docs['properties/p1'] = { userId: 'owner-1', imageUrls: [BUNNY] };
    });

    it('refuses a signed-in user who cannot manage the listing', async () => {
      const { POST } = await import('../../src/app/api/images/compress/route.js');
      const res = await POST(post());
      expect(res.status).toBe(403);
      expect(state.updates).toEqual([]);
    });

    it('refuses an unknown listing the same way', async () => {
      state.role = 'owner';
      const { POST } = await import('../../src/app/api/images/compress/route.js');
      const res = await POST(post({ propertyId: 'missing' }));
      expect(res.status).toBe(403);
      expect(state.updates).toEqual([]);
    });

    it('requires a propertyId', async () => {
      const { POST } = await import('../../src/app/api/images/compress/route.js');
      expect((await POST(post({}))).status).toBe(400);
    });

    it('lets the owner / office admin / managing BSO compress', async () => {
      state.role = 'bso';
      const { POST } = await import('../../src/app/api/images/compress/route.js');
      const res = await POST(post());
      expect(res.status).toBe(200);
      expect(state.updates[0]).toEqual({ path: 'properties/p1', patch: { imageUrls: [BUNNY], imagesCompressed: true } });
    });

    it('lets a superAdmin compress', async () => {
      state.docs['users/agent-1'] = { superAdmin: true };
      const { POST } = await import('../../src/app/api/images/compress/route.js');
      expect((await POST(post())).status).toBe(200);
    });
  });
});

describe('client trigger', () => {
  it('calls /api/images/compress signed in (authFetch), never with a bare fetch', () => {
    const src = fs.readFileSync(new URL('../../src/app/utils/mediaUploadManager.js', import.meta.url), 'utf-8');
    expect(src).toContain("authFetch('/api/images/compress'");
    expect(src).not.toMatch(/[^h]fetch\('\/api\/images\/compress'/);
  });
});
