/**
 * Recording marketing channel counts (Email / SMS links, see utils/campaignChannels.js). Counts only.
 *
 * Stored, both server-only (default deny in firestore.rules, Admin SDK only):
 *   campaignChannelStats/{propertyId}   { propertyId, email: { views, opinions }, sms: { views, opinions } }
 *                                       Running totals. No buyer, visitor, session, offer, amount or time per event.
 *   campaignChannelGuards/{propertyId}  { h: [sorted short hashes] }
 *                                       Which opinions were already counted, so one opinion is counted once. Each
 *                                       entry is a one-way hash of the opinion's id and says nothing about which
 *                                       channel it was counted under; the list is kept sorted so it holds no order.
 *
 * Never written: the channel is NOT added to the opinion (offers), to propertyViews, propertyViewSessions or
 * propertyEngagement, or to analytics events. Those records carry visitor/session ids (and, after a registration, the
 * buyer's identity on the same offers document), so a per-record channel there would let an opinion be traced to a
 * channel and on to a person. Keeping channels as campaign-level counters means the only question the data can answer is
 * "how did each link perform", never "which link did this buyer use".
 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { isChannel } from '../../utils/campaignChannels';
import { isExcludedOpinion } from '../../utils/opinionExclusion';
import { buildChannelReport } from './channelReport';

export const CHANNEL_STATS = 'campaignChannelStats';
export const CHANNEL_GUARDS = 'campaignChannelGuards';

// An opinion is credited to a channel only by the page that just created it: the call must arrive within this long of
// the opinion being saved (so an older opinion can never be re-labelled later).
export const OPINION_CREDIT_WINDOW_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
// ~16 bytes per entry; far below Firestore's 1 MB document limit and far above any campaign's opinion count.
export const MAX_GUARDS = 20000;

const PROPERTY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const OFFER_ID_RE = /^[A-Za-z0-9]{1,64}$/;

const millis = (t) => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  if (t instanceof Date) return t.getTime();
  return 0;
};

/** One-way, order-free marker that an opinion has been counted (never the channel). */
export const guardHash = (propertyId, offerId) => createHash('sha256').update(`${propertyId}:${offerId}`).digest('hex').slice(0, 16);

/**
 * Count one open of a channel's link. The caller (POST /api/property-visit) has already counted the view in the
 * campaign's own stats.views, so channel views are always a part of Total Views. Returns true when counted.
 */
export async function recordChannelView(db, { propertyId, channel }) {
  if (!isChannel(channel) || typeof propertyId !== 'string' || !PROPERTY_ID_RE.test(propertyId)) return false;
  await db.collection(CHANNEL_STATS).doc(propertyId).set(
    { propertyId, [channel]: { views: FieldValue.increment(1) } },
    { merge: true },
  );
  return true;
}

/**
 * Why an opinion may NOT be credited to a channel (null = it may). Only a just-created, anonymous web price opinion,
 * created by the same browser tab that asks, for the campaign it names.
 */
export function opinionCreditRefusal(offer, { propertyId, sessionId, now }) {
  if (!offer) return 'not-found';
  if (offer.type !== 'opinion') return 'not-opinion';
  if (offer.propertyId !== propertyId) return 'other-campaign';
  if (!sessionId || offer.sessionId !== sessionId) return 'not-this-visitor';
  const amount = Number(offer.offerAmount);
  if (!Number.isFinite(amount) || amount <= 0) return 'no-price';
  // An opinion already carrying a registration (or an account) is never processed: channel counting stays entirely
  // apart from buyer identity, and does not build on the older design that keeps a registration on the opinion's record.
  if (offer.serious === true || offer.buyerName || offer.buyerEmail || offer.buyerPhone || offer.userId) return 'registered';
  if (offer.fromIpadMode || offer.fromTvDisplay) return 'kiosk';
  if (isExcludedOpinion(offer)) return 'excluded';
  const created = millis(offer.createdAt);
  if (!created || now - created > OPINION_CREDIT_WINDOW_MS || created - now > CLOCK_SKEW_MS) return 'not-new';
  return null;
}

/**
 * Credit one new anonymous price opinion to the channel of the link its page was opened with. Counted at most once per
 * opinion; a later edit of the same opinion is never counted again. Returns { counted, reason? } (reason is for tests
 * only: the route never tells the browser).
 */
export async function recordChannelOpinion(db, { propertyId, offerId, sessionId, channel, now = Date.now() }) {
  if (!isChannel(channel)) return { counted: false, reason: 'no-channel' };
  if (typeof propertyId !== 'string' || !PROPERTY_ID_RE.test(propertyId)) return { counted: false, reason: 'invalid' };
  if (typeof offerId !== 'string' || !OFFER_ID_RE.test(offerId)) return { counted: false, reason: 'invalid' };
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) return { counted: false, reason: 'invalid' };

  const offerRef = db.collection('offers').doc(offerId);
  const guardRef = db.collection(CHANNEL_GUARDS).doc(propertyId);
  const statsRef = db.collection(CHANNEL_STATS).doc(propertyId);

  return db.runTransaction(async (tx) => {
    const offerSnap = await tx.get(offerRef);
    const guardSnap = await tx.get(guardRef);
    const refusal = opinionCreditRefusal(offerSnap.exists ? offerSnap.data() : null, { propertyId, sessionId, now });
    if (refusal) return { counted: false, reason: refusal };

    const hash = guardHash(propertyId, offerId);
    const hashes = guardSnap.exists && Array.isArray(guardSnap.data().h) ? guardSnap.data().h : [];
    if (hashes.includes(hash)) return { counted: false, reason: 'already-counted' };
    if (hashes.length >= MAX_GUARDS) return { counted: false, reason: 'full' };

    tx.set(guardRef, { h: [...hashes, hash].sort() });
    tx.set(statsRef, { propertyId, [channel]: { opinions: FieldValue.increment(1) } }, { merge: true });
    return { counted: true };
  });
}

/**
 * The report's Marketing Channel Performance block (channelReport.js), or null if it can't be read right now: the
 * rest of the report never fails because of it.
 */
export async function loadChannelReport(db, { propertyId, property, priceCount }) {
  try {
    const snap = await db.collection(CHANNEL_STATS).doc(propertyId).get();
    return buildChannelReport({
      channelStats: snap.exists ? snap.data() : null,
      propertyStats: property?.stats,
      priceCount,
    });
  } catch (err) {
    console.error('channel report unavailable:', err?.message || err);
    return null;
  }
}
