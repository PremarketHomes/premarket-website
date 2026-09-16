import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = { properties: {}, propertyViews: [], propertyViewSessions: {} };

function applyIncrementPatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && value.__op === 'increment') {
      target[key] = (target[key] || 0) + value.n;
    } else {
      target[key] = value;
    }
  }
}

function makePropertyDocRef(id) {
  return {
    update: vi.fn(async (patch) => {
      const current = state.properties[id] || { stats: {} };
      const next = { ...current, stats: { ...current.stats } };
      const statsPatch = {};
      for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith('stats.')) statsPatch[key.slice(6)] = value;
      }
      applyIncrementPatch(next.stats, statsPatch);
      state.properties[id] = next;
    }),
  };
}

function makeSessionDocRef(id) {
  return {
    get: vi.fn(async () => (state.propertyViewSessions[id] ? { exists: true, data: () => state.propertyViewSessions[id] } : { exists: false })),
    set: vi.fn(async (data, opts) => {
      const current = (opts?.merge && state.propertyViewSessions[id]) || {};
      const merged = { ...current };
      applyIncrementPatch(merged, data);
      state.propertyViewSessions[id] = merged;
    }),
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'properties') return { doc: (id) => makePropertyDocRef(id) };
      if (name === 'propertyViews') return { add: vi.fn(async (data) => { state.propertyViews.push(data); }) };
      if (name === 'propertyViewSessions') return { doc: (id) => makeSessionDocRef(id) };
      throw new Error(`Unexpected collection: ${name}`);
    },
    runTransaction: vi.fn(async (fn) => {
      const tx = { get: (ref) => ref.get(), set: (ref, data, opts) => { ref.set(data, opts); } };
      return fn(tx);
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP', increment: (n) => ({ __op: 'increment', n }) },
  Timestamp: { fromDate: (d) => ({ __isTimestamp: true, toDate: () => d }) },
}));

const mockResolveRecipientToken = vi.fn();
const mockRecordRecipientEngagement = vi.fn();
vi.mock('../../src/app/api/services/recipientLinkService', () => ({
  resolveRecipientToken: (...args) => mockResolveRecipientToken(...args),
  recordRecipientEngagement: (...args) => mockRecordRecipientEngagement(...args),
}));

function makeRequest({ body, cookie, userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36' }) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (userAgent) headers.set('user-agent', userAgent);
  if (cookie) headers.set('cookie', cookie);
  return new Request('http://localhost/api/property-visit', { method: 'POST', headers, body: JSON.stringify(body) });
}

function resetState() {
  state.properties = { p1: { stats: {} } };
  state.propertyViews = [];
  state.propertyViewSessions = {};
}

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

describe('POST /api/property-visit — Phase 2 recipient attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  });

  it('an ordinary anonymous open (no rlt) never calls the recipient resolver and behaves exactly as before', async () => {
    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1', isReturn: false } }));

    expect(res.status).toBe(200);
    expect(mockResolveRecipientToken).not.toHaveBeenCalled();
    expect(mockRecordRecipientEngagement).not.toHaveBeenCalled();
    expect(state.properties.p1.stats.views).toBe(1);
  });

  it('a valid recipient token attributes engagement and sets a persistence cookie', async () => {
    mockResolveRecipientToken.mockResolvedValue({ recipientId: 'rec1', propertyId: 'p1', agencyOwnerId: 'agent1' });
    mockRecordRecipientEngagement.mockResolvedValue({ scannerSuspected: false, isNewSession: true });

    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1', isReturn: false, recipientToken: 'rl_validtoken' } }));

    expect(res.status).toBe(200);
    expect(mockResolveRecipientToken).toHaveBeenCalledWith('rl_validtoken', 'p1');
    expect(mockRecordRecipientEngagement).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'p1', recipientId: 'rec1', agencyOwnerId: 'agent1', scannerSuspected: false })
    );
    // Legacy Views counter is unaffected by attribution — still just +1 for the open.
    expect(state.properties.p1.stats.views).toBe(1);

    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('pm_rl_p1=rl_validtoken');
    expect(setCookie).toContain('HttpOnly');
  });

  it('an invalid token is ignored silently — no crash, no attribution, view tracking still succeeds', async () => {
    mockResolveRecipientToken.mockResolvedValue(null);
    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1', isReturn: false, recipientToken: 'garbage' } }));

    expect(res.status).toBe(200);
    expect(mockRecordRecipientEngagement).not.toHaveBeenCalled();
    expect(state.properties.p1.stats.views).toBe(1);
    expect(res.headers.get('set-cookie')).toBeFalsy();
  });

  it('a token issued for a different property is rejected (resolver receives the requested propertyId, not trusted blindly)', async () => {
    mockResolveRecipientToken.mockResolvedValue(null); // service itself enforces this — route just passes propertyId through
    const { POST } = await import('../../src/app/api/property-visit/route');
    await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1', recipientToken: 'rl_for_other_property' } }));

    expect(mockResolveRecipientToken).toHaveBeenCalledWith('rl_for_other_property', 'p1');
    expect(mockRecordRecipientEngagement).not.toHaveBeenCalled();
  });

  it('falls back to a previously-set cookie when no rlt is present in this request', async () => {
    mockResolveRecipientToken.mockResolvedValue({ recipientId: 'rec1', propertyId: 'p1', agencyOwnerId: 'agent1' });
    mockRecordRecipientEngagement.mockResolvedValue({ scannerSuspected: false, isNewSession: false });

    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1' }, cookie: 'pm_rl_p1=rl_validtoken; other=1' }));

    expect(mockResolveRecipientToken).toHaveBeenCalledWith('rl_validtoken', 'p1');
    expect(res.status).toBe(200);
  });

  it('a request token takes priority over an existing cookie for the same property', async () => {
    mockResolveRecipientToken.mockResolvedValue({ recipientId: 'recFresh', propertyId: 'p1', agencyOwnerId: 'agent1' });
    mockRecordRecipientEngagement.mockResolvedValue({ scannerSuspected: false, isNewSession: true });

    const { POST } = await import('../../src/app/api/property-visit/route');
    await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1', recipientToken: 'rl_fresh' }, cookie: 'pm_rl_p1=rl_stale' }));

    expect(mockResolveRecipientToken).toHaveBeenCalledWith('rl_fresh', 'p1');
  });

  it('clears the cookie when it holds a token that no longer resolves (e.g. revoked)', async () => {
    mockResolveRecipientToken.mockResolvedValue(null);
    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1' }, cookie: 'pm_rl_p1=rl_revoked' }));

    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('pm_rl_p1=;');
  });

  it('a scanner-suspected request with a valid token still resolves and records, but the service is told scannerSuspected=true', async () => {
    mockResolveRecipientToken.mockResolvedValue({ recipientId: 'rec1', propertyId: 'p1', agencyOwnerId: 'agent1' });
    mockRecordRecipientEngagement.mockResolvedValue({ scannerSuspected: true });

    const { POST } = await import('../../src/app/api/property-visit/route');
    await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1', recipientToken: 'rl_validtoken' }, userAgent: 'facebookexternalhit/1.1' }));

    expect(mockRecordRecipientEngagement).toHaveBeenCalledWith(expect.objectContaining({ scannerSuspected: true }));
  });

  it('VERCEL_ENV=preview skips recipient resolution entirely, same as everything else', async () => {
    process.env.VERCEL_ENV = 'preview';
    const { POST } = await import('../../src/app/api/property-visit/route');
    await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1', recipientToken: 'rl_validtoken' } }));

    expect(mockResolveRecipientToken).not.toHaveBeenCalled();
  });

  it('same token used twice (e.g. forwarded to another person) attributes both opens to the same recipient — no attempt to distinguish who physically clicked', async () => {
    mockResolveRecipientToken.mockResolvedValue({ recipientId: 'rec1', propertyId: 'p1', agencyOwnerId: 'agent1' });
    mockRecordRecipientEngagement.mockResolvedValue({ scannerSuspected: false, isNewSession: false });

    const { POST } = await import('../../src/app/api/property-visit/route');
    await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v1', recipientToken: 'rl_validtoken' }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36' }));
    await POST(makeRequest({ body: { propertyId: 'p1', visitorId: 'v2', recipientToken: 'rl_validtoken' }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }));

    expect(mockRecordRecipientEngagement).toHaveBeenCalledTimes(2);
    expect(mockRecordRecipientEngagement.mock.calls[0][0].recipientId).toBe('rec1');
    expect(mockRecordRecipientEngagement.mock.calls[1][0].recipientId).toBe('rec1');
  });
});
