/**
 * Durable, idempotent write queue for the iPad open-home kiosk.
 *
 * Why it exists: the kiosk runs on venue Wi-Fi. A visitor's opinion must not
 * be lost if the connection drops, the page reloads or the iPad sleeps, and it
 * must never be saved twice. So:
 *
 *  - Every item has a document id generated up front (by the caller). A retry
 *    writes to the SAME document with a merge, so it can never create a
 *    duplicate, and can never overwrite fields a later registration added.
 *  - Items are persisted to storage (localStorage) BEFORE the first attempt and
 *    removed only after the server has acknowledged the write. A reload picks
 *    the queue back up.
 *  - Failures retry with backoff; a hung request is abandoned after a timeout
 *    (the same id makes the eventual late completion harmless).
 *  - Registrations additionally trigger the agent notification, but only AFTER
 *    the registration document is acknowledged (the notify route reads it).
 *  - It reports honestly: `acked` events fire only on a real server ack, and
 *    `status()` says how many items are still waiting.
 *
 * Framework- and Firebase-free (the actual write/notify are injected), with an
 * injectable clock and storage, so every behaviour is unit-tested.
 */

const DEFAULT_BACKOFF = [2000, 5000, 15000, 30000, 60000];
const MAX_QUEUE = 500;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

export function createKioskOutbox({
  storage,
  storageKey = 'pm_kiosk_outbox_v1',
  write,   // async (item) => void — resolves only once the server has acknowledged the write
  notify,  // async (item) => void — agent notification for registrations
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  backoff = DEFAULT_BACKOFF,
  attemptTimeoutMs = 12000,
}) {
  let durable = true;
  let store = storage;
  if (!store) { store = memoryStorage(); durable = false; }

  let destroyed = false;
  let items = [];
  const inflight = new Set();
  const listeners = new Set();
  let timer = null;

  // ── persistence ──────────────────────────────────────────────────────
  function load() {
    try {
      const raw = store.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      items = Array.isArray(parsed) ? parsed.filter((i) => i && i.key && i.docId && i.data) : [];
      // A reload (or the iPad waking up) deserves an immediate retry, not the old backoff.
      items.forEach((i) => { i.nextAt = 0; });
    } catch {
      items = [];
    }
  }
  function save() {
    try {
      store.setItem(storageKey, JSON.stringify(items));
    } catch {
      // Storage full/blocked (private mode): keep working from memory, but say so.
      durable = false;
    }
  }
  load();

  // ── events ───────────────────────────────────────────────────────────
  const emit = (event) => { if (!destroyed) listeners.forEach((l) => { try { l(event); } catch { /* listener errors never break the queue */ } }); };
  const status = () => ({
    pending: items.length,
    failing: items.filter((i) => i.attempts > 0).length,
    durable,
  });
  const emitStatus = () => emit({ type: 'status', ...status() });

  // ── processing ───────────────────────────────────────────────────────
  const withTimeout = (promise) => new Promise((resolve, reject) => {
    const t = setTimer(() => reject(new Error('attempt timed out')), attemptTimeoutMs);
    promise.then((v) => { clearTimer(t); resolve(v); }, (e) => { clearTimer(t); reject(e); });
  });

  async function attempt(item) {
    if (inflight.has(item.key)) return;
    inflight.add(item.key);
    try {
      if (item.stage === 'write') {
        await withTimeout(Promise.resolve().then(() => write(item)));
        emit({ type: 'acked', key: item.key, docId: item.docId, kind: item.kind });
        if (item.notify) {
          item.stage = 'notify';
          item.attempts = 0;
          save();
        }
      }
      if (item.stage === 'notify') {
        await withTimeout(Promise.resolve().then(() => notify(item)));
      }
      items = items.filter((i) => i.key !== item.key);
      save();
    } catch {
      item.attempts += 1;
      item.nextAt = now() + backoff[Math.min(item.attempts - 1, backoff.length - 1)];
      save();
    } finally {
      inflight.delete(item.key);
      emitStatus();
    }
  }

  function schedule() {
    if (destroyed) return;
    if (timer !== null) { clearTimer(timer); timer = null; }
    const waiting = items.filter((i) => !inflight.has(i.key));
    if (waiting.length === 0) return;
    const nextAt = Math.min(...waiting.map((i) => i.nextAt || 0));
    timer = setTimer(() => { timer = null; flush(); }, Math.max(0, nextAt - now()));
  }

  /**
   * Try every item that is due. Safe to call at any time (online event, tab shown, reload).
   * `force` ignores the retry backoff — used when connectivity has just returned, when the
   * old backoff no longer means anything.
   */
  async function flush({ force = false } = {}) {
    const due = items.filter((i) => !inflight.has(i.key) && (force || (i.nextAt || 0) <= now()));
    await Promise.all(due.map(attempt));
    schedule();
  }

  /**
   * Queue an item. `key` is the idempotency key (kind + document id): queueing
   * the same item twice is a no-op, so a double-fired release can't double up.
   */
  function enqueue({ kind, docId, data, notify: needsNotify = false }) {
    const key = `${kind}:${docId}`;
    if (items.some((i) => i.key === key)) return key;
    if (items.length >= MAX_QUEUE) items.shift();
    items.push({ key, kind, docId, data, notify: needsNotify, stage: 'write', attempts: 0, nextAt: 0 });
    save();
    emitStatus();
    flush();
    return key;
  }

  return {
    enqueue,
    flush,
    status,
    /** True while the item has not yet been removed (i.e. not fully done). */
    has: (key) => items.some((i) => i.key === key),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { destroyed = true; if (timer !== null) clearTimer(timer); timer = null; listeners.clear(); },
  };
}
