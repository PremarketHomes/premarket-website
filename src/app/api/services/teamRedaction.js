/**
 * What a TEAM MEMBER (a colleague, not the listing agent and not an office
 * administrator) may see of another agent's property report.
 *
 * Everything here is an ALLOWLIST: a field added to an offer, like or property
 * document later is private to the team until it is deliberately added below.
 * Raw `offers`, `likes` and buyer-profile documents are never returned — each
 * row is rebuilt from scratch.
 *
 * Opinions: see opinionPrivacy.separateOpinions({ withIdentity: false }) —
 * anonymous amounts, plus "Registered buyer N" rows saying only what each buyer
 * wants (no name, contact, preferences, real id or price).
 */

const pick = (data, fields) => {
  const out = {};
  for (const f of fields) if (data?.[f] !== undefined) out[f] = data[f];
  return out;
};

// Offers (opinions) are no longer redacted row by row here: every report, the team level included, gets the separated
// shape from opinionPrivacy.js (anonymous prices + registrations without prices; no identity at team level).

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
