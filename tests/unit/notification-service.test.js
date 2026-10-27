import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory Firestore: just enough surface for notificationService (docs, get,
// set, update, and transactions that serialise like Firestore's).
const store = { emailLog: {}, properties: {}, users: {} };
const authUsers = {};
let sendImpl;
const sendSpy = vi.fn();

function ref(col, id) {
  return {
    col, id,
    get: async () => ({ exists: col in store && id in store[col], data: () => store[col][id] }),
    update: async (u) => { store[col][id] = { ...store[col][id], ...u }; },
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    runTransaction: async (fn) => fn({
      get: async (r) => r.get(),
      set: (r, d) => { store[r.col][r.id] = d; },
      update: (r, u) => { store[r.col][r.id] = { ...store[r.col][r.id], ...u }; },
    }),
  },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    getUser: async (uid) => {
      if (authUsers[uid] === 'error') throw Object.assign(new Error('boom'), { code: 'auth/internal-error' });
      if (!authUsers[uid]) throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' });
      return authUsers[uid];
    },
  }),
}));
vi.mock('../../src/app/api/services/resendService', () => ({
  sendPropertyReadyEmail: (...args) => { sendSpy(...args); return sendImpl(...args); },
}));

const { sendPropertyReadyOnce, propertyReadyKey, checkRecipientEligibility } =
  await import('../../src/app/api/services/notificationService');

beforeEach(() => {
  for (const k of Object.keys(store)) store[k] = {};
  for (const k of Object.keys(authUsers)) delete authUsers[k];
  sendSpy.mockClear();
  sendImpl = async () => ({ data: { id: 'x' } });
  store.properties.p1 = { userId: 'agent1', address: '1 Test St', ownership: { userId: 'agent1', seq: 1 } };
  store.users.agent1 = { email: 'a@example.com', firstName: 'Ann' };
  authUsers.agent1 = { disabled: false };
});

const ev = (over = {}) => ({ propertyId: 'p1', recipientUid: 'agent1', seq: 1, ...over });

describe('sendPropertyReadyOnce: exactly once per event', () => {
  it('sends once and records the event', async () => {
    expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: true });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [email, name, address, id, opts] = sendSpy.mock.calls[0];
    expect([email, name, address, id]).toEqual(['a@example.com', 'Ann', '1 Test St', 'p1']);
    expect(opts.idempotencyKey).toBe(propertyReadyKey(ev()));
    expect(store.emailLog[propertyReadyKey(ev())].status).toBe('sent');
  });

  it('a retry or repeated call for the same event does not send again', async () => {
    await sendPropertyReadyOnce(ev());
    expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: false, reason: 'sent' });
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('concurrent calls for the same event send once', async () => {
    let release;
    sendImpl = () => new Promise((r) => { release = r; });
    const first = sendPropertyReadyOnce(ev());
    await new Promise((r) => setTimeout(r, 0));
    const second = await sendPropertyReadyOnce(ev());
    expect(second).toEqual({ sent: false, reason: 'in-progress' });
    release({});
    expect((await first).sent).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('a stale claim (crashed process) can be retried', async () => {
    store.emailLog[propertyReadyKey(ev())] = { status: 'sending', claimedAtMs: Date.now() - 5 * 60 * 1000, attempts: 1 };
    expect((await sendPropertyReadyOnce(ev())).sent).toBe(true);
  });

  it('a failed send is retryable and then sends once', async () => {
    sendImpl = async () => { throw new Error('Resend rejected the email'); };
    expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: false, reason: 'send-failed' });
    expect(store.emailLog[propertyReadyKey(ev())].status).toBe('failed');
    sendImpl = async () => ({});
    expect((await sendPropertyReadyOnce(ev())).sent).toBe(true);
    expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: false, reason: 'sent' });
    expect(sendSpy).toHaveBeenCalledTimes(2); // 1 failed attempt + 1 success
  });
});

describe('assignments and reassignments are separate events', () => {
  it('a new seq for the same agent (re-assigned later) sends again', async () => {
    await sendPropertyReadyOnce(ev({ seq: 1 }));
    store.properties.p1.ownership.seq = 2;
    expect((await sendPropertyReadyOnce(ev({ seq: 2 }))).sent).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('a different agent gets their own notification', async () => {
    store.users.agent2 = { email: 'b@example.com', firstName: 'Bo' };
    authUsers.agent2 = { disabled: false };
    await sendPropertyReadyOnce(ev());
    store.properties.p1.userId = 'agent2';
    expect((await sendPropertyReadyOnce(ev({ recipientUid: 'agent2', seq: 2 }))).sent).toBe(true);
  });

  it('an old event is skipped if the property has since moved on', async () => {
    store.properties.p1.userId = 'agent2';
    expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: false, reason: 'no-longer-owner' });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: false, reason: 'skipped' });
  });

  it('skips a property that no longer exists', async () => {
    delete store.properties.p1;
    expect((await sendPropertyReadyOnce(ev())).reason).toBe('property-missing');
  });
});

describe('recipient eligibility (inactive and disabled recipients never get email)', () => {
  const cases = [
    ['invited (not yet activated)', { accountStatus: 'invited' }, 'account-invited'],
    ['non-active status', { accountStatus: 'suspended' }, 'account-suspended'],
    ['unsubscribed', { unsubscribed: true }, 'unsubscribed'],
    ['disabled flag', { disabled: true }, 'account-disabled'],
    ['deactivated flag', { deactivated: true }, 'account-disabled'],
    ['no email', { email: '' }, 'no-email'],
  ];
  for (const [label, patch, reason] of cases) {
    it(`skips: ${label}`, async () => {
      store.users.agent1 = { ...store.users.agent1, ...patch };
      expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: false, reason });
      expect(sendSpy).not.toHaveBeenCalled();
    });
  }

  it('skips: no user document', async () => {
    delete store.users.agent1;
    expect((await sendPropertyReadyOnce(ev())).reason).toBe('no-user-document');
  });

  it('skips: Firebase Auth account disabled', async () => {
    authUsers.agent1 = { disabled: true };
    expect((await sendPropertyReadyOnce(ev())).reason).toBe('auth-disabled');
  });

  it('skips: no Firebase Auth account', async () => {
    delete authUsers.agent1;
    expect((await sendPropertyReadyOnce(ev())).reason).toBe('no-auth-account');
  });

  it('does not send, and stays retryable, when Auth cannot be checked', async () => {
    authUsers.agent1 = 'error';
    expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: false, reason: 'send-failed' });
    expect(sendSpy).not.toHaveBeenCalled();
    authUsers.agent1 = { disabled: false };
    expect((await sendPropertyReadyOnce(ev())).sent).toBe(true);
  });

  it('accepts an active account (accountStatus active or unset for legacy accounts)', async () => {
    expect((await checkRecipientEligibility('agent1', { email: 'a@x.com', accountStatus: 'active' })).ok).toBe(true);
    expect((await checkRecipientEligibility('agent1', { email: 'a@x.com' })).ok).toBe(true);
  });
});

describe('argument validation', () => {
  it('refuses calls without an event identity', async () => {
    expect((await sendPropertyReadyOnce({ propertyId: 'p1', recipientUid: 'agent1' })).reason).toBe('invalid-arguments');
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('retry safety: failed, timed-out and uncertain sends', () => {
  const HOUR = 60 * 60 * 1000;
  const key = () => propertyReadyKey(ev());

  it('a definite Resend rejection is retryable and not flagged uncertain', async () => {
    sendImpl = async () => { throw new Error('Resend rejected the email (x, HTTP 422): bad'); };
    await sendPropertyReadyOnce(ev());
    expect(store.emailLog[key()]).toMatchObject({ status: 'failed', uncertain: false, attempts: 1 });
  });

  it('a network timeout is flagged uncertain and retried with the SAME idempotency key', async () => {
    sendImpl = async () => { throw new Error('fetch failed: timeout'); };
    await sendPropertyReadyOnce(ev());
    expect(store.emailLog[key()]).toMatchObject({ status: 'failed', uncertain: true });
    sendImpl = async () => ({});
    expect((await sendPropertyReadyOnce(ev())).sent).toBe(true);
    const keys = sendSpy.mock.calls.map((c) => c[4].idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('an uncertain failure older than the idempotency window is parked, never re-sent', async () => {
    store.emailLog[key()] = { status: 'failed', uncertain: true, attempts: 1, firstAttemptMs: Date.now() - 25 * HOUR, claimedAtMs: Date.now() - 25 * HOUR };
    expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: false, reason: 'needs-review' });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(store.emailLog[key()].status).toBe('needs-review');
  });

  it('a stale claim older than the window is parked too; a definite rejection never expires', async () => {
    store.emailLog[key()] = { status: 'sending', attempts: 1, firstAttemptMs: Date.now() - 30 * HOUR, claimedAtMs: Date.now() - 30 * HOUR };
    expect((await sendPropertyReadyOnce(ev())).reason).toBe('needs-review');
    store.emailLog[key()] = { status: 'failed', uncertain: false, attempts: 1, firstAttemptMs: Date.now() - 30 * HOUR };
    expect((await sendPropertyReadyOnce(ev())).sent).toBe(true);
  });

  it('gives up after 5 attempts instead of retrying forever', async () => {
    store.emailLog[key()] = { status: 'failed', uncertain: false, attempts: 5, firstAttemptMs: Date.now() };
    expect(await sendPropertyReadyOnce(ev())).toEqual({ sent: false, reason: 'needs-review' });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('retryOnly never starts a new event, and does retry a failed one', async () => {
    expect(await sendPropertyReadyOnce({ ...ev(), retryOnly: true })).toEqual({ sent: false, reason: 'no-prior-event' });
    expect(sendSpy).not.toHaveBeenCalled();
    sendImpl = async () => { throw new Error('Resend rejected the email (x, HTTP 500): down'); };
    await sendPropertyReadyOnce(ev());
    sendImpl = async () => ({});
    expect((await sendPropertyReadyOnce({ ...ev(), retryOnly: true })).sent).toBe(true);
    expect((await sendPropertyReadyOnce({ ...ev(), retryOnly: true })).reason).toBe('sent');
  });
});
