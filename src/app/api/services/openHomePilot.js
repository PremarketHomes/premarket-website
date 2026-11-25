import { createHash, randomBytes } from 'crypto';
import { pointsAtLiveBackend, previewWritesBlocked } from './environmentGuard';
import { validateCheckIn } from '../../utils/openHome/checkIn';
import { summarizeOpinions } from '../../utils/openHome/opinionSummary';
import { computePriceOpinionRange } from '../../utils/priceOpinionRange';
import { PRICE_OPINION_STEP } from '../../utils/priceOpinionStep';

/**
 * Open Home live pilot (server only). An allowlisted agent starts an open home for one of their own campaigns; buyers
 * scan its QR, check in on their own phone (no Premarket login), optionally leave an anonymous price opinion and get the
 * green completion screen; the agent sees attendance plus anonymous aggregates.
 *
 * PRIVACY: identity and opinions are separate records that share nothing per buyer.
 *   openHomeAttendance/{random}    identity: name, mobile, email, consent, check-in minute, optional interest.
 *   openHomeOpinions/{sessionId}   ONE document per session: { amounts: sorted numbers, count }. No per-opinion record,
 *                                  no buyer, no attendance reference, no device, no timestamp; sorting removes order.
 *   openHomeOpinionGuards/{sessionId}  sorted hashes of random per-phone tokens, ONLY to stop accidental duplicates.
 *                                  Unrelated to attendance (the phone never sends its check-in reference with an
 *                                  opinion) and sorted independently of the amounts, so the two can't be aligned.
 *   Agents only ever receive summarizeOpinions() output: a stepped count while live, and after the open home ends the
 *   typical opinion / middle range / spread from 5 opinions up. Never an amount, never per-buyer status, never a time.
 *   Nothing here touches `offers`, the campaign report or the iPad kiosk (whose registration-on-opinion-document design
 *   this pilot deliberately does not use).
 *
 * ACCESS: the agent routes require a signed-in account on OPEN_HOME_PILOT_UIDS and act only on that agent's own
 * campaigns and sessions. Buyer routes need the session's unguessable code and work only while the session is active
 * and its agent is still allowlisted (removing the UID switches everything off). All collections are server-only
 * (default-deny Firestore rules); a Vercel preview connected to live data refuses every write.
 */

// Phil Chillemi (Harcourts Property Hub): account verified 2026-11-25 by looking up phil@propertyhubgc.com.au.
// Remove an entry (and deploy) to switch the pilot off for that agent immediately, including their QR codes.
export const OPEN_HOME_PILOT_UIDS = Object.freeze(['NwnuzW7YrdX7looxQVvg6ZpqaOg2']);

export const COLLECTIONS = Object.freeze({
  sessions: 'openHomeSessions',
  attendance: 'openHomeAttendance',
  opinions: 'openHomeOpinions',
  guards: 'openHomeOpinionGuards',
  active: 'openHomeActive', // {propertyId} -> { sessionId }: makes "one running open home per campaign" atomic
});
export const NOTICE_VERSION = 'open-home-pilot-2026-11';
export const LIMITS = Object.freeze({ checkInsPerSession: 250, opinionSlack: 2, sessionHours: 12, interestHours: 48 });
export const MODES = Object.freeze(['live', 'test']);
const WANTS = new Set(['call', 'contract', 'inspection']);

export class OpenHomeError extends Error {
  constructor(message, status = 400, code = 'bad-request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Allowlist. Staging/emulator test agents (OPEN_HOME_PILOT_TEST_UIDS) count only when NOT talking to the live project. */
export function pilotAgentUids(env = process.env) {
  const extra = pointsAtLiveBackend(env)
    ? []
    : String(env.OPEN_HOME_PILOT_TEST_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...OPEN_HOME_PILOT_UIDS, ...extra];
}
export const isPilotAgent = (uid, env = process.env) => typeof uid === 'string' && uid.length > 0 && pilotAgentUids(env).includes(uid);

function assertWritable(env = process.env) {
  if (previewWritesBlocked(env)) throw new OpenHomeError('This preview is connected to live data, so open homes can’t be run here.', 403, 'preview-read-only');
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** 16 characters (~79 bits): the session id and the code in its QR link. */
export function newSessionCode() {
  return Array.from(randomBytes(16), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
export const isSessionCode = (s) => typeof s === 'string' && /^[abcdefghjkmnpqrstuvwxyz23456789]{16}$/.test(s);

const toMillis = (t) => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t instanceof Date) return t.getTime();
  if (typeof t._seconds === 'number') return t._seconds * 1000;
  const n = new Date(t).getTime();
  return Number.isNaN(n) ? 0 : n;
};
const iso = (t) => (toMillis(t) ? new Date(toMillis(t)).toISOString() : null);
const toMinute = (ms) => { const d = new Date(ms); d.setSeconds(0, 0); return d; };

function insertSorted(list, value) {
  const out = Array.isArray(list) ? [...list] : [];
  let i = out.findIndex((v) => v > value);
  if (i === -1) i = out.length;
  out.splice(i, 0, value);
  return out;
}

/** What a buyer is shown of the property: never vendor details or the price. Honours "show suburb only". */
export function publicAddress(property) {
  const suburbOnly = property?.showSuburbOnly === true;
  // Address strings come in several shapes ("…, Jacobs Well QLD 4208, Australia", "…, Pimpama QLD, Australia, 4209").
  const segments = (s) => String(s || '').split(',').map((x) => x.replace(/\bAustralia\b/gi, '').trim()).filter(Boolean);
  if (suburbOnly || !property?.formattedAddress) return { street: segments(property?.address).join(', ') || 'This property', suburb: '' };
  const [street, ...rest] = segments(property.formattedAddress);
  const suburb = rest.reduce((acc, seg) => {
    if (/^\d{4}$/.test(seg) && acc.length) acc[acc.length - 1] = `${acc[acc.length - 1]} ${seg}`; // a lone postcode joins its suburb
    else acc.push(seg);
    return acc;
  }, []);
  return { street: street || segments(property.address).join(', ') || 'This property', suburb: suburb.join(', ') };
}

const agentDisplayName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.displayName || 'Your agent';

async function officeBrand(db, officeId) {
  if (!officeId) return null;
  const office = await db.collection('offices').doc(officeId).get();
  const brandId = office.exists ? office.data().agencyBrandId : null;
  if (!brandId) return null;
  const brand = await db.collection('agencyBrands').doc(brandId).get();
  if (!brand.exists) return null;
  const b = brand.data();
  return { name: b.name || null, logoUrl: b.logoUrl || null, primary: b.colors?.primary || null };
}

const sessionState = (s, now = Date.now()) => {
  if (s.status === 'ended') return 'ended';
  return toMillis(s.endsBy) && now > toMillis(s.endsBy) ? 'ended' : 'active';
};

function sessionSummary(id, s, now) {
  return {
    id,
    propertyId: s.propertyId,
    mode: s.mode,
    state: sessionState(s, now),
    startedAt: iso(s.startedAt),
    endedAt: iso(s.endedAt) || (sessionState(s, now) === 'ended' ? iso(s.endsBy) : null),
    checkIns: s.checkInCount || 0,
  };
}

/* ── Agent side ─────────────────────────────────────────────────────────────────────────────────── */

function assertPilot(uid, env) {
  if (!isPilotAgent(uid, env)) throw new OpenHomeError('Open Home isn’t available on this account.', 403, 'not-in-pilot');
}

async function ownedCampaign(db, uid, propertyId) {
  if (typeof propertyId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(propertyId)) throw new OpenHomeError('Choose a campaign.', 400);
  const snap = await db.collection('properties').doc(propertyId).get();
  if (!snap.exists || snap.data().userId !== uid || snap.data().archived === true) throw new OpenHomeError('That campaign isn’t available.', 404, 'no-campaign');
  return snap.data();
}

/** The pilot agent's own current (not archived) campaigns, with any open home running on each. */
export async function listPilotCampaigns(db, { uid, env = process.env, now = Date.now() }) {
  assertPilot(uid, env);
  const [props, sessions] = await Promise.all([
    db.collection('properties').where('userId', '==', uid).get(),
    db.collection(COLLECTIONS.sessions).where('agentUid', '==', uid).get(),
  ]);
  const active = new Map();
  sessions.docs.forEach((d) => { if (sessionState(d.data(), now) === 'active') active.set(d.data().propertyId, sessionSummary(d.id, d.data(), now)); });
  return props.docs
    .filter((d) => d.data().archived !== true)
    .map((d) => {
      const p = d.data();
      return { id: d.id, ...publicAddress(p), imageUrl: Array.isArray(p.imageUrls) ? p.imageUrls[0] || null : null, isPublic: p.visibility === true, activeSession: active.get(d.id) || null };
    })
    .sort((a, b) => a.street.localeCompare(b.street));
}

export async function listPilotSessions(db, { uid, env = process.env, now = Date.now() }) {
  assertPilot(uid, env);
  const snap = await db.collection(COLLECTIONS.sessions).where('agentUid', '==', uid).get();
  return snap.docs.map((d) => sessionSummary(d.id, d.data(), now)).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')).slice(0, 30);
}

export async function startPilotSession(db, { uid, propertyId, mode, env = process.env, now = Date.now() }) {
  assertPilot(uid, env);
  assertWritable(env);
  if (!MODES.includes(mode)) throw new OpenHomeError('Choose live or test.', 400);
  const property = await ownedCampaign(db, uid, propertyId);
  const id = newSessionCode();
  const range = computePriceOpinionRange(property);
  const session = {
    propertyId,
    agentUid: uid,
    mode,
    status: 'active',
    startedAt: new Date(now),
    endsBy: new Date(now + LIMITS.sessionHours * 3600 * 1000),
    endedAt: null,
    range: { min: range.min, max: range.max },
    checkInCount: 0,
    noticeVersion: NOTICE_VERSION,
  };
  // One running open home per campaign, even if "Start" is pressed twice at once: the pointer is read and written in
  // the same transaction as the new session.
  const activeRef = db.collection(COLLECTIONS.active).doc(propertyId);
  return db.runTransaction(async (tx) => {
    const pointer = await tx.get(activeRef);
    if (pointer.exists) {
      const current = await tx.get(db.collection(COLLECTIONS.sessions).doc(pointer.data().sessionId));
      if (current.exists && current.data().agentUid === uid && sessionState(current.data(), now) === 'active') {
        return sessionSummary(current.id, current.data(), now);
      }
    }
    tx.create(db.collection(COLLECTIONS.sessions).doc(id), session);
    tx.create(db.collection(COLLECTIONS.opinions).doc(id), { propertyId, agentUid: uid, mode, amounts: [], count: 0 });
    tx.create(db.collection(COLLECTIONS.guards).doc(id), { hashes: [] });
    tx.set(activeRef, { sessionId: id, agentUid: uid });
    return sessionSummary(id, session, now);
  });
}

async function ownSession(db, uid, sessionId) {
  if (!isSessionCode(sessionId)) throw new OpenHomeError('Open home not found.', 404, 'no-session');
  const snap = await db.collection(COLLECTIONS.sessions).doc(sessionId).get();
  if (!snap.exists || snap.data().agentUid !== uid) throw new OpenHomeError('Open home not found.', 404, 'no-session');
  return snap;
}

/** Everything the agent sees for one open home: the attendance register and the anonymous aggregate only. */
export async function pilotSessionReport(db, { uid, sessionId, env = process.env, now = Date.now() }) {
  assertPilot(uid, env);
  const snap = await ownSession(db, uid, sessionId);
  const s = snap.data();
  const [propSnap, attendance, opinions] = await Promise.all([
    db.collection('properties').doc(s.propertyId).get(),
    db.collection(COLLECTIONS.attendance).where('sessionId', '==', sessionId).get(),
    db.collection(COLLECTIONS.opinions).doc(sessionId).get(),
  ]);
  const p = propSnap.exists ? propSnap.data() : {};
  const summary = sessionSummary(snap.id, s, now);
  return {
    session: summary,
    property: { id: s.propertyId, ...publicAddress(p), imageUrl: Array.isArray(p.imageUrls) ? p.imageUrls[0] || null : null },
    attendance: attendance.docs
      .map((d) => d.data())
      .sort((a, b) => toMillis(a.checkedInAt) - toMillis(b.checkedInAt))
      .map((a) => ({
        fullName: a.fullName,
        mobile: a.mobile,
        email: a.email,
        checkedInAt: iso(a.checkedInAt),
        marketingConsent: a.marketingConsent === true,
        interest: a.interest ? { wants: Array.isArray(a.interest.wants) ? a.interest.wants : [] } : null,
      })),
    // The ONLY opinion data that leaves the server for an agent.
    opinions: summarizeOpinions(opinions.exists ? opinions.data().amounts : [], { range: s.range, ended: summary.state === 'ended' }),
  };
}

export async function endPilotSession(db, { uid, sessionId, env = process.env, now = Date.now() }) {
  assertPilot(uid, env);
  assertWritable(env);
  const snap = await ownSession(db, uid, sessionId);
  if (snap.data().status !== 'ended') await snap.ref.update({ status: 'ended', endedAt: new Date(now) });
  return { ok: true };
}

/** Test sessions only: delete the session and everything collected in it. */
export async function deleteTestSession(db, { uid, sessionId, env = process.env }) {
  assertPilot(uid, env);
  assertWritable(env);
  const snap = await ownSession(db, uid, sessionId);
  if (snap.data().mode !== 'test') throw new OpenHomeError('Only test open homes can be deleted.', 400, 'not-test');
  const attendance = await db.collection(COLLECTIONS.attendance).where('sessionId', '==', sessionId).get();
  const batch = db.batch();
  attendance.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.collection(COLLECTIONS.opinions).doc(sessionId));
  batch.delete(db.collection(COLLECTIONS.guards).doc(sessionId));
  batch.delete(snap.ref);
  const pointer = await db.collection(COLLECTIONS.active).doc(snap.data().propertyId).get();
  if (pointer.exists && pointer.data().sessionId === sessionId) batch.delete(pointer.ref);
  await batch.commit();
  return { ok: true, deleted: attendance.size };
}

/* ── Buyer side (public, no login) ──────────────────────────────────────────────────────────────── */

async function liveSession(db, code, env, now, { allowEnded = false } = {}) {
  if (!isSessionCode(code)) throw new OpenHomeError('This open home link isn’t valid.', 404, 'no-session');
  const snap = await db.collection(COLLECTIONS.sessions).doc(code).get();
  if (!snap.exists || !isPilotAgent(snap.data().agentUid, env)) throw new OpenHomeError('This open home link isn’t valid.', 404, 'no-session');
  const s = snap.data();
  if (!allowEnded && sessionState(s, now) !== 'active') throw new OpenHomeError('This open home has finished.', 410, 'ended');
  return snap;
}

/** What the buyer's phone needs to show the open home. Nothing private: no vendor details, price, ids or counts. */
export async function publicVisit(db, { code, env = process.env, now = Date.now() }) {
  const snap = await liveSession(db, code, env, now, { allowEnded: true });
  const s = snap.data();
  const [propSnap, agentSnap] = await Promise.all([
    db.collection('properties').doc(s.propertyId).get(),
    db.collection('users').doc(s.agentUid).get(),
  ]);
  const p = propSnap.exists ? propSnap.data() : {};
  const agent = agentSnap.exists ? agentSnap.data() : {};
  const brand = await officeBrand(db, agent.officeId).catch(() => null);
  return {
    state: sessionState(s, now),
    mode: s.mode,
    noticeVersion: NOTICE_VERSION,
    property: { ...publicAddress(p), imageUrl: Array.isArray(p.imageUrls) ? p.imageUrls[0] || null : null, agentName: agentDisplayName(agent) },
    brand,
    range: { min: s.range.min, max: s.range.max },
  };
}

export async function pilotCheckIn(db, { code, body, env = process.env, now = Date.now() }) {
  assertWritable(env);
  const sessionSnap = await liveSession(db, code, env, now);
  const v = validateCheckIn(body || {});
  if (!v.ok) throw Object.assign(new OpenHomeError('Please check your details.', 400, 'invalid'), { errors: v.errors });
  const s = sessionSnap.data();
  const ref = db.collection(COLLECTIONS.attendance).doc();
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(sessionSnap.ref);
    if ((fresh.data().checkInCount || 0) >= LIMITS.checkInsPerSession) throw new OpenHomeError('This open home is full. Please see the agent.', 429, 'full');
    tx.create(ref, {
      sessionId: code,
      propertyId: s.propertyId,
      agentUid: s.agentUid,
      mode: s.mode,
      fullName: v.value.fullName,
      mobile: v.value.mobile,
      email: v.value.email,
      marketingConsent: (body || {}).updatesOptIn === true,
      noticeVersion: NOTICE_VERSION,
      checkedInAt: toMinute(now),
      interest: null,
    });
    tx.update(sessionSnap.ref, { checkInCount: (fresh.data().checkInCount || 0) + 1 });
  });
  return { ok: true, ref: ref.id };
}

/**
 * The anonymous opinion. Takes the session code, the amount and a random per-phone token (to ignore accidental
 * repeats) and NOTHING else: no check-in reference, name, cookie or account, and nothing is written with a time.
 */
export async function pilotOpinion(db, { code, amount, device, env = process.env, now = Date.now() }) {
  assertWritable(env);
  const sessionSnap = await liveSession(db, code, env, now);
  const s = sessionSnap.data();
  const value = Math.round(Number(amount));
  if (!Number.isFinite(value) || value % PRICE_OPINION_STEP !== 0 || value < s.range.min || value > s.range.max) {
    throw new OpenHomeError('Please choose a price on the slider.', 400, 'bad-amount');
  }
  if (typeof device !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(device)) throw new OpenHomeError('Please reload the page and try again.', 400, 'bad-device');
  const hash = createHash('sha256').update(`${code}:${device}`).digest('hex');
  const opinionsRef = db.collection(COLLECTIONS.opinions).doc(code);
  const guardsRef = db.collection(COLLECTIONS.guards).doc(code);
  return db.runTransaction(async (tx) => {
    const [fresh, ops, guards] = await Promise.all([tx.get(sessionSnap.ref), tx.get(opinionsRef), tx.get(guardsRef)]);
    if (sessionState(fresh.data(), now) !== 'active') throw new OpenHomeError('This open home has finished.', 410, 'ended');
    const hashes = guards.exists ? guards.data().hashes || [] : [];
    if (hashes.includes(hash)) return { ok: true, duplicate: true };
    const count = ops.exists ? ops.data().count || 0 : 0;
    if (count >= (fresh.data().checkInCount || 0) + LIMITS.opinionSlack) {
      throw new OpenHomeError('Thanks, we have this open home’s opinions.', 429, 'limit');
    }
    tx.set(opinionsRef, { propertyId: s.propertyId, agentUid: s.agentUid, mode: s.mode, amounts: insertSorted(ops.exists ? ops.data().amounts : [], value), count: count + 1 });
    tx.set(guardsRef, { hashes: insertSorted(hashes, hash) });
    return { ok: true };
  });
}

/** Register interest: identity side only (the buyer's own check-in record). Never carries an opinion. */
export async function pilotInterest(db, { code, ref, wants, env = process.env, now = Date.now() }) {
  assertWritable(env);
  const sessionSnap = await liveSession(db, code, env, now, { allowEnded: true });
  if (now > toMillis(sessionSnap.data().startedAt) + LIMITS.interestHours * 3600 * 1000) throw new OpenHomeError('This open home has finished.', 410, 'ended');
  if (typeof ref !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(ref)) throw new OpenHomeError('Please check in first.', 400, 'bad-ref');
  const att = await db.collection(COLLECTIONS.attendance).doc(ref).get();
  if (!att.exists || att.data().sessionId !== code) throw new OpenHomeError('Please check in first.', 404, 'bad-ref');
  const list = Array.isArray(wants) ? [...new Set(wants.filter((w) => WANTS.has(w)))] : [];
  await att.ref.update({ interest: { wants: list } });
  return { ok: true };
}
