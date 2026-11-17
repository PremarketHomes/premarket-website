import { FieldValue } from 'firebase-admin/firestore';
import { PROMOTIONS, PromoError, checkPromotionForAgent, eligibleOfficeIds, redemptionIdFor, buildRedemption } from './promotions';

/**
 * Retroactively applying a promotion (HPHNOVEMBER) to a campaign whose agent forgot the code.
 *
 * Admin-only (the route calls verifyAdmin). Allowed only when ALL hold:
 *  - the charge is still PENDING: never in a draft run (remove it from the run first), never sent to Xero
 *    (invoiced/reversed), not already excluded, not a test campaign, not already a promotion;
 *  - it is billed to an eligible office (HPH);
 *  - the redemption belongs to the VERIFIED ASSIGNED SELLING AGENT, never the uploader (BSOs upload on agents' behalf):
 *    the owner (`userId`) when no roster agent is assigned, otherwise the unique HPH agent account with exactly the
 *    assigned name (unverifiable = refused). That agent must be a usable HPH agent in an active office;
 *  - the campaign was CREATED from the launch (16 Nov 2026 00:00 Queensland time) up to the existing cutoff
 *    (30 Nov 2026 00:00 Queensland time);
 *  - that agent has no redemption yet (the same deterministic promoRedemptions/{CODE}_{uid} lock as at creation).
 *
 * Applying is ONE transaction: re-checks the charge and the redemption, creates the redemption, moves the SAME charge
 * to 'excluded' with promoCode/promoRedemptionId (amounts untouched, so it shows "$200 waived"), and writes an audit
 * record of who applied it and when. Nothing is deleted; no second redemption can ever be created.
 */

export const RETRO_PROMO_CODE = 'HPHNOVEMBER';

// Retroactive window start per promotion (its launch); the end is the promotion's own endsAtMs.
const RETRO_STARTS = Object.freeze({
  HPHNOVEMBER: Object.freeze({ startsAtMs: Date.parse('2026-11-16T00:00:00+10:00'), startsLabel: '16 November 2026' }),
});

const MESSAGES = Object.freeze({
  notFound: 'Charge not found.',
  inRun: 'This campaign is in a draft invoice run. Remove it from the run first, then apply the promotion.',
  invoiced: 'This charge has already been sent to Xero and can’t be changed here.',
  notPending: 'Only pending charges can have a promotion applied.',
  alreadyPromo: 'A promotion has already been applied to this campaign.',
  test: 'Test campaigns aren’t billed, so a promotion doesn’t apply.',
  notOffice: 'Only Harcourts Property Hub campaigns are eligible.',
  noProperty: 'The campaign record could not be found.',
  noDate: 'The campaign has no creation date on record.',
  beforeLaunch: (promo, start) => `This campaign was created before ${promo.code} started (${start.startsLabel}).`,
  afterCutoff: (promo) => `This campaign was created after the ${promo.code} cutoff (${promo.endsLabel}).`,
  agentMismatch: 'The charge’s account doesn’t match the campaign. Check it manually.',
  assignedUnverified: 'The assigned selling agent couldn’t be matched to exactly one HPH agent account. Check it manually.',
});

const refuse = (reason, message, status = 409) => { throw new PromoError(reason, message, status); };
const toMs = (t) => {
  const d = t?.toDate ? t.toDate() : t instanceof Date ? t : typeof t === 'string' || typeof t === 'number' ? new Date(t) : null;
  const ms = d ? d.getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};
const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`;
const isAgentUser = (u) => !!(u?.agent || u?.isAgent || u?.roles?.includes?.('agent'));

/**
 * The verified assigned selling agent's uid (same rule as managedCampaignService.sellingAgentOf / utils/listingAgent.js):
 * no roster assignment → the owner (`userId`; for a BSO-managed campaign that is already the agent, the BSO being
 * `createdByUid`); roster-assigned (`agentId`) → the UNIQUE agent account in the office with exactly the assigned name.
 * Anything else is unverified (null) — never the uploader.
 */
async function assignedSellingAgentUid(db, property, officeId) {
  if (!property.agentId) return property.userId || null;
  const assignedName = property.agentName || (await db.collection('agents').doc(property.agentId).get()).data()?.name;
  if (!norm(assignedName) || !officeId) return null;
  const people = await db.collection('users').where('officeId', '==', officeId).get();
  const matches = people.docs.filter((d) => isAgentUser(d.data()) && norm(fullName(d.data())) === norm(assignedName));
  return matches.length === 1 ? matches[0].id : null;
}

/** Charge-only rules (status, run, test, promo, office). Throws PromoError. */
function assertChargeApplicable(charge, promo, env) {
  if (!charge) refuse('not-found', MESSAGES.notFound, 404);
  if (charge.status === 'queued' || (charge.status === 'pending' && charge.runId)) refuse('in-draft-run', MESSAGES.inRun);
  if (charge.status === 'invoiced' || charge.status === 'reversed') refuse('already-invoiced', MESSAGES.invoiced);
  if (charge.promoCode || charge.promoRedemptionId) refuse('already-promo', MESSAGES.alreadyPromo);
  if (charge.testCampaign === true) refuse('test-campaign', MESSAGES.test);
  if (charge.status !== 'pending') refuse('not-pending', MESSAGES.notPending);
  if (charge.billingEntityType !== 'office' || !eligibleOfficeIds(promo, env).includes(charge.officeId)) refuse('not-eligible', MESSAGES.notOffice, 403);
}

/**
 * Read-only eligibility check (reserves and writes nothing). Returns { promo, agentUid, accountUid, officeId, propertyId,
 * property } or throws PromoError with a client-safe message.
 */
export async function checkRetroPromotion(db, { chargeId, code = RETRO_PROMO_CODE, charge: given, env = process.env }) {
  const promo = PROMOTIONS[code];
  if (!promo) refuse('invalid', 'Unknown promotion.', 400);
  const charge = given || (await db.collection('propertyCharges').doc(chargeId).get()).data();
  assertChargeApplicable(charge, promo, env);

  const propertyId = charge.propertyId || chargeId;
  const property = (await db.collection('properties').doc(propertyId).get()).data();
  if (!property) refuse('no-property', MESSAGES.noProperty, 404);
  const createdAtMs = toMs(property.createdAt);
  if (createdAtMs == null) refuse('no-date', MESSAGES.noDate);
  const start = RETRO_STARTS[promo.code];
  if (start && createdAtMs < start.startsAtMs) refuse('before-launch', MESSAGES.beforeLaunch(promo, start));
  if (createdAtMs >= promo.endsAtMs) refuse('after-cutoff', MESSAGES.afterCutoff(promo));

  // The account the campaign (and its charge) sits under — for a roster-assigned listing this can be a BSO's.
  const accountUid = property.userId;
  if (!accountUid || accountUid !== charge.agentUserId) refuse('agent-mismatch', MESSAGES.agentMismatch);

  // The promotion is attributed to the verified assigned selling agent, never the uploader.
  const agentUid = await assignedSellingAgentUid(db, property, charge.officeId);
  if (!agentUid) refuse('assigned-unverified', MESSAGES.assignedUnverified);

  // Same rules as redeeming at creation, for THAT agent, judged at the campaign's creation time: usable HPH agent,
  // active office, no redemption yet.
  const { officeId } = await checkPromotionForAgent(db, { code, ownerUid: agentUid, now: createdAtMs, env });

  return { promo, agentUid, accountUid, officeId, propertyId, property };
}

/** Applies the promotion atomically (see file comment). Returns { chargeId, promoCode, redemptionId }. */
export async function applyRetroPromotion(db, { chargeId, code = RETRO_PROMO_CODE, adminUid, env = process.env }) {
  if (!adminUid) refuse('unauthorised', 'Admin required.', 403);
  const { promo, agentUid, accountUid, officeId, propertyId, property } = await checkRetroPromotion(db, { chargeId, code, env });

  const chargeRef = db.collection('propertyCharges').doc(chargeId);
  const redemptionId = redemptionIdFor(promo.code, agentUid);
  const redemptionRef = db.collection('promoRedemptions').doc(redemptionId);
  const auditRef = db.collection('officeCampaignAudit').doc();

  await db.runTransaction(async (tx) => {
    const chargeSnap = await tx.get(chargeRef);
    const redemptionSnap = await tx.get(redemptionRef);
    const charge = chargeSnap.exists ? chargeSnap.data() : null;
    assertChargeApplicable(charge, promo, env); // still pending, not queued into a run meanwhile
    if (charge.agentUserId !== accountUid) refuse('agent-mismatch', MESSAGES.agentMismatch);
    if (redemptionSnap.exists) refuse('already-redeemed', 'This agent has already used their free November campaign.');

    const uploadedByUid = property.createdByUid || accountUid;
    tx.create(redemptionRef, {
      ...buildRedemption({
        promo, ownerUid: agentUid, officeId, propertyId,
        uploadedByUid,
        uploadedByRole: property.createdByRole || (uploadedByUid === agentUid ? 'agent' : null),
        creationPath: 'admin-retroactive',
      }),
      retroactive: true,
      appliedByUid: adminUid,
    });
    tx.update(chargeRef, {
      status: 'excluded',
      promoCode: promo.code,
      promoRedemptionId: redemptionId,
      adjustment: {
        action: 'excluded',
        reason: `${promo.exclusionReason} Applied retroactively by an admin.`,
        adminUid,
        by: 'promotion',
        retroactive: true,
        at: FieldValue.serverTimestamp(),
      },
      ...(charge.adjustment ? { previousAdjustment: charge.adjustment } : {}),
    });
    tx.create(auditRef, {
      action: 'campaign.promoAppliedRetroactively',
      propertyId, chargeId, ownerUid: accountUid, agentUid, officeId,
      promoCode: promo.code, redemptionId,
      actorUid: adminUid, actorRole: 'superAdmin',
      at: FieldValue.serverTimestamp(),
    });
  });

  return { chargeId, promoCode: promo.code, redemptionId };
}

/**
 * Read-only hint for the Pending tab: { code, eligible: true } or { code, eligible: false, reason, message } for charges
 * billed to an eligible office; null for every other charge (no lookups made).
 */
export async function retroPromotionHint(db, charge, { code = RETRO_PROMO_CODE, env = process.env } = {}) {
  const promo = PROMOTIONS[code];
  if (!promo || charge?.billingEntityType !== 'office' || !eligibleOfficeIds(promo, env).includes(charge.officeId)) return null;
  try {
    await checkRetroPromotion(db, { chargeId: charge.id, code, charge, env });
    return { code, eligible: true };
  } catch (e) {
    if (e instanceof PromoError) return { code, eligible: false, reason: e.reason, message: e.message };
    console.warn('Promotion hint failed', charge.id, e?.message);
    return { code, eligible: false, reason: 'error', message: 'Could not check eligibility.' };
  }
}
