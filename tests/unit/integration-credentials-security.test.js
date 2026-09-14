import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression tests for security audit Finding 3: third-party integration
// credentials (Rex/Agentbox) must never live on the publicly-readable
// `users` document. They now live in the server-only
// `integrationCredentials` collection (allow read, write: if false in
// firestore.rules).

const state = { integrationCredentials: {}, users: {} };

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'integrationCredentials') {
        return {
          doc: (id) => ({
            get: vi.fn().mockImplementation(async () => (
              state.integrationCredentials[id]
                ? { exists: true, data: () => state.integrationCredentials[id] }
                : { exists: false }
            )),
            set: vi.fn().mockImplementation(async (data, opts) => {
              const existing = state.integrationCredentials[id] || {};
              if (opts?.merge) {
                for (const key of Object.keys(data)) {
                  existing[key] = { ...(existing[key] || {}), ...data[key] };
                }
                state.integrationCredentials[id] = existing;
              } else {
                state.integrationCredentials[id] = data;
              }
            }),
          }),
        };
      }
      if (name === 'users') {
        return {
          doc: (id) => ({
            get: vi.fn().mockImplementation(async () => (
              state.users[id]
                ? { exists: true, data: () => state.users[id] }
                : { exists: false }
            )),
            update: vi.fn().mockImplementation(async (patch) => {
              const existing = state.users[id] || {};
              for (const [path, value] of Object.entries(patch)) {
                // Only need to support the exact dotted paths this code uses.
                if (path === 'integrations.rex' || path === 'integrations.agentbox') {
                  existing.integrations = existing.integrations || {};
                  const key = path.split('.')[1];
                  if (value && value.__delete) {
                    delete existing.integrations[key];
                  } else {
                    existing.integrations[key] = value;
                  }
                }
              }
              state.users[id] = existing;
            }),
          }),
        };
      }
      throw new Error(`Unexpected collection in test: ${name}`);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'TIMESTAMP',
    delete: () => ({ __delete: true }),
  },
}));

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

function resetState() {
  state.integrationCredentials = {};
  state.users = {};
}

describe('rexService — credential storage location', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('storeCredentials writes to integrationCredentials, not the public users document', async () => {
    const { storeCredentials } = await import('../../src/app/api/services/rexService');
    await storeCredentials('agent1', 'client-x', 'secret-x', { offices: [] });

    expect(state.integrationCredentials.agent1?.rex?.clientSecret).toBe('secret-x');
    expect(state.users.agent1?.integrations?.rex).toBeUndefined();
  });

  it('storeCredentials clears any pre-existing legacy copy on the users document', async () => {
    state.users.agent1 = { integrations: { rex: { clientSecret: 'old-leaked-secret' } } };
    const { storeCredentials } = await import('../../src/app/api/services/rexService');
    await storeCredentials('agent1', 'client-x', 'new-secret', {});

    expect(state.users.agent1.integrations.rex).toBeUndefined();
    expect(state.integrationCredentials.agent1.rex.clientSecret).toBe('new-secret');
  });

  it('getCredentials reads the secure location first', async () => {
    state.integrationCredentials.agent1 = { rex: { clientSecret: 'secure-secret', status: 'connected' } };
    state.users.agent1 = { integrations: { rex: { clientSecret: 'stale-legacy-secret' } } };
    const { getCredentials } = await import('../../src/app/api/services/rexService');
    const creds = await getCredentials('agent1');

    expect(creds.clientSecret).toBe('secure-secret');
  });

  it('getCredentials falls back to the legacy location for not-yet-migrated agents', async () => {
    state.users.agent1 = { integrations: { rex: { clientSecret: 'legacy-secret', status: 'connected' } } };
    const { getCredentials } = await import('../../src/app/api/services/rexService');
    const creds = await getCredentials('agent1');

    expect(creds.clientSecret).toBe('legacy-secret');
  });

  it('getCredentials returns null when nothing exists anywhere', async () => {
    const { getCredentials } = await import('../../src/app/api/services/rexService');
    expect(await getCredentials('nobody')).toBeNull();
  });
});

describe('agentboxService — credential storage location', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('storeCredentials writes to integrationCredentials, not the public users document', async () => {
    const { storeCredentials } = await import('../../src/app/api/services/agentboxService');
    await storeCredentials('agent2', 'client-y', 'api-key-y', []);

    expect(state.integrationCredentials.agent2?.agentbox?.apiKey).toBe('api-key-y');
    expect(state.users.agent2?.integrations?.agentbox).toBeUndefined();
  });

  it('getCredentials falls back to the legacy location for not-yet-migrated agents', async () => {
    state.users.agent2 = { integrations: { agentbox: { apiKey: 'legacy-key', status: 'connected' } } };
    const { getCredentials } = await import('../../src/app/api/services/agentboxService');
    const creds = await getCredentials('agent2');

    expect(creds.apiKey).toBe('legacy-key');
  });
});

describe('GET /api/integrations/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  function makeRequest(authHeader) {
    const headers = new Headers();
    if (authHeader) headers.set('authorization', authHeader);
    return new Request('http://localhost/test', { method: 'GET', headers });
  }

  it('returns 401 without auth', async () => {
    const { GET } = await import('../../src/app/api/integrations/status/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('never includes credential values, only status metadata', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1', email: 'a@example.com' });
    state.integrationCredentials.agent1 = {
      rex: { clientId: 'rex-client', clientSecret: 'rex-secret', accessToken: 'rex-token', status: 'connected', mode: 'real' },
      agentbox: { clientId: 'ab-client', apiKey: 'ab-secret', status: 'connected' },
    };

    const { GET } = await import('../../src/app/api/integrations/status/route');
    const res = await GET(makeRequest('Bearer valid'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rex.status).toBe('connected');
    expect(body.agentbox.status).toBe('connected');

    const raw = JSON.stringify(body);
    expect(raw).not.toContain('rex-secret');
    expect(raw).not.toContain('rex-token');
    expect(raw).not.toContain('rex-client');
    expect(raw).not.toContain('ab-secret');
    expect(raw).not.toContain('ab-client');
  });

  it('returns null for integrations the agent has never connected', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent-fresh', email: 'a@example.com' });
    const { GET } = await import('../../src/app/api/integrations/status/route');
    const res = await GET(makeRequest('Bearer valid'));
    const body = await res.json();
    expect(body.rex).toBeNull();
    expect(body.agentbox).toBeNull();
  });
});
