import { FieldValue } from 'firebase-admin/firestore';
import { PROMOTIONS, PromoError, checkPromotionForAgent, eligibleOfficeIds, redemptionIdFor, buildRedemption } from './promotions';

/**
 * Retroactively applying a promotion (HPHNOVEMBER) to a campaign whose agent forgot the code.
 *
 * Admin-only (the route calls verifyAdmin). Allowed only when ALL hold:
 *  - the charge is still PENDING: never in a draft run (remove it from the run first), never sent to Xero
 *    (invoiced/reversed), not already excluded, not a test campaign, not already a promotion;
 *  - it is billed to an eligible office (HPH) and its owner is a usable HPH agent in an active office;
 *  - the listing's assigned selling agent IS that owner (a roster-assigned listing for someone else is refused);
 *  - the campaign was CREATED before the promotion's cutoff (30 Nov 2026 00:00 Queensland time);
 *  - that agent has no redemption yet (the same deterministic promoRedemptions/{CODE}_{uid} lock as at creation).
 *
 * Applying is ONE transaction: re-checks the charge and the redemption, creates the redemption, moves the SAME charge
 * to 'excluded' with promoCode/promoRedemptionId (amounts untouched, so it shows "$200 waived"), and writes an audit
 * record of who applied it and when. Nothing is deleted; no second redemption can ever be created.
 */

export const RETRO_PROMO_CODE = 'HPHNOVEMBER';

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
  afterCutoff: (promo) => `This campaign was created after the ${promo.code} cutoff (${promo.endsLabel}).`,
  agentMismatch: 'The charge’s agent doesn’t match the campaign owner. Check it manually.',
  assignedElsewhere: 'This campaign is assigned to a different agent from the account it was uploaded under. Check it manually.',
});

const refuse = (reason, message, status = 409) => { throw new PromoError(reason, message, status); };
const toMs = (t) => {
  const d = t?.toDate ? t.toDate() : t instanceof Date ? t : typeof t === 'string' || typeof t === 'number' ? new Date(t) : null;
  const ms = d ? d.getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};
const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`;

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
 * Read-only eligibility check (reserves and writes nothing). Returns { promo, ownerUid, officeId, property }
 * or throws PromoError with a client-safe message.
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
  if (createdAtMs >= promo.endsAtMs) refuse('after-cutoff', MESSAGES.afterCutoff(promo));

  const ownerUid = property.userId;
  if (!ownerUid || ownerUid !== charge.agentUserId) refuse('agent-mismatch', MESSAGES.agentMismatch);

  // Same rules as redeeming at creation, judged at the campaign's creation time: usable HPH agent, active office, no
  // redemption yet.
  const { owner, officeId } = await checkPromotionForAgent(db, { code, ownerUid, now: createdAtMs, env });

  // The redemption belongs to the assigned selling agent. A roster-assigned listing counts only when that agent is the
  // owner themself (their own display profile); otherwise it would use the wrong person's free campaign.
  if (property.agentId && norm(property.agentName) !== norm(fullName(owner))) refuse('assigned-elsewhere', MESSAGES.assignedElsewhere);

  return { promo, ownerUid, officeId, propertyId, property };
}

/** Applies the promotion atomically (see file comment). Returns { chargeId, promoCode, redemptionId }. */
export async function applyRetroPromotion(db, { chargeId, code = RETRO_PROMO_CODE, adminUid, env = process.env }) {
  if (!adminUid) refuse('unauthorised', 'Admin required.', 403);
  const { promo, ownerUid, officeId, propertyId, property } = await checkRetroPromotion(db, { chargeId, code, env });

  const chargeRef = db.collection('propertyCharges').doc(chargeId);
  const redemptionId = redemptionIdFor(promo.code, ownerUid);
  const redemptionRef = db.collection('promoRedemptions').doc(redemptionId);
  const auditRef = db.collection('officeCampaignAudit').doc();

  await db.runTransaction(async (tx) => {
    const chargeSnap = await tx.get(chargeRef);
    const redemptionSnap = await tx.get(redemptionRef);
    const charge = chargeSnap.exists ? chargeSnap.data() : null;
    assertChargeApplicable(charge, promo, env); // still pending, not queued into a run meanwhile
    if (charge.agentUserId !== ownerUid) refuse('agent-mismatch', MESSAGES.agentMismatch);
    if (redemptionSnap.exists) refuse('already-redeemed', 'This agent has already used their free November campaign.');

    const createdByUid = property.createdByUid || ownerUid;
    tx.create(redemptionRef, {
      ...buildRedemption({
        promo, ownerUid, officeId, propertyId,
        uploadedByUid: createdByUid,
        uploadedByRole: property.createdByRole || (createdByUid === ownerUid ? 'agent' : null),
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
      propertyId, chargeId, ownerUid, officeId,
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
