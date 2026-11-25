/**
 * Open Home pilot: what the agent may see of an open home's anonymous price opinions, for open homes started on or
 * after 25 Nov 2026 (notice version `open-home-pilot-2026-11-25`). Pure. Earlier open homes keep the rule their buyers
 * were shown (`summarizeOpinions` in ./opinionSummary.js: combined results only, from 5 opinions).
 *
 * - While the open home is running: nothing. Not a price, and not a count, so no change on the agent's screen can be
 *   matched to the buyer who just walked out.
 * - After it ends: every amount, lowest to highest (never the order or time they were given), with the count, the
 *   average and the range. Shown from a single opinion, because many open homes only see one to three groups.
 *
 * Limitation (told to the buyer before they give an opinion): with very few visitors the agent may be able to guess
 * whose opinion is whose, e.g. a lone visitor's.
 */

export const AVERAGE_ROUNDING = 1000;
export const RULE = 'after-end';

export function revealOpinions(amounts, { ended }) {
  if (!ended) return { rule: RULE, state: 'sealed' };
  const values = (Array.isArray(amounts) ? amounts : []).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const count = values.length;
  if (count === 0) return { rule: RULE, state: 'revealed', count: 0, amounts: [], average: null, low: null, high: null };
  const mean = values.reduce((sum, v) => sum + v, 0) / count;
  return {
    rule: RULE,
    state: 'revealed',
    count,
    amounts: values,
    average: Math.round(mean / AVERAGE_ROUNDING) * AVERAGE_ROUNDING,
    low: values[0],
    high: values[count - 1],
  };
}

/** The caveat shown with the results. A small number of opinions is feedback, not a valuation. */
export function sampleNote(count) {
  if (count === 1) return 'This is one buyer’s opinion. It’s useful feedback, but not a statistically reliable valuation.';
  if (count >= 2 && count <= 4) return `A small sample: ${count} buyers’ opinions. Useful feedback, but not a statistically reliable valuation.`;
  if (count >= 5) return `Feedback from ${count} buyers’ opinions. A guide to buyer perception, not a valuation.`;
  return '';
}
