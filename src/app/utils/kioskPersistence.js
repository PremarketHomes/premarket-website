import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/clientApp';
import { registrationRecord } from './opinionRecords';

/**
 * Firestore-facing half of the iPad kiosk's durable queue (see kioskOutbox.js).
 *
 * - Opinions keep exactly the anonymous shape the open-home mode has always
 *   written (type 'opinion', fromWeb, fromIpadMode, no identity).
 * - Registrations are their OWN record (a new id, never the opinion's), with the
 *   same fields as the website's "Register interest" form and no price, session
 *   or device id (utils/opinionRecords.js). They then go through the existing
 *   /api/offers/notify-interest route, so the agent's email and its "View
 *   Registration" deep link are the exact ones agents already receive.
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

// The opinion: anonymous, amount only (plus the per-visit random session id). No device id: the iPad's device id is
// the same for every visitor and is not needed.
export function buildOpinionItem({ propertyId, opinion, sessionId }) {
  return {
    kind: 'opinion',
    docId: opinion.id,
    notify: false,
    data: {
      type: 'opinion',
      propertyId,
      sessionId,
      offerAmount: Math.round(opinion.amount),
      fromWeb: true,
      fromIpadMode: true,
      createdAtIso: new Date(opinion.at).toISOString(),
    },
  };
}

// The registration: its OWN record with its own new id (utils/opinionRecords.js) - the visitor's details only. Never
// the opinion's id, amount, session id or device id, so nothing ties it to the price they gave.
export function buildRegistrationItem({ propertyId, docId, createdAtIso, buyer }) {
  return {
    kind: 'registration',
    docId,
    notify: true,
    data: {
      ...registrationRecord({
        propertyId,
        buyer: { name: `${buyer.firstName.trim()} ${buyer.lastName.trim()}`, email: buyer.email, phone: buyer.phone },
        answers: { nextAction: 'contact' },
        source: { fromIpadMode: true },
      }),
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
