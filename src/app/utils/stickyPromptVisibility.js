/**
 * Pure visibility rule for the sticky price prompt ("Have a go — what's
 * it worth?"). Extracted so the decision logic is testable without a
 * DOM/IntersectionObserver — the component itself just wires these
 * booleans up to two observers and the existing modal-open flags.
 *
 * Show the prompt only when all of the following hold:
 *   - the hero has been scrolled past (pastHero)
 *   - the real price-opinion card is not itself on screen (so the
 *     reminder and the real interaction are never visible at once)
 *   - no modal is currently open (so it never overlaps a modal)
 *   - no opinion has been submitted yet this session (hasSubmittedOpinion)
 *     — covers both a fresh submit and a prior opinion already restored
 *     for a returning visitor; once answered, stop asking.
 */
export function shouldShowStickyPrompt({ pastHero, priceCardInView, anyModalOpen, hasSubmittedOpinion }) {
  if (!pastHero) return false;
  if (priceCardInView) return false;
  if (anyModalOpen) return false;
  if (hasSubmittedOpinion) return false;
  return true;
}
