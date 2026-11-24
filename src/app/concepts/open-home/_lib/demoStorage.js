/**
 * Storage for the Open Home CONCEPT DEMO only: this browser's localStorage (or memory, if storage is blocked), under one
 * namespace. Nothing here talks to Firestore or any server: a demo can never create real attendance, opinions or
 * registrations, send email or SMS, or touch a live campaign.
 *
 * Changes are broadcast to every listener in this tab and to other tabs of this browser (BroadcastChannel + the storage
 * event), so the presenter can run the buyer phone in one window and watch the agent dashboard update in another.
 */

export const DEMO_NAMESPACE = 'pm-open-home-demo:';
const CHANNEL = 'pm-open-home-demo';

const memory = new Map();
const listeners = new Set();
let channel = null;
let wired = false;

function store() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = `${DEMO_NAMESPACE}probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function emit(key) {
  for (const fn of [...listeners]) {
    try { fn(key); } catch { /* a listener's failure never breaks the demo */ }
  }
}

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (e) => emit(e.data?.key || null);
    }
  } catch { channel = null; }
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.startsWith(DEMO_NAMESPACE)) emit(e.key ? e.key.slice(DEMO_NAMESPACE.length) : null);
  });
}

export function readJson(key, fallback) {
  const s = store();
  const raw = s ? s.getItem(DEMO_NAMESPACE + key) : memory.get(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function writeJson(key, value) {
  const raw = JSON.stringify(value);
  const s = store();
  if (s) s.setItem(DEMO_NAMESPACE + key, raw);
  else memory.set(key, raw);
  wire();
  emit(key);
  try { channel?.postMessage({ key }); } catch { /* closed channel */ }
}

/** Removes every demo key (the presenter's "Reset demo"). */
export function clearDemoData() {
  const s = store();
  if (s) {
    const keys = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(DEMO_NAMESPACE)) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  }
  memory.clear();
  wire();
  emit(null);
  try { channel?.postMessage({ key: null }); } catch { /* closed channel */ }
}

/** `fn(key)` on every change (key without the namespace; null = everything). Returns an unsubscribe function. */
export function subscribe(fn) {
  wire();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Random, unguessable reference from an unambiguous alphabet (crypto-random). */
export function randomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Simulated network latency, so the demo shows the same loading states a real request would. */
export const demoLatency = { ms: 450 };
export const pause = () => new Promise((r) => setTimeout(r, demoLatency.ms));
