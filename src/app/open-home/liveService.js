/**
 * The live pilot's data service for BuyerJourney: the public Open Home API (no login). Same interface as the concept
 * demo's (concepts/open-home/_lib/demoService.js).
 *
 * Privacy on the buyer's phone:
 *   - requests are sent with credentials: 'omit' (no cookies), so the opinion request carries nothing but its body;
 *   - the opinion body is { amount, device }: `device` is a random token made on this phone for this open home, used
 *     only to ignore an accidental second submission. It is never sent with the check-in or interest requests, and the
 *     check-in reference is never sent with the opinion;
 *   - the phone remembers its own progress (to reopen where it left off), never the amount.
 */
const NS = 'pm-open-home:';

function store() {
  try {
    const s = window.localStorage;
    s.setItem(`${NS}probe`, '1');
    s.removeItem(`${NS}probe`);
    return s;
  } catch {
    return null;
  }
}
const memory = new Map();
const read = (k) => { try { const raw = store() ? store().getItem(NS + k) : memory.get(k); return raw ? JSON.parse(raw) : null; } catch { return null; } };
const write = (k, v) => { const raw = JSON.stringify(v); if (store()) store().setItem(NS + k, raw); else memory.set(k, raw); };

function deviceToken(code) {
  const key = `device:${code}`;
  let t = read(key);
  if (typeof t !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    t = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    write(key, t);
  }
  return t;
}

async function post(code, path, body) {
  try {
    const res = await fetch(`/api/open-home/visit/${encodeURIComponent(code)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, ...data };
    return { ok: false, code: data.code, message: data.error, errors: data.errors };
  } catch {
    return { ok: false, code: 'offline', message: 'No connection. Please check your signal and try again.' };
  }
}

export function createLiveService(code) {
  return {
    loadVisit: () => read(`visit:${code}`),
    saveVisit: (visit) => write(`visit:${code}`, visit),
    isEnded: () => false,
    checkIn: (d) => post(code, '/check-in', { fullName: d.fullName, mobile: d.mobile, email: d.email, updatesOptIn: d.updatesOptIn === true }),
    submitOpinion: (amount) => post(code, '/opinion', { amount, device: deviceToken(code) }),
    registerInterest: (ref, wants) => post(code, '/interest', { ref, wants }),
  };
}
