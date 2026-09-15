/**
 * Existing-agent mobile-number confirmation prompt.
 *
 * Because the agent's mobile number is now shown publicly on their
 * Premarket property campaigns (see AgentSignOff.js), existing agents
 * should confirm the number on file is current. This uses one new,
 * clearly-named field on the existing `users/{uid}` document —
 * `mobileConfirmedAt` (a timestamp, set the moment an agent either
 * confirms their current number or saves a new one) — no migration, no
 * new collection, no auth changes. An account without this field simply
 * hasn't confirmed yet, which is exactly the "old accounts get prompted,
 * new ones don't need to be" behaviour required: agents who sign up
 * through /join already have this field set at account-creation time
 * (their phone number is captured and validated during onboarding, so
 * there's nothing to re-confirm).
 *
 * Existing users/{uid}.update Firestore rules already allow an agent to
 * write any field on their own document except `agencyBrandId` — so no
 * rules change is needed for this feature either.
 */
export function shouldShowMobilePrompt(userData) {
  if (!userData) return false;
  const isAgent = !!(userData.isAgent || userData.agent);
  if (!isAgent) return false;
  return !userData.mobileConfirmedAt;
}
