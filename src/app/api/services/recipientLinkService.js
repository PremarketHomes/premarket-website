/**
 * Phase 2 — Personalised Recipient Links & Identifiable Buyer Engagement.
 *
 * Data model (all three collections are server-only — see firestore.rules
 * — every read/write goes through this service via the Admin SDK):
 *
 *   recipients/{recipientId}
 *     The one place a recipient's PII (name/email/mobile) lives.
 *     { name, email, mobile, agencyOwnerId, crmContactId, isTest,
 *       createdAt, updatedAt }
 *     agencyOwnerId is the uid of the agent/agency this contact belongs
 *     to — the same agent who owns the property they're being sent, so
 *     access can later be scoped per-agent the same way `offers` is.
 *
 *   recipientLinks/{token}
 *     The bearer token itself IS the document id — resolving a link is
 *     a single get() by id, no query/index needed, cheap at any scale.
 *     { recipientId, propertyId, agencyOwnerId, revoked, createdAt,
 *       createdBy }
 *     A token is only ever valid for the exact property it was issued
 *     for — see resolveRecipientToken.
 *
 *   recipientEngagement/{propertyId}_{recipientId}
 *     The attribution record itself. Deliberately named/shaped around
 *     "engagement attributable to this recipient's link", not "buyer X
 *     did Y" — see resolveRecipientToken's docblock and the Phase 2
 *     report's "token forwarding" section for why that distinction
 *     matters. Reuses the exact same session-boundary logic as Phase 1's
 *     anonymous propertyViewSessions (computeSessionUpdate) — the only
 *     difference is the key is a recipientId instead of an anonymous
 *     visitorId.
 *     { propertyId, recipientId, agencyOwnerId, firstViewedAt,
 *       lastViewedAt, attributableOpens, meaningfulSessionCount,
 *       currentSessionOpens, currentSessionStartedAt,
 *       scannerSuspectedOpens, updatedAt }
 *
 * None of this touches properties/{id}.stats.* (the legacy Views
 * counter), propertyViews, or propertyViewSessions — those remain
 * exactly as Phase 1 left them. This is a parallel, additive layer.
 */

import { randomBytes } from 'crypto';
import { adminDb } from '../../firebase/adminApp';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { computeSessionUpdate } from '../../utils/sessionWindow';

const RECIPIENTS_COLLECTION = 'recipients';
const LINKS_COLLECTION = 'recipientLinks';
const ENGAGEMENT_COLLECTION = 'recipientEngagement';

export function generateRecipientToken() {
  return `rl_${randomBytes(24).toString('hex')}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase() || null;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  return value;
}

/**
 * Finds an existing recipient for this agent by exact email match, or
 * creates one. Keyed by (agencyOwnerId, email) so the same buyer emailed
 * for two different campaigns by the same agent becomes one recipient
 * record, not a duplicate — the dedup key a future bulk-CRM import will
 * also need. Without an email (name-only contact), dedup isn't possible,
 * so a new record is always created.
 *
 * Never overwrites an existing non-empty field with a blank one — a
 * second import with less information than the first shouldn't erase
 * data already on file.
 */
export async function findOrCreateRecipient({ agencyOwnerId, name, email, mobile, crmContactId, isTest }) {
  const normalizedEmail = normalizeEmail(email);

  if (normalizedEmail) {
    const existingSnap = await adminDb
      .collection(RECIPIENTS_COLLECTION)
      .where('agencyOwnerId', '==', agencyOwnerId)
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      const existing = existingDoc.data();
      const patch = { updatedAt: FieldValue.serverTimestamp() };
      if (name && !existing.name) patch.name = name;
      if (mobile && !existing.mobile) patch.mobile = mobile;
      if (crmContactId && !existing.crmContactId) patch.crmContactId = crmContactId;
      await existingDoc.ref.set(patch, { merge: true });
      return existingDoc.id;
    }
  }

  const ref = adminDb.collection(RECIPIENTS_COLLECTION).doc();
  await ref.set({
    name: name || null,
    email: normalizedEmail,
    mobile: mobile || null,
    agencyOwnerId,
    crmContactId: crmContactId || null,
    isTest: !!isTest,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/**
 * Creates (or reuses) a recipient for each entry, then issues one fresh
 * token per (recipient, property) pair. Batched into a single Firestore
 * batch write for the token documents so this scales to hundreds of
 * contacts in one call without hundreds of round trips — the shape a
 * future bulk CRM import (Phase 2's "future database/CRM scale"
 * consideration) will reuse directly.
 *
 * Returns one entry per input recipient: { recipientId, token, url,
 * name, email }.
 */
export async function createRecipientLinksForProperty({ propertyId, createdBy, recipients, isTest, baseUrl }) {
  const propertyDoc = await adminDb.collection('properties').doc(propertyId).get();
  if (!propertyDoc.exists) {
    throw new Error('PROPERTY_NOT_FOUND');
  }
  const agencyOwnerId = propertyDoc.data().userId;

  const results = [];
  const batch = adminDb.batch();

  for (const r of recipients) {
    const recipientId = await findOrCreateRecipient({
      agencyOwnerId,
      name: r.name,
      email: r.email,
      mobile: r.mobile,
      crmContactId: r.crmContactId,
      isTest,
    });

    const token = generateRecipientToken();
    const linkRef = adminDb.collection(LINKS_COLLECTION).doc(token);
    batch.set(linkRef, {
      recipientId,
      propertyId,
      agencyOwnerId,
      revoked: false,
      isTest: !!isTest,
      createdBy,
      createdAt: FieldValue.serverTimestamp(),
    });

    results.push({
      recipientId,
      token,
      url: `${baseUrl}/find-property?propertyId=${encodeURIComponent(propertyId)}&rlt=${token}`,
      name: r.name || null,
      email: r.email || null,
    });
  }

  await batch.commit();
  return results;
}

/**
 * Resolves a recipient link token to the (recipientId, propertyId) it
 * legitimately identifies — the ONLY thing a bearer of the token proves
 * is "this browser has the link that was sent to this recipient's
 * inbox/phone". It does not, and cannot, prove the recipient personally
 * performed the action: the link can be forwarded (Luke → his wife), so
 * every caller of this function should treat the result as "engagement
 * attributable to this recipient's link", not "recipient X did this".
 *
 * Returns null (never throws) for: unknown token, malformed token,
 * revoked token, or a token being used against a DIFFERENT property
 * than it was issued for — the last of these matters most once these
 * links start getting shared/scraped, since it stops a token leaked
 * from one campaign being replayed against an unrelated property.
 */
export async function resolveRecipientToken(token, propertyId) {
  if (!token || typeof token !== 'string') return null;

  const linkDoc = await adminDb.collection(LINKS_COLLECTION).doc(token).get();
  if (!linkDoc.exists) return null;

  const link = linkDoc.data();
  if (link.revoked) return null;
  if (link.propertyId !== propertyId) return null;

  return { recipientId: link.recipientId, propertyId: link.propertyId, agencyOwnerId: link.agencyOwnerId };
}

/**
 * Applies one attributable open to a recipient's engagement record for a
 * property, using the identical inactivity-window session logic as
 * Phase 1's anonymous tracking (see sessionWindow.js) — just keyed by
 * recipientId instead of visitorId. Scanner-suspected opens are recorded
 * but excluded from attributableOpens/meaningfulSessionCount, mirroring
 * Phase 1 exactly.
 *
 * Runs in a transaction for the same reason Phase 1's does: two tabs (or
 * two devices — see the Phase 2 report's "multiple devices" section)
 * resolving the same token near-simultaneously must not corrupt the
 * counts.
 */
export async function recordRecipientEngagement({ propertyId, recipientId, agencyOwnerId, scannerSuspected, now }) {
  const docId = `${propertyId}_${recipientId}`;
  const ref = adminDb.collection(ENGAGEMENT_COLLECTION).doc(docId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;

    if (scannerSuspected) {
      tx.set(
        ref,
        {
          propertyId,
          recipientId,
          agencyOwnerId,
          scannerSuspectedOpens: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { scannerSuspected: true };
    }

    const existing = data
      ? {
          sessionCount: data.meaningfulSessionCount,
          totalOpens: data.attributableOpens,
          currentSessionOpens: data.currentSessionOpens,
          currentSessionStartedAt: toDate(data.currentSessionStartedAt),
          // lastViewedAt IS the last-activity timestamp here — there's no
          // separate internal field, to avoid storing the same instant
          // twice under two names.
          lastActivityAt: toDate(data.lastViewedAt),
        }
      : null;

    const update = computeSessionUpdate({ existing, now });

    tx.set(
      ref,
      {
        propertyId,
        recipientId,
        agencyOwnerId,
        firstViewedAt: data?.firstViewedAt || Timestamp.fromDate(now),
        lastViewedAt: Timestamp.fromDate(now),
        attributableOpens: update.totalOpens,
        meaningfulSessionCount: update.sessionCount,
        currentSessionOpens: update.currentSessionOpens,
        currentSessionStartedAt: Timestamp.fromDate(update.currentSessionStartedAt),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { scannerSuspected: false, isNewSession: update.isNewSession };
  });
}

/**
 * Admin/verification read: every recipient's engagement on one property,
 * joined with their (PII) identity from `recipients`. Callers of this
 * function MUST be an authorised admin — it deliberately returns
 * name/email, so it's only ever called from a superAdmin-gated route
 * (see /api/admin/recipient-links/engagement), never exposed to the
 * public browser.
 */
export async function getRecipientEngagementForProperty(propertyId) {
  const engagementSnap = await adminDb
    .collection(ENGAGEMENT_COLLECTION)
    .where('propertyId', '==', propertyId)
    .get();

  const rows = await Promise.all(
    engagementSnap.docs.map(async (d) => {
      const e = d.data();
      const recipientDoc = await adminDb.collection(RECIPIENTS_COLLECTION).doc(e.recipientId).get();
      const recipient = recipientDoc.exists ? recipientDoc.data() : null;
      return {
        recipientId: e.recipientId,
        name: recipient?.name || null,
        email: recipient?.email || null,
        isTest: recipient?.isTest || false,
        firstViewedAt: toDate(e.firstViewedAt),
        lastViewedAt: toDate(e.lastViewedAt),
        attributableOpens: e.attributableOpens || 0,
        meaningfulSessionCount: e.meaningfulSessionCount || 0,
        scannerSuspectedOpens: e.scannerSuspectedOpens || 0,
      };
    })
  );

  rows.sort((a, b) => (b.lastViewedAt?.getTime() || 0) - (a.lastViewedAt?.getTime() || 0));
  return rows;
}
