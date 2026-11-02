/**
 * What a TEAM MEMBER (a colleague, not the listing agent and not an office
 * administrator) may see of another agent's property report.
 *
 * Everything here is an ALLOWLIST: a field added to an offer, like or property
 * document later is private to the team until it is deliberately added below.
 * Raw `offers`, `likes` and buyer-profile documents are never returned — each
 * row is rebuilt from scratch.
 *
 * Audited offer fields (see PropertyPageClient.js / tv/[id]/page.js writers):
 *   shown        type, offerAmount, createdAt, updatedAt, serious, fromWeb,
 *                isFirstHomeBuyer, isInvestor, buyerType, nextAction, timeframe
 *   withheld     buyerName, buyerEmail, buyerPhone, userName, userId, email,
 *                phone, sessionId, visitorId, displayId, interest-notification
 *                bookkeeping, and anything not listed (e.g. buyer preferences
 *                resolved from the linked account)
 * Buyers are labelled "Buyer 1…n" in creation order so rows stay distinguishable
 * without identifying anyone.
 */

const OFFER_FIELDS = [
  'type', 'offerAmount', 'createdAt', 'updatedAt', 'serious', 'fromWeb',
  'isFirstHomeBuyer', 'isInvestor', 'buyerType', 'nextAction', 'timeframe',
];

const millis = (t) => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  const n = new Date(t).getTime();
  return Number.isNaN(n) ? 0 : n;
};

const pick = (data, fields) => {
  const out = {};
  for (const f of fields) if (data?.[f] !== undefined) out[f] = data[f];
  return out;
};

/** Offer documents -> anonymous rows. `serializeValue` converts Timestamps. */
export function redactOffersForTeam(offers, serializeValue = (v) => v) {
  return [...offers]
    .sort((a, b) => millis(a.createdAt) - millis(b.createdAt))
    .map((o, i) => ({
      // Document ids are opaque and not derived from the buyer, but are not
      // needed by a read-only viewer either; use a positional key.
      id: `anon-${i + 1}`,
      ...serializeValue(pick(o, OFFER_FIELDS)),
      buyerName: o.serious === true ? `Buyer ${i + 1}` : null,
    }));
}

/** Likes carry the buyer's uid — a team member only needs the count/dates. */
export function redactLikesForTeam(likes, serializeValue = (v) => v) {
  return likes.map((l, i) => ({ id: `like-${i + 1}`, ...serializeValue(pick(l, ['createdAt'])) }));
}

// The property document is already publicly readable (firestore.rules), but a
// team view should still never relay contact-like or internal fields.
const SENSITIVE_PROPERTY_KEY = /(email|phone|mobile|contact|vendor|seller|owner|token|secret|billing|charge|invoice|xero|stripe|credential|apikey)/i;
const SAFE_PROPERTY_KEYS = new Set(['userId', 'agentId']);

export function redactPropertyForTeam(property) {
  const out = {};
  for (const [k, v] of Object.entries(property || {})) {
    if (SAFE_PROPERTY_KEYS.has(k) || !SENSITIVE_PROPERTY_KEY.test(k)) out[k] = v;
  }
  return out;
}
