/**
 * Pure visibility rule for the one persistent valuation slider, fixed
 * to the bottom of the viewport from the moment the property loads.
 * It never hides for scroll position or section visibility — only for
 * the two cases where showing it would actively get in the way:
 *
 *   - anyModalOpen — covers the confirm/qualification/signup modals,
 *     the lightbox and the video modal, so it can never sit behind an
 *     overlay or under the keyboard.
 *   - hasSubmittedOpinion — once a buyer has answered this session,
 *     stop asking.
 */
export function shouldShowPersistentSlider({ anyModalOpen, hasSubmittedOpinion }) {
  if (anyModalOpen) return false;
  if (hasSubmittedOpinion) return false;
  return true;
}
