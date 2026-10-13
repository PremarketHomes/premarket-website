// Single source of truth for the price-opinion slider increment.
// Only affects new slider interactions — never touches previously stored offers.
export const PRICE_OPINION_STEP = 10000;

// Rounds a display-only value (min/max range bounds, midpoints, restored
// previous-offer values) to the nearest slider step. Never used on stored
// Firestore data — only on values computed fresh for the current session.
export function roundToStep(value, step = PRICE_OPINION_STEP) {
  return Math.round(value / step) * step;
}
