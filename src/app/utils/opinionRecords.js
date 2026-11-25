/**
 * Price opinions and registrations are SEPARATE records. Shared by the browser and the server; no Firebase dependency.
 *
 * Both live in the `offers` collection (type 'opinion'), so every existing reader of registrations (the report, the
 * agent's "new registration" email, the CRM, buyer profiles, the buyer dashboard) keeps working unchanged:
 *
 *   price opinion   { type, propertyId, offerAmount, sessionId, fromWeb, createdAt, updatedAt, ... }
 *                   Anonymous: never a name, email, phone, account (userId) or `serious` flag.
 *   registration    { type, propertyId, serious: true, buyerName, buyerEmail, buyerPhone, userId?, nextAction,
 *                     timeframe, buyerType, isFirstHomeBuyer, isInvestor, fromWeb, createdAt, ... }
 *                   Never a price, never the browser's session id or device id, never the id of an opinion.
 *
 * The two share no key, so nothing in the data can say which price a registered buyer gave. firestore.rules enforces
 * the split for every client write (a record holding buyer details can never hold a price, a session id or a device
 * id). A registration is recognised by exactly that shape (isRegistrationOnly); no new field is needed, so the app
 * also works under the rules that were live before the split.
 *
 * Older records (before this split) may hold both on one document. They are left exactly as they are; every report
 * already separates them (api/services/opinionPrivacy.js), and agents can no longer read raw records from the browser.
 */
import { isExcludedOpinion } from './opinionExclusion';

/** Fields that identify a buyer. */
export const BUYER_IDENTITY_FIELDS = ['buyerName', 'buyerEmail', 'buyerPhone', 'userId'];

/** Fields a registration record may never hold: they would let it be matched to a price opinion. */
export const REGISTRATION_FORBIDDEN_FIELDS = ['offerAmount', 'sessionId', 'visitorId'];

const filled = (v) => v !== undefined && v !== null && v !== '';

export const hasPrice = (o) => {
  const n = Number(o?.offerAmount);
  return Number.isFinite(n) && n > 0;
};

export const hasBuyerIdentity = (o) => BUYER_IDENTITY_FIELDS.some((k) => filled(o?.[k]));

/**
 * A registration stored on its own (every registration made since the split): serious, with no price and none of
 * the ids that could match it to an opinion. Older registrations always carried the browser's session id (and were
 * sometimes combined with a price), so they are never mistaken for one: historical figures are unchanged.
 */
export const isRegistrationOnly = (o) => o?.serious === true
  && !hasPrice(o)
  && !REGISTRATION_FORBIDDEN_FIELDS.some((k) => o?.[k] !== undefined);

/**
 * Whether a record counts as one buyer opinion in the "Price Opinions" figures (dashboard cards, campaign lists, team
 * and BSO views, leadership, the shareable card, the buyer page's count). Unchanged for every older record; a
 * registration stored on its own is NOT an opinion (the buyer's price, if they gave one, is its own record and is
 * counted there), so a buyer who gives a price and registers is never counted twice.
 */
export const countsAsOpinion = (o) => o?.type === 'opinion' && !isExcludedOpinion(o) && !isRegistrationOnly(o);

/**
 * The fields of a new registration record, built from the buyer's typed details and answers. Whatever is passed in,
 * the result never carries a price, a session id, a device id or an opinion id.
 */
export function registrationRecord({ propertyId, buyer, answers = {}, source = {} }) {
  const record = {
    type: 'opinion',
    propertyId,
    serious: true,
    nextAction: answers.nextAction || 'contact',
    timeframe: answers.timeframe || null,
    buyerType: answers.buyerType || null,
    isFirstHomeBuyer: !!answers.isFirstHomeBuyer,
    isInvestor: !!answers.isInvestor,
    ...(answers.seriousnessLevel ? { seriousnessLevel: answers.seriousnessLevel } : {}),
    buyerName: String(buyer?.name || '').trim(),
    buyerEmail: String(buyer?.email || '').trim().toLowerCase() || null,
    buyerPhone: String(buyer?.phone || '').trim() || null,
    ...(buyer?.userId ? { userId: buyer.userId } : {}),
    fromWeb: true,
    ...(source.fromIpadMode ? { fromIpadMode: true } : {}),
    ...(source.fromTvDisplay ? { fromTvDisplay: true, ...(source.displayId ? { displayId: source.displayId } : {}) } : {}),
  };
  for (const k of REGISTRATION_FORBIDDEN_FIELDS) delete record[k];
  return record;
}
