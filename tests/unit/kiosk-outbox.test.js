import { describe, it, expect, beforeEach } from 'vitest';
import { createKioskOutbox } from '../../src/app/utils/kioskOutbox';

function makeClock() {
  let t = 1000; let id = 0; const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { id += 1; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (h) => timers.delete(h),
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); t = due[1].at; due[1].fn();
        await flushMicrotasks();
      }
      t = target;
      await flushMicrotasks();
    },
  };
}
const flushMicrotasks = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), _m: m }; };

// A fake server: writes are merge-sets keyed by doc id, so a retry is idempotent by construction.
function makeServer() {
  const docs = {}; const calls = []; const notified = [];
  let online = true; let hang = false;
  return {
    docs, calls, notified,
    setOnline(v) { online = v; }, setHang(v) { hang = v; },
    write: async (item) => {
      calls.push(item.docId);
      if (hang) return new Promise(() => {});
      if (!online) throw new Error('offline');
      docs[item.docId] = { ...(docs[item.docId] || {}), ...item.data };
    },
    notify: async (item) => {
      if (!online) throw new Error('offline');
      if (!docs[item.docId]) throw new Error('doc missing');   // the route reads the registration doc
      notified.push(item.docId);
    },
  };
}

let clock; let store; let server; let events;
const make = (extra = {}) => {
  const ob = createKioskOutbox({ storage: store, write: server.write, notify: server.notify, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, attemptTimeoutMs: 5000, ...extra });
  ob.subscribe((e) => events.push(e));
  return ob;
};
beforeEach(() => { clock = makeClock(); store = memStore(); server = makeServer(); events = []; });

const opinion = (id, amount = 900000) => ({ kind: 'opinion', docId: id, data: { type: 'opinion', propertyId: 'p1', offerAmount: amount, createdAtIso: '2026-10-27T00:00:00.000Z' } });
const registration = (id) => ({ kind: 'registration', docId: id, notify: true, data: { type: 'opinion', propertyId: 'p1', serious: true, buyerName: 'Luke Wilson', createdAtIso: '2026-10-27T00:00:00.000Z' } });

describe('kiosk outbox: durable and honest', () => {
  it('writes, emits an ack only after the server accepted it, then empties the queue', async () => {
    const ob = make();
    ob.enqueue(opinion('A'));
    await flushMicrotasks();
    expect(server.docs.A.offerAmount).toBe(900000);
    expect(events.filter((e) => e.type === 'acked')).toEqual([{ type: 'acked', key: 'opinion:A', docId: 'A', kind: 'opinion' }]);
    expect(ob.status().pending).toBe(0);
    expect(JSON.parse(store.getItem('pm_kiosk_outbox_v1'))).toEqual([]);
  });

  it('while offline nothing is acked, the item is persisted, and it retries — then acks once the connection returns', async () => {
    server.setOnline(false);
    const ob = make();
    ob.enqueue(opinion('A'));
    await flushMicrotasks();
    expect(events.some((e) => e.type === 'acked')).toBe(false);          // never claims "saved"
    expect(ob.status()).toMatchObject({ pending: 1, failing: 1 });
    expect(JSON.parse(store.getItem('pm_kiosk_outbox_v1'))).toHaveLength(1); // durable
    await clock.advance(3000);                                           // still offline: retry fails again
    expect(ob.status().pending).toBe(1);
    server.setOnline(true);
    await clock.advance(10000);
    expect(server.docs.A.offerAmount).toBe(900000);
    expect(events.filter((e) => e.type === 'acked')).toHaveLength(1);
    expect(ob.status().pending).toBe(0);
  });

  it('survives a page reload: a new instance on the same storage picks the queue up and delivers it', async () => {
    server.setOnline(false);
    make().enqueue(opinion('A'));
    await flushMicrotasks();
    const reloaded = make();                    // "reload"
    expect(reloaded.status().pending).toBe(1);
    server.setOnline(true);
    await reloaded.flush();
    await flushMicrotasks();
    expect(server.docs.A).toBeTruthy();
    expect(reloaded.status().pending).toBe(0);
  });

  it('retrying never creates a duplicate: the same document id is reused', async () => {
    server.setOnline(false);
    const ob = make();
    ob.enqueue(opinion('A'));
    await flushMicrotasks();
    await clock.advance(3000); server.setOnline(true); await clock.advance(10000);
    expect(new Set(server.calls)).toEqual(new Set(['A']));
    expect(Object.keys(server.docs)).toEqual(['A']);
  });

  it('enqueueing the same item twice (double-fired release) is a no-op', async () => {
    const ob = make();
    ob.enqueue(opinion('A')); ob.enqueue(opinion('A'));
    await flushMicrotasks();
    expect(server.calls).toEqual(['A']);
  });

  it('a hung request is abandoned after the timeout and retried with the same id', async () => {
    server.setHang(true);
    const ob = make();
    ob.enqueue(opinion('A'));
    await flushMicrotasks();
    await clock.advance(5000);                  // attempt timeout
    expect(ob.status().failing).toBe(1);
    server.setHang(false);
    await clock.advance(10000);
    expect(server.docs.A).toBeTruthy();
    expect(ob.status().pending).toBe(0);
  });

  it('the next visitor is never blocked by an earlier opinion that is still syncing', async () => {
    server.setOnline(false);
    const ob = make();
    ob.enqueue(opinion('A'));
    ob.enqueue(opinion('B', 700000));           // enqueue returns immediately; nothing awaits the failing item
    ob.enqueue(opinion('C', 1100000));
    await flushMicrotasks();
    expect(ob.status().pending).toBe(3);
    server.setOnline(true);
    await clock.advance(10000);
    expect(Object.keys(server.docs).sort()).toEqual(['A', 'B', 'C']);
  });

  it('a late retry of the opinion cannot overwrite registration fields added afterwards (merge semantics)', async () => {
    const ob = make();
    ob.enqueue(registration('A'));
    await flushMicrotasks();
    ob.enqueue({ ...opinion('A'), key: undefined });   // opinion for the same doc arriving after
    await flushMicrotasks();
    expect(server.docs.A).toMatchObject({ serious: true, buyerName: 'Luke Wilson', offerAmount: 900000 });
  });

  it('a registration notifies the agent only AFTER the registration document is acknowledged', async () => {
    server.setOnline(false);
    const ob = make();
    ob.enqueue(registration('R'));
    await flushMicrotasks();
    expect(server.notified).toEqual([]);
    server.setOnline(true);
    await clock.advance(10000);
    expect(server.docs.R.serious).toBe(true);
    expect(server.notified).toEqual(['R']);
    expect(ob.status().pending).toBe(0);
  });

  it('if the notify step fails after the write succeeded, only the notify is retried (no re-write loop)', async () => {
    const ob = make();
    let failNotify = true;
    const flaky = make({ notify: async (i) => { if (failNotify) throw new Error('x'); server.notified.push(i.docId); } });
    flaky.enqueue(registration('R'));
    await flushMicrotasks();
    const writesAfterFirst = server.calls.length;
    failNotify = false;
    await clock.advance(10000);
    expect(server.notified).toEqual(['R']);
    expect(server.calls.length).toBe(writesAfterFirst);
    expect(ob).toBeTruthy();
  });

  it('is honest when storage is unavailable: keeps working from memory and reports durable:false', async () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const ob = make({ storage: broken });
    ob.enqueue(opinion('A'));
    await flushMicrotasks();
    expect(server.docs.A).toBeTruthy();
    expect(ob.status().durable).toBe(false);
  });

  it('ignores corrupt stored data rather than crashing', () => {
    store.setItem('pm_kiosk_outbox_v1', '{not json');
    expect(make().status().pending).toBe(0);
    store.setItem('pm_kiosk_outbox_v1', JSON.stringify([{ nope: true }, null]));
    expect(make().status().pending).toBe(0);
  });

  it('when connectivity returns, a forced flush retries immediately instead of waiting out the backoff', async () => {
    server.setOnline(false);
    const ob = make();
    ob.enqueue(opinion('A'));
    await flushMicrotasks();
    await clock.advance(100);                  // well inside the 2s backoff
    server.setOnline(true);
    await ob.flush();                          // a normal flush respects the backoff...
    expect(server.docs.A).toBeUndefined();
    await ob.flush({ force: true });           // ...an 'online' event does not
    await flushMicrotasks();
    expect(server.docs.A).toBeTruthy();
    expect(ob.status().pending).toBe(0);
  });
});
