/**
 * Test campaigns: a narrow billing exemption so a named Premarket test account can run the real BSO upload
 * workflow (choosing a real selling agent) without creating a charge.
 *
 * How it is decided (server-only, once, at creation):
 *   - the CREATOR is the signed-in account (verified ID token) and is on TEST_CAMPAIGN_CREATOR_UIDS;
 *   - the creator explicitly ticked "Test campaign" before submitting (the create request says testCampaign: true).
 * The selling agent (owner) plays no part in the decision.
 *
 * Where it is recorded: in the SAME atomic write that creates the campaign, its billing record
 * `propertyCharges/{propertyId}` is created with status 'excluded' and `testCampaign: true` (see
 * billingService.buildTestCampaignExclusion). propertyCharges is server-only (clients cannot write it), and every
 * charge path (record-charge, the hourly reconcile sweep, the pre-invoice sweep, office join/leave settlement, ad-hoc
 * agency invoices) skips a property that already has a billing record, so nothing can later add a charge: not a
 * retry, not a reassignment of the selling agent or manager, not an edit to the campaign's own fields. Invoice runs
 * only ever pick up 'pending' charges.
 *
 * That record is also the source of truth for reporting (Leadership, Team Dashboards) and labels (Office > Campaigns,
 * My Campaigns), and it stops campaign emails to the selling agent. `testCampaign` on the property itself is a
 * display hint only.
 *
 * Changing this list is a code change on purpose (reviewed, in git history). One named Premarket account only.
 */
export const TEST_CAMPAIGN_CREATOR_UIDS = Object.freeze([]);

export const TEST_CAMPAIGN_EXEMPTION_REASON =
  'Test campaign: created by an authorised Premarket test account and marked Test before submission. Not billable.';

/** `allow` exists only so unit tests can exercise the rule; callers always use the default list. */
export function canCreateTestCampaign(uid, allow = TEST_CAMPAIGN_CREATOR_UIDS) {
  return typeof uid === 'string' && uid.length > 0 && allow.includes(uid);
}

/** Is this property an approved test campaign? Reads only the server-only billing record. */
export async function isTestCampaignId(db, propertyId) {
  if (!propertyId) return false;
  const snap = await db.collection('propertyCharges').doc(propertyId).get();
  return snap.exists && snap.data()?.testCampaign === true;
}

/** Ids of every approved test campaign (one query; there are only ever a handful). */
export async function loadTestCampaignIds(db) {
  const snap = await db.collection('propertyCharges').where('testCampaign', '==', true).get();
  return new Set(snap.docs.map((d) => d.id));
}
