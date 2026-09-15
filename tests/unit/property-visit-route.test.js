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
      const topPatch = {};
      for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith('stats.')) {
          statsPatch[key.slice(6)] = value;
        } else {
          topPatch[key] = value;
        }
      }
      applyIncrementPatch(next.stats, statsPatch);
      applyIncrementPatch(next, topPatch);
      state.properties[id] = next;
    }),
  };
}

function makeSessionDocRef(id) {
  return {
    get: vi.fn(async () => {
      const data = state.propertyViewSessions[id];
      return data ? { exists: true, data: () => data } : { exists: false };
    }),
    set: vi.fn(async (data, opts) => {
      const current = (opts && opts.merge && state.propertyViewSessions[id]) || {};
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
      if (name === 'propertyViews') {
        return {
          add: vi.fn(async (data) => {
            state.propertyViews.push(data);
          }),
        };
      }
      if (name === 'propertyViewSessions') return { doc: (id) => makeSessionDocRef(id) };
      throw new Error(`Unexpected collection: ${name}`);
    },
    runTransaction: vi.fn(async (fn) => {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => {
          ref.set(data, opts);
        },
      };
      return fn(tx);
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'TIMESTAMP',
    increment: (n) => ({ __op: 'increment', n }),
  },
  Timestamp: {
    fromDate: (d) => ({ __isTimestamp: true, toDate: () => d }),
  },
}));

function makeRequest(body, userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36') {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (userAgent !== null) headers.set('user-agent', userAgent);
  return new Request('http://localhost/api/property-visit', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function resetState() {
  state.properties = {};
  state.propertyViews = [];
  state.propertyViewSessions = {};
}

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

describe('POST /api/property-visit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  });

  it('a first visit increments legacy stats and starts sessionCount 1', async () => {
    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(makeRequest({ propertyId: 'p1', visitorId: 'v1', isReturn: false }));
    expect(res.status).toBe(200);

    expect(state.properties.p1.stats.views).toBe(1);
    expect(state.properties.p1.stats.uniqueViews).toBe(1);
    expect(state.propertyViews).toHaveLength(1);
    expect(state.propertyViews[0]).toMatchObject({ propertyId: 'p1', visitorId: 'v1', scannerSuspected: false });

    const session = state.propertyViewSessions['p1_v1'];
    expect(session.sessionCount).toBe(1);
    expect(session.totalOpens).toBe(1);
  });

  it('a second call moments later (refresh) does not start a new session, but does increment legacy views', async () => {
    const { POST } = await import('../../src/app/api/property-visit/route');
    await POST(makeRequest({ propertyId: 'p1', visitorId: 'v1', isReturn: false }));
    await POST(makeRequest({ propertyId: 'p1', visitorId: 'v1', isReturn: true }));

    expect(state.properties.p1.stats.views).toBe(2);
    const session = state.propertyViewSessions['p1_v1'];
    expect(session.sessionCount).toBe(1);
    expect(session.totalOpens).toBe(2);
  });

  it('a call after the 10 minute inactivity window increments sessionCount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T08:00:00Z'));
    const { POST } = await import('../../src/app/api/property-visit/route');
    await POST(makeRequest({ propertyId: 'p1', visitorId: 'v1', isReturn: false }));

    vi.setSystemTime(new Date('2026-01-01T08:25:00Z'));
    await POST(makeRequest({ propertyId: 'p1', visitorId: 'v1', isReturn: true }));
    vi.useRealTimers();

    const session = state.propertyViewSessions['p1_v1'];
    expect(session.sessionCount).toBe(2);
    expect(session.totalOpens).toBe(2);
  });

  it('a scanner User-Agent still increments legacy stats.views but is excluded from session/opens counters', async () => {
    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(
      makeRequest({ propertyId: 'p1', visitorId: 'v-scanner', isReturn: false }, 'facebookexternalhit/1.1')
    );
    expect(res.status).toBe(200);

    // Legacy counter behaves exactly as it always has — unaffected by scanner detection.
    expect(state.properties.p1.stats.views).toBe(1);

    expect(state.propertyViews[0].scannerSuspected).toBe(true);

    const session = state.propertyViewSessions['p1_v-scanner'];
    expect(session.sessionCount).toBeUndefined();
    expect(session.totalOpens).toBeUndefined();
    expect(session.scannerSuspectedOpens).toBe(1);
  });

  it('an anonymous visitor (no visitorId) still increments legacy stats but writes no propertyViews/session doc', async () => {
    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(makeRequest({ propertyId: 'p1', isReturn: false }));
    expect(res.status).toBe(200);
    expect(state.properties.p1.stats.views).toBe(1);
    expect(state.propertyViews).toHaveLength(0);
    expect(Object.keys(state.propertyViewSessions)).toHaveLength(0);
  });

  it('VERCEL_ENV=preview makes zero Firestore writes of any kind', async () => {
    process.env.VERCEL_ENV = 'preview';
    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(makeRequest({ propertyId: 'p1', visitorId: 'v1', isReturn: false }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skipped).toBeTruthy();
    expect(state.properties).toEqual({});
    expect(state.propertyViews).toHaveLength(0);
    expect(Object.keys(state.propertyViewSessions)).toHaveLength(0);
  });

  it('propertyId is still required (unchanged existing validation)', async () => {
    const { POST } = await import('../../src/app/api/property-visit/route');
    const res = await POST(makeRequest({ visitorId: 'v1' }));
    expect(res.status).toBe(400);
  });
});
