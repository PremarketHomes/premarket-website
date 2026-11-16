import { FieldValue } from 'firebase-admin/firestore';
import { LIVE_PROJECT_ID, backendProjectId, pointsAtLiveBackend } from './environmentGuard';
import { loadActiveOffice, isUsableAccount } from './bsoService';

/**
 * Promotions: HPHNOVEMBER = one free Premarket campaign per eligible Harcourts Property Hub SELLING AGENT.
 *
 * Rules (all decided server-side):
 *  - The redemption belongs to the campaign's assigned selling agent (the property owner, `userId`), never to the uploader.
 *    A BSO or office admin can redeem it for any number of different agents; each agent gets exactly one.
 *  - Eligible = the selling agent's server-side `users/{uid}.officeId` is the HPH office, that office is active, and the
 *    account is a usable agent account. Nothing the browser sends about offices is trusted.
 *  - The campaign must be CREATED (server commit) before 30 Nov 2026 00:00 Australia/Brisbane. Checking the code earlier
 *    reserves nothing. The promotion expires automatically.
 *  - Redemption is atomic with the campaign: one Firestore transaction creates the property, its server-only billing
 *    record `propertyCharges/{propertyId}` already 'excluded' (so no sweep, invoice run, Xero send or retry can ever bill it),
 *    and the immutable redemption `promoRedemptions/{CODE}_{agentUid}`. The deterministic redemption id is the one-per-agent
 *    lock: two simultaneous attempts for the same agent (any tab, any uploader, any upload method) cannot both commit.
 *  - Redemption data lives only in server-only collections (firestore.rules default-deny); nothing is written to the
 *    public property document.
 */

export const HPH_OFFICE_ID = 'ioxigzf4hcRtowqL4C94'; // Harcourts Property Hub (officeAdminInfo), confirmed 2026-11-16

export const PROMOTIONS = Object.freeze({
  HPHNOVEMBER: Object.freeze({
    code: 'HPHNOVEMBER',
    officeIds: Object.freeze([HPH_OFFICE_ID]),
    // 30 Nov 2026 00:00 in Queensland (AEST, UTC+10, no daylight saving) = 2026-11-29T14:00:00Z. Last valid instant:
    // 29 Nov 2026 23:59:59.999 Queensland time.
    endsAtMs: Date.parse('2026-11-30T00:00:00+10:00'),
    endsLabel: '29 November 2026, 11:59 pm Queensland time',
    exclusionReason: 'HPHNOVEMBER promotion: this HPH agent’s first Premarket campaign is free. Not billable.',
  }),
});

export const PROMO_MESSAGES = Object.freeze({
  applied: (code) => `${code} applied — this agent’s first Premarket campaign is FREE.`,
  alreadyRedeemed: 'This agent has already used their free November campaign.',
  invalid: 'That promo code isn’t valid. Check the spelling and try again.',
  expired: (promo) => `${promo.code} has expired. It was available until ${promo.endsLabel}.`,
  notEligible: 'This promo code is only available to Harcourts Property Hub agents.',
  withTestCampaign: 'A promo code can’t be combined with a test campaign.',
});

export class PromoError extends Error {
  constructor(reason, message, status) { super(message); this.name = 'PromoError'; this.reason = reason; this.status = status; }
}

export const normalizePromoCode = (raw) => String(raw ?? '').trim().toUpperCase();
export const redemptionIdFor = (code, agentUid) => `${code}_${agentUid}`;
const isAgentUser = (u) => !!(u?.agent || u?.isAgent || u?.roles?.includes?.('agent'));

/**
 * Offices eligible for a promotion. A non-production test office (PROMO_TEST_OFFICE_ID) is honoured ONLY when the server
 * is not the live project (staging / emulator), so it can never widen the promotion in production.
 */
export function eligibleOfficeIds(promo, env = process.env) {
  const test = env.PROMO_TEST_OFFICE_ID && backendProjectId(env) !== LIVE_PROJECT_ID && !pointsAtLiveBackend(env) ? [env.PROMO_TEST_OFFICE_ID] : [];
  return [...promo.officeIds, ...test];
}

const fail = (reason, message, status) => { throw new PromoError(reason, message, status); };

/** Resolve the promotion or throw a client-safe PromoError ('invalid' | 'expired'). */
export function resolvePromotion(rawCode, now = Date.now()) {
  const promo = PROMOTIONS[normalizePromoCode(rawCode)];
  if (!promo) fail('invalid', PROMO_MESSAGES.invalid, 400);
  if (now >= promo.endsAtMs) fail('expired', PROMO_MESSAGES.expired(promo), 400);
  return promo;
}

/**
 * Full eligibility for the SELLING AGENT `ownerUid` (reads users + office + redemption; reserves nothing). Throws PromoError,
 * or returns { promo, owner, officeId }.
 */
export async function checkPromotionForAgent(db, { code, ownerUid, now = Date.now(), env = process.env }) {
  const promo = resolvePromotion(code, now);
  if (typeof ownerUid !== 'string' || !ownerUid) fail('not-eligible', PROMO_MESSAGES.notEligible, 400);
  const snap = await db.collection('users').doc(ownerUid).get();
  const owner = snap.exists ? { uid: ownerUid, ...snap.data() } : null;
  if (!owner || !isAgentUser(owner) || !isUsableAccount(owner) || !eligibleOfficeIds(promo, env).includes(owner.officeId)) {
    fail('not-eligible', PROMO_MESSAGES.notEligible, 403);
  }
  if (!(await loadActiveOffice(db, owner.officeId))) fail('not-eligible', PROMO_MESSAGES.notEligible, 403);
  const red = await db.collection('promoRedemptions').doc(redemptionIdFor(promo.code, ownerUid)).get();
  if (red.exists) fail('already-redeemed', PROMO_MESSAGES.alreadyRedeemed, 409);
  return { promo, owner, officeId: owner.officeId };
}

/** The immutable redemption record (server-only collection). */
export function buildRedemption({ promo, ownerUid, officeId, propertyId, uploadedByUid, uploadedByRole, creationPath }) {
  return {
    code: promo.code,
    agentUid: ownerUid,
    officeId,
    propertyId,
    redeemedAt: FieldValue.serverTimestamp(),
    uploadedByUid,
    uploadedByRole, // 'agent' (the selling agent themself) | 'officeAdmin' | 'bso'
    creationPath, // 'agent-wizard' | 'managed'
  };
}

/**
 * Create `propertyRef` + its excluded billing record + the redemption in ONE transaction. Returns 'created', or
 * 'duplicate' when the same request already created this property (a retry / double click: nothing new is written).
 * Throws PromoError('already-redeemed') when this agent's redemption exists for a different campaign, or 'expired' if
 * the deadline passed before commit.
 */
export async function commitPromoCampaign(db, { promo, ownerUid, propertyRef, propertyData, exclusion, redemption }) {
  const redemptionRef = db.collection('promoRedemptions').doc(redemptionIdFor(promo.code, ownerUid));
  const chargeRef = db.collection('propertyCharges').doc(propertyRef.id);
  return db.runTransaction(async (tx) => {
    const prop = await tx.get(propertyRef);
    const red = await tx.get(redemptionRef);
    if (prop.exists) return 'duplicate';
    if (red.exists) fail('already-redeemed', PROMO_MESSAGES.alreadyRedeemed, 409);
    if (Date.now() >= promo.endsAtMs) fail('expired', PROMO_MESSAGES.expired(promo), 400);
    tx.create(propertyRef, propertyData);
    tx.create(chargeRef, exclusion);
    tx.create(redemptionRef, redemption);
    return 'created';
  });
}
