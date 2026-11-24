import { readJson, writeJson, randomCode } from './demoStorage';
import { seedAttendance } from './attendanceStore';
import { seedOpinions } from './opinionStore';
import { DEMO_PROPERTIES, opinionRangeFor } from './demoProperties';

/**
 * Open-home sessions for the concept demo (local to this browser). A session is one open home: a property, when it
 * started, and when it ended. Its id is the random code in the entrance QR, so each session gets its own sign.
 */

const KEY = 'sessions';
const SEEDED = 'seeded:v1';

export const listSessions = () => readJson(KEY, []);
export const getSession = (id) => listSessions().find((s) => s.id === id) || null;
export const activeSessionFor = (propertyId) => listSessions().find((s) => s.propertyId === propertyId && !s.endedAt) || null;

export function startSession(propertyId, { now = Date.now() } = {}) {
  const existing = activeSessionFor(propertyId);
  if (existing) return existing;
  const session = { id: randomCode(6), propertyId, startedAt: new Date(now).toISOString(), endedAt: null };
  writeJson(KEY, [session, ...listSessions()]);
  return session;
}

export function endSession(id, { now = Date.now() } = {}) {
  writeJson(KEY, listSessions().map((s) => (s.id === id && !s.endedAt ? { ...s, endedAt: new Date(now).toISOString() } : s)));
  return getSession(id);
}

/**
 * A phone that scans a demo sign has never seen the session (the demo has no server). It records the session locally
 * so that reopening the page restores the visit.
 */
export function ensureVisitSession(id, propertyId) {
  const found = getSession(id);
  if (found) return found;
  const session = { id, propertyId, startedAt: new Date().toISOString(), endedAt: null, scannedOnly: true };
  writeJson(KEY, [session, ...listSessions()]);
  return session;
}

// Fictional people for demo history and the visitor simulation. Phone numbers are from ACMA's reserved range for
// fictitious use (0491 570 xxx – 0491 579 xxx); emails use the reserved example.com domain.
export const DEMO_PEOPLE = [
  ['Olivia Bennett', '0491 570 006'], ['Liam Nguyen', '0491 570 156'], ['Charlotte Hughes', '0491 570 157'],
  ['Noah Patel', '0491 570 158'], ['Amelia Clarke', '0491 570 159'], ['Jack Robertson', '0491 570 110'],
  ['Isla Thompson', '0491 570 313'], ['William Chen', '0491 570 737'], ['Mia Fraser', '0491 571 266'],
  ['Henry Walsh', '0491 571 491'], ['Grace Kelleher', '0491 571 804'], ['Thomas Wright', '0491 572 549'],
  ['Zoe Martin', '0491 572 665'], ['Lucas Singh', '0491 572 983'], ['Ella Murphy', '0491 573 770'],
  ['Oscar Davies', '0491 573 087'], ['Ruby Anderson', '0491 574 118'], ['James O’Connor', '0491 574 632'],
].map(([fullName, local]) => ({
  fullName,
  mobile: `+61${local.replace(/\s/g, '').slice(1)}`,
  email: `${fullName.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`,
}));

/** Plausible demo opinions for a property: spread around the middle of its slider range, on $10,000 steps. */
export function demoOpinionAmounts(property, count, rand = Math.random) {
  const { min, max } = opinionRangeFor(property);
  const mid = (min + max) / 2;
  const spread = (max - min) / 2;
  return Array.from({ length: count }, () => {
    const t = (rand() + rand() + rand()) / 3 - 0.5; // gentle bell curve around the middle of the range
    const v = Math.round((mid + t * spread * 2.4) / 10000) * 10000;
    return Math.min(max, Math.max(min, v));
  });
}

/** One finished open home from last weekend, so the post-inspection summary has something to show. Runs once. */
export function seedDemoHistory({ now = Date.now() } = {}) {
  if (readJson(SEEDED, false)) return;
  const property = DEMO_PROPERTIES[0];
  const lastSaturday = new Date(now);
  lastSaturday.setDate(lastSaturday.getDate() - (((lastSaturday.getDay() + 1) % 7) || 7));
  lastSaturday.setHours(10, 0, 0, 0);
  const start = lastSaturday.getTime();
  const id = randomCode(6);
  const session = { id, propertyId: property.id, startedAt: new Date(start).toISOString(), endedAt: new Date(start + 32 * 60000).toISOString() };
  seedAttendance(id, DEMO_PEOPLE.slice(0, 14).map((p, i) => ({
    ...p,
    checkedInAt: new Date(start + (1 + i * 2) * 60000).toISOString(),
    interest: [1, 5, 9].includes(i) ? { wants: i === 5 ? ['contract'] : ['call'] } : null,
  })));
  seedOpinions(id, demoOpinionAmounts(property, 9));
  writeJson(KEY, [...listSessions(), session]);
  writeJson(SEEDED, true);
}
