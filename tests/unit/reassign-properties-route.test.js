import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = { properties: {}, users: {} };
const sendOnce = vi.fn();
let admin = { authenticated: true, uid: 'admin1' };

function ref(col, id) {
  return { col, id, get: async () => ({ exists: id in store[col], data: () => store[col][id] }) };
}
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    runTransaction: async (fn) => fn({
      get: async (r) => r.get(),
      update: (r, u) => { store[r.col][r.id] = { ...store[r.col][r.id], ...u }; },
    }),
  },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));
vi.mock('../../src/app/api/middleware/auth', () => ({ verifyAdmin: async () => admin }));
vi.mock('../../src/app/api/services/notificationService', () => ({ sendPropertyReadyOnce: (...a) => sendOnce(...a) }));

const { POST } = await import('../../src/app/api/admin/reassign-properties/route');
const call = (body) => POST(new Request('http://x/api/admin/reassign-properties', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  store.properties = { p1: { userId: 'old' }, p2: { userId: 'old' }, p3: { userId: 'agent9' } };
  store.users = { agent9: { email: 'a@example.com' }, other: { email: 'o@example.com' } };
  sendOnce.mockReset();
  sendOnce.mockResolvedValue({ sent: true });
  admin = { authenticated: true, uid: 'admin1' };
});

describe('POST /api/admin/reassign-properties', () => {
  it('requires a superAdmin', async () => {
    admin = { authenticated: false, error: 'Forbidden', status: 403 };
    expect((await call({ propertyIds: ['p1'], targetUserId: 'agent9' })).status).toBe(403);
  });

  it('does not email unless notify:true is passed (bulk clean-ups stay silent)', async () => {
    const res = await call({ propertyIds: ['p1', 'p2'], targetUserId: 'agent9' });
    const body = await res.json();
    expect(body).toMatchObject({ changed: 2, notified: 0 });
    expect(sendOnce).not.toHaveBeenCalled();
    expect(store.properties.p1).toMatchObject({ userId: 'agent9', ownership: { seq: 1, userId: 'agent9', by: 'admin1' } });
  });

  it('with notify:true sends exactly one notification per changed property', async () => {
    const body = await (await call({ propertyIds: ['p1', 'p2', 'p1'], targetUserId: 'agent9', notify: true })).json();
    expect(body).toMatchObject({ changed: 2, unchanged: 0, notified: 2 });
    expect(sendOnce).toHaveBeenCalledTimes(2);
    expect(sendOnce).toHaveBeenCalledWith({ propertyId: 'p1', recipientUid: 'agent9', seq: 1 });
  });

  it('re-submitting the same request is not a new event: it can only RETRY the existing one', async () => {
    await call({ propertyIds: ['p1'], targetUserId: 'agent9', notify: true });
    sendOnce.mockClear();
    sendOnce.mockResolvedValue({ sent: false, reason: 'sent' }); // already delivered
    const body = await (await call({ propertyIds: ['p1'], targetUserId: 'agent9', notify: true })).json();
    expect(body).toMatchObject({ changed: 0, unchanged: 1, notified: 0 });
    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect(sendOnce).toHaveBeenCalledWith({ propertyId: 'p1', recipientUid: 'agent9', seq: 1, retryOnly: true });
    expect(store.properties.p1.ownership.seq).toBe(1);
  });

  it('a property already owned before any assignment event (no seq) is never emailed', async () => {
    const body = await (await call({ propertyIds: ['p3'], targetUserId: 'agent9', notify: true })).json();
    expect(body).toMatchObject({ changed: 0, unchanged: 1, notified: 0 });
    expect(sendOnce).not.toHaveBeenCalled();
  });

  it('a failed notification is retried by repeating the request', async () => {
    sendOnce.mockResolvedValueOnce({ sent: false, reason: 'send-failed' });
    await call({ propertyIds: ['p1'], targetUserId: 'agent9', notify: true });
    sendOnce.mockClear();
    sendOnce.mockResolvedValue({ sent: true });
    const body = await (await call({ propertyIds: ['p1'], targetUserId: 'agent9', notify: true })).json();
    expect(body.notified).toBe(1);
  });

  it('refuses to notify for a bulk request (clean-ups / migrations stay silent)', async () => {
    const ids = Array.from({ length: 26 }, (_, i) => `b${i}`);
    ids.forEach((id) => { store.properties[id] = { userId: 'old' }; });
    const res = await call({ propertyIds: ids, targetUserId: 'agent9', notify: true });
    expect(res.status).toBe(400);
    expect(Object.values(store.properties).filter((p) => p.userId === 'agent9')).toHaveLength(1); // nothing moved (p3 only)
    const silent = await call({ propertyIds: ids, targetUserId: 'agent9' });
    expect(silent.status).toBe(200);
    expect(sendOnce).not.toHaveBeenCalled();
  });

  it('a genuine later reassignment (including back to a previous owner) is a new event', async () => {
    await call({ propertyIds: ['p1'], targetUserId: 'agent9', notify: true });
    await call({ propertyIds: ['p1'], targetUserId: 'other', notify: true });
    await call({ propertyIds: ['p1'], targetUserId: 'agent9', notify: true });
    expect(sendOnce.mock.calls.map(([a]) => [a.recipientUid, a.seq])).toEqual([['agent9', 1], ['other', 2], ['agent9', 3]]);
  });

  it('an email failure never fails the reassignment', async () => {
    sendOnce.mockResolvedValue({ sent: false, reason: 'unsubscribed' });
    const res = await call({ propertyIds: ['p1'], targetUserId: 'agent9', notify: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ changed: 1, notified: 0, notificationSkips: [{ propertyId: 'p1', reason: 'unsubscribed' }] });
    expect(store.properties.p1.userId).toBe('agent9');
  });

  it('reports missing properties instead of failing the whole request', async () => {
    const body = await (await call({ propertyIds: ['p1', 'nope'], targetUserId: 'agent9' })).json();
    expect(body).toMatchObject({ changed: 1, missing: 1 });
  });

  it('validates input', async () => {
    expect((await call({ propertyIds: [], targetUserId: 'agent9' })).status).toBe(400);
    expect((await call({ propertyIds: ['p1'] })).status).toBe(400);
    expect((await call({ propertyIds: ['p1'], targetUserId: 'ghost' })).status).toBe(404);
    expect((await call({ propertyIds: Array.from({ length: 201 }, (_, i) => `p${i}`), targetUserId: 'agent9' })).status).toBe(400);
  });
});
