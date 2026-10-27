import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/clientApp';

/**
 * Firestore-facing half of the iPad kiosk's durable queue (see kioskOutbox.js).
 *
 * - Opinions keep exactly the anonymous shape the open-home mode has always
 *   written (type 'opinion', fromWeb, fromIpadMode, no identity).
 * - Registrations use the same document and fields as the website's "Register
 *   interest" form, then go through the existing /api/offers/notify-interest
 *   route, so the agent's email and its "View Registration" deep link are the
 *   exact ones agents already receive.
 * - NOTHING here ever sets `userId`. A kiosk may be left signed in as the
 *   listing agent or an office admin; a registration typed by a visitor must
 *   never be attributed to that account (see utils/registrationIdentity.js).
 * - Writes are `setDoc(..., { merge: true })` on a pre-generated id with a
 *   STABLE client `createdAt`, so retrying is idempotent and a late retry of
 *   the opinion can't overwrite registration fields added afterwards.
 */

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 20-char Firestore-style id, generated locally (no network round trip). */
export function generateOfferId() {
  const bytes = new Uint8Array(20);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 20; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

export function generateKioskSessionId() {
  return `ipad_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function buildOpinionItem({ propertyId, opinion, sessionId, visitorId }) {
  return {
    kind: 'opinion',
    docId: opinion.id,
    notify: false,
    data: {
      type: 'opinion',
      propertyId,
      sessionId,
      visitorId: visitorId || null,
      offerAmount: Math.round(opinion.amount),
      fromWeb: true,
      fromIpadMode: true,
      createdAtIso: new Date(opinion.at).toISOString(),
    },
  };
}

export function buildRegistrationItem({ propertyId, docId, sessionId, visitorId, amount, createdAtIso, buyer }) {
  return {
    kind: 'registration',
    docId,
    notify: true,
    data: {
      type: 'opinion',
      propertyId,
      sessionId,
      visitorId: visitorId || null,
      ...(amount ? { offerAmount: Math.round(amount) } : {}), // only a real opinion's amount, never invented
      fromWeb: true,
      fromIpadMode: true,
      serious: true,
      nextAction: 'contact',
      timeframe: null,
      buyerType: null,
      isFirstHomeBuyer: false,
      isInvestor: false,
      buyerName: `${buyer.firstName.trim()} ${buyer.lastName.trim()}`.trim(),
      buyerEmail: buyer.email.trim().toLowerCase(),
      buyerPhone: buyer.phone.trim(),
      createdAtIso,
    },
  };
}

/** Resolves only once Firestore has acknowledged the write. */
export async function writeKioskItem(item) {
  const { createdAtIso, ...fields } = item.data;
  await setDoc(
    doc(db, 'offers', item.docId),
    { ...fields, createdAt: Timestamp.fromDate(new Date(createdAtIso)), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Existing, idempotent agent-notification route; throws on any non-2xx so the queue retries. */
export async function notifyKioskItem(item) {
  const res = await fetch('/api/offers/notify-interest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId: item.docId, propertyId: item.data.propertyId }),
  });
  if (!res.ok) throw new Error(`notify-interest ${res.status}`);
}

/** localStorage if it really works (private mode / blocked storage throws); otherwise null. */
export function safeLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const k = '__pm_kiosk_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return null;
  }
}
