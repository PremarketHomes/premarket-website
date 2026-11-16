import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { buildPromoExclusion } from './billingService';
import { PromoError, checkPromotionForAgent, buildRedemption, commitPromoCampaign, redemptionIdFor } from './promotions';
import { ManagedCampaignError, sanitizePropertyInput, loadUser } from './managedCampaignService';
import { pickNotificationUser } from '../../utils/notificationUser';

/**
 * An agent creating THEIR OWN campaign with a promo code. Without a code the existing browser flow is used unchanged
 * (the browser creates the property, then record-charge). With a code the property is created here instead, so the
 * property, its excluded billing record and the redemption land in one transaction: there is no moment where the
 * campaign exists without its exclusion (no hourly sweep can bill it) and a lost response can't lose the redemption.
 *
 * The document is the same shape the Add Property page writes for an agent's own campaign; server-controlled fields
 * (owner, terms, billing, visibility defaults) never come from the client. Idempotent on (uid, requestId): a retry or a
 * double click returns the same campaign and never creates a second campaign, redemption or charge. Photos and video
 * upload afterwards exactly as today (the owner attaches them to the property).
 */

const MAX_PENDING_PHOTOS = 60;
export const ownPromoPropertyIdFor = ({ uid, requestId }) => `p_${createHash('sha256').update(`own-promo:${uid}:${requestId}`).digest('hex').slice(0, 24)}`;
const asError = (e) => (e instanceof PromoError ? new ManagedCampaignError(e.message, e.status, e.reason) : e);

export async function createOwnPromoProperty(db, { uid, requestId, input, acceptTerms, agentId, pendingPhotos, promoCode }) {
  if (acceptTerms !== true) throw new ManagedCampaignError('The campaign terms must be accepted to continue.');
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(requestId)) throw new ManagedCampaignError('Missing request id');
  if (typeof promoCode !== 'string' || !promoCode.trim()) throw new ManagedCampaignError('Missing promo code');
  const fields = sanitizePropertyInput(input);
  const pending = Number.isInteger(pendingPhotos) && pendingPhotos > 0 ? Math.min(pendingPhotos, MAX_PENDING_PHOTOS) : 0;

  // The optional listing-agent display profile must be one of this agent's own roster entries (never trusted blindly).
  let roster = null;
  if (typeof agentId === 'string' && agentId) {
    const a = await db.collection('agents').doc(agentId).get();
    if (a.exists && a.data()?.userId === uid) roster = { id: agentId, ...a.data() };
  }

  const ref = db.collection('properties').doc(ownPromoPropertyIdFor({ uid, requestId }));
  if ((await ref.get()).exists) return { propertyId: ref.id, duplicate: true };

  let checked;
  try { checked = await checkPromotionForAgent(db, { code: promoCode, ownerUid: uid }); } catch (e) { throw asError(e); }
  const { promo, owner, officeId } = checked;

  const existing = fields.imageUrls.length;
  const data = {
    ...fields,
    createdAt: FieldValue.serverTimestamp(),
    imageUploadProgress: pending ? { uploaded: 0, total: pending, inProgress: true } : { uploaded: existing, total: existing, inProgress: false },
    offPlan: false, postcode: '', priceHistory: [], toPrice: null, showPriceRange: false,
    active: true, visibility: false, acceptingOffers: true,
    campaignId: 'FqMZd0mWlNlSBl66s7BN',
    isEager: null, clientName: null, clientEmail: null, clientPhone: null,
    wantsPremiumListing: false, agent: true, vendorUploaded: true, agentManaged: true,
    userId: uid,
    agentId: roster ? roster.id : null, agentName: roster?.name || null, agentAvatar: roster?.avatar || null,
    stats: { views: 0 },
    termsAcceptedAt: FieldValue.serverTimestamp(),
  };

  const redemptionId = redemptionIdFor(promo.code, uid);
  const exclusion = await buildPromoExclusion({
    propertyId: ref.id, propertyAddress: data.address || data.formattedAddress, agentUserId: uid,
    promoCode: promo.code, redemptionId, reason: promo.exclusionReason,
  });
  const redemption = buildRedemption({ promo, ownerUid: uid, officeId, propertyId: ref.id, uploadedByUid: uid, uploadedByRole: 'agent', creationPath: 'agent-wizard' });
  let outcome;
  try { outcome = await commitPromoCampaign(db, { promo, ownerUid: uid, propertyRef: ref, propertyData: data, exclusion, redemption }); } catch (e) { throw asError(e); }
  if (outcome === 'duplicate') return { propertyId: ref.id, duplicate: true };

  // The same side-effects the Add Property page performs after creating an agent's own campaign.
  try { await db.collection('draftProperties').doc(ref.id).set({ ...data, override: true }); } catch (e) { console.error('draftProperties write failed', ref.id, e.message); }
  try {
    const self = owner || (await loadUser(db, uid));
    await db.collection('notifications').add({ property: data, createdAt: new Date(), read: false, type: 'newProspect', user: pickNotificationUser(self, uid) });
  } catch (e) { console.error('notification write failed', ref.id, e.message); }
  try {
    await db.collection('officeCampaignAudit').add({ action: 'campaign.promoRedeemed', propertyId: ref.id, ownerUid: uid, actorUid: uid, actorRole: 'agent', officeId, promoCode: promo.code, at: FieldValue.serverTimestamp() });
  } catch (e) { console.error('audit write failed', ref.id, e.message); }

  return { propertyId: ref.id, duplicate: false, promoCode: promo.code };
}
