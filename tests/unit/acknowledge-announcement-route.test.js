import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

function makeFakeDb() {
  const store = {};
  return {
    collection(name) {
      store[name] = store[name] || {};
      return {
        doc(id) {
          return {
            async update(patch) {
              if (!store[name][id]) {
                const err = new Error('NOT_FOUND');
                err.code = 5;
                throw err;
              }
              // Mirror Firestore's real dot-path merge behaviour for
              // this test's purposes: a key containing '.' sets a
              // nested value without touching sibling keys.
              for (const [path, value] of Object.entries(patch)) {
                const parts = path.split('.');
                let target = store[name][id];
                for (let i = 0; i < parts.length - 1; i++) {
                  target[parts[i]] = target[parts[i]] || {};
                  target = target[parts[i]];
                }
                target[parts[parts.length - 1]] = value;
              }
            },
            async get() {
              const data = store[name][id];
              return { exists: !!data, data: () => data };
            },
          };
        },
      };
    },
    _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; },
    _store: store,
  };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

function makeRequest(body, authHeader) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method: 'POST', headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
});

describe('POST /api/users/acknowledge-announcement', () => {
  it('401s with no auth header, and never writes anything', async () => {
    const { POST } = await import('../../src/app/api/users/acknowledge-announcement/route.js');
    const res = await POST(makeRequest({ announcementId: 'billing-announcement-v1' }));
    expect(res.status).toBe(401);
  });

  it('400s for an unknown announcementId, even when authenticated', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', {});
    const { POST } = await import('../../src/app/api/users/acknowledge-announcement/route.js');
    const res = await POST(makeRequest({ announcementId: 'not-a-real-announcement' }, 'Bearer t'));
    expect(res.status).toBe(400);
  });

  it('records the acknowledgement against the AUTHENTICATED caller only, ignoring any uid in the body', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', {});
    fakeDb._seed('users', 'agent2', {});

    const { POST } = await import('../../src/app/api/users/acknowledge-announcement/route.js');
    // Even if a malicious or buggy client sent a different uid, there is
    // no such field this route reads at all — it only uses auth.uid.
    const res = await POST(makeRequest({ announcementId: 'billing-announcement-v1', uid: 'agent2' }, 'Bearer t'));
    expect(res.status).toBe(200);

    expect(fakeDb._store.users.agent1.acknowledgedAnnouncements['billing-announcement-v1']).toBeTruthy();
    // The other agent's doc is completely untouched.
    expect(fakeDb._store.users.agent2.acknowledgedAnnouncements).toBeUndefined();
  });

  it('acknowledging one announcement never clobbers a different, already-acknowledged announcement', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { acknowledgedAnnouncements: { 'some-older-announcement-v1': 'TIMESTAMP' } });

    const { POST } = await import('../../src/app/api/users/acknowledge-announcement/route.js');
    await POST(makeRequest({ announcementId: 'billing-announcement-v1' }, 'Bearer t'));

    const acks = fakeDb._store.users.agent1.acknowledgedAnnouncements;
    expect(acks['some-older-announcement-v1']).toBe('TIMESTAMP');
    expect(acks['billing-announcement-v1']).toBeTruthy();
  });

  it('is safe to call twice — the second call is a harmless no-op, not an error', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', {});

    const { POST } = await import('../../src/app/api/users/acknowledge-announcement/route.js');
    const first = await POST(makeRequest({ announcementId: 'billing-announcement-v1' }, 'Bearer t'));
    const second = await POST(makeRequest({ announcementId: 'billing-announcement-v1' }, 'Bearer t'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
