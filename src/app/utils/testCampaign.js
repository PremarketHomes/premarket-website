/**
 * Test campaigns: a narrow billing exemption for Premarket's own end-to-end testing.
 *
 * A campaign is a test campaign ONLY when all of these hold:
 *   - it carries `testCampaign: true` (ticked on the final upload step, before submission);
 *   - its owner (the account it would be billed to) is one of TEST_CAMPAIGN_ACCOUNT_UIDS. Firestore rules only let
 *     the signed-in account create a property owned by its own uid, so the owner uid is verified by Firebase Auth;
 *   - it was created by that same account for itself: never a managed campaign (BSO / office admin creating for a
 *     selling agent), never one uploaded by someone else, and never one uploaded for a roster selling agent (`agentId`).
 *
 * Billing (billingService) records no charge for a test campaign; every other campaign is billed exactly as before.
 * Leadership and Team Dashboards leave test campaigns out of their figures; Office > Campaigns and the owner's
 * dashboard label them "Test".
 *
 * Changing this list is a code change on purpose (reviewed, in git history). Keep it to named Premarket test accounts.
 */
export const TEST_CAMPAIGN_ACCOUNT_UIDS = Object.freeze([]);

export const TEST_CAMPAIGN_EXEMPTION_REASON =
  'Test campaign created by an authorised Premarket test account for its own testing; no charge recorded.';

// `allow` exists only so unit tests can exercise the rule; callers always use the default list.

/** May this signed-in uid tick "Test campaign" on its own upload? (UI only; billing re-checks the stored campaign.) */
export function canCreateTestCampaign(uid, allow = TEST_CAMPAIGN_ACCOUNT_UIDS) {
  return typeof uid === 'string' && uid.length > 0 && allow.includes(uid);
}

/** The single rule billing, reporting and labels share. `p` is a property document's data. */
export function isTestCampaign(p, allow = TEST_CAMPAIGN_ACCOUNT_UIDS) {
  if (!p || p.testCampaign !== true) return false;
  const ownerUid = p.userId || p.uid; // the same account billing would charge
  if (!canCreateTestCampaign(ownerUid, allow)) return false;
  if (p.managedCreation === true) return false;
  if (p.createdByUid && p.createdByUid !== ownerUid) return false;
  if (p.agentId) return false; // uploaded under this account for another (roster) selling agent: billed as normal
  return true;
}
