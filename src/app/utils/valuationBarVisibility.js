/**
 * Pure visibility rule for the persistent valuation bar — the control
 * that takes over the instant the hero's own embedded valuation bar
 * (HeroValuationBar) scrolls out of view, so a real slider is always
 * reachable without ever having to scroll back to one.
 *
 * Show it only when:
 *   - the hero's valuation bar is not itself on screen (heroInView)
 *   - the lower recap section isn't on screen either (detailInView) —
 *     never show two valuation surfaces at once
 *   - no modal is open (anyModalOpen) — covers the qualification/
 *     signup forms too, so it can never sit behind/under the keyboard
 *   - no opinion has been submitted yet this session
 *     (hasSubmittedOpinion) — once answered, stop asking
 */
export function shouldShowValuationBar({ heroInView, detailInView, anyModalOpen, hasSubmittedOpinion }) {
  if (heroInView) return false;
  if (detailInView) return false;
  if (anyModalOpen) return false;
  if (hasSubmittedOpinion) return false;
  return true;
}
