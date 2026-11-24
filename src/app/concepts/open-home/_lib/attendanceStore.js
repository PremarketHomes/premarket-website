import { readJson, writeJson, randomCode, pause } from './demoStorage';
import { validateCheckIn } from './checkInForm';

/**
 * IDENTITY SIDE of the open home (concept demo; local to this browser, see demoStorage.js).
 *
 * Knows who checked in and who registered interest. Knows NOTHING about price opinions: this module never imports the
 * opinion store, and no record here has an opinion field, flag or reference. The mirror-image rule holds in
 * opinionStore.js. That separation is the design a production version must keep (docs/open-home-concept.md).
 *
 * Record: { ref, fullName, mobile, email, updatesOptIn, checkedInAt, interest }
 *   ref          random reference the buyer's phone keeps so "Register my interest" needs no retyping. It is only
 *                ever sent with identity requests, never with an opinion.
 *   checkedInAt  to the minute: attendance registers need the time a buyer arrived, not the second.
 *   interest     null, or { wants: [...] } once the buyer registers interest. Deliberately no time.
 */

const key = (sessionId) => `attendance:${sessionId}`;
const toMinute = (ms) => { const d = new Date(ms); d.setSeconds(0, 0); return d.toISOString(); };

export async function checkIn(sessionId, details, { now = Date.now() } = {}) {
  const v = validateCheckIn(details);
  if (!v.ok) return { ok: false, errors: v.errors };
  await pause();
  const list = readJson(key(sessionId), []);
  const record = {
    ref: randomCode(12),
    fullName: v.value.fullName,
    mobile: v.value.mobile,
    email: v.value.email,
    updatesOptIn: details.updatesOptIn === true,
    checkedInAt: toMinute(now),
    interest: null,
  };
  writeJson(key(sessionId), [...list, record]);
  return { ok: true, ref: record.ref };
}

export const INTEREST_OPTIONS = [
  { id: 'call', label: 'Call me' },
  { id: 'contract', label: 'Send the contract' },
  { id: 'inspection', label: 'Book another inspection' },
];

export async function registerInterest(sessionId, ref, { wants = [] } = {}) {
  await pause();
  const list = readJson(key(sessionId), []);
  const allowed = new Set(INTEREST_OPTIONS.map((o) => o.id));
  let found = false;
  const next = list.map((r) => {
    if (r.ref !== ref) return r;
    found = true;
    return { ...r, interest: { wants: wants.filter((w) => allowed.has(w)) } };
  });
  if (!found) return { ok: false };
  writeJson(key(sessionId), next);
  return { ok: true };
}

/** What the agent sees: the attendance register, earliest first. */
export function listAttendance(sessionId) {
  return [...readJson(key(sessionId), [])].sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt));
}

/** Seeds attendance directly (demo history only). */
export function seedAttendance(sessionId, records) {
  writeJson(key(sessionId), records.map((r) => ({ ref: randomCode(12), interest: null, updatesOptIn: false, ...r })));
}
