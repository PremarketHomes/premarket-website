import { roundToStep } from '../priceOpinionStep';

// Shared by the Open Home concept demo and the live pilot's agent API: the single definition of what an agent may see.

/**
 * What an agent may see about an open home's anonymous price opinions. Pure.
 *
 * - While the open home is running: only a count, in steps of LIVE_COUNT_STEP ("5+", "10+"), never the exact count
 *   and never a price, so an agent watching the screen can't tie a change to the buyer who just walked out.
 * - After it ends: the combined picture (typical opinion, middle range, spread across the slider range), and only once
 *   at least MIN_OPINIONS_TO_SHOW opinions are in. With fewer, a buyer's price could be worked out, so nothing is shown.
 *   (Stricter than the campaign report's existing minimum of 3, see api/services/opinionPrivacy.js.)
 * - Never: individual amounts, the order they arrived, or when.
 */
export const MIN_OPINIONS_TO_SHOW = 5;
export const LIVE_COUNT_STEP = 5;
export const SPREAD_BANDS = 5;

export function liveCountLabel(count) {
  if (count < LIVE_COUNT_STEP) return { label: `Fewer than ${LIVE_COUNT_STEP}`, atLeast: 0 };
  const atLeast = Math.floor(count / LIVE_COUNT_STEP) * LIVE_COUNT_STEP;
  return { label: `${atLeast}+`, atLeast };
}

function quantile(sorted, q) {
  // Linear interpolation between closest ranks.
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * `amounts`: the session's opinion amounts (any order). `range`: the slider's { min, max }. `ended`: session over.
 * Returns one of:
 *   { state: 'live', live: { label, atLeast } }
 *   { state: 'too-few', minimum }
 *   { state: 'ready', count, typical, middle: [low, high], bands: [{ from, to, count }] }
 */
export function summarizeOpinions(amounts, { range, ended }) {
  const values = (amounts || []).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!ended) return { state: 'live', live: liveCountLabel(values.length) };
  if (values.length < MIN_OPINIONS_TO_SHOW) return { state: 'too-few', minimum: MIN_OPINIONS_TO_SHOW };

  const min = range?.min ?? values[0];
  const max = range?.max ?? values[values.length - 1];
  const width = (max - min) / SPREAD_BANDS || 1;
  const bands = Array.from({ length: SPREAD_BANDS }, (_, i) => ({
    from: roundToStep(min + i * width),
    to: roundToStep(min + (i + 1) * width),
    count: 0,
  }));
  for (const v of values) {
    const i = Math.min(SPREAD_BANDS - 1, Math.max(0, Math.floor((v - min) / width)));
    bands[i].count += 1;
  }
  return {
    state: 'ready',
    count: values.length,
    typical: roundToStep(quantile(values, 0.5)),
    middle: [roundToStep(quantile(values, 0.25)), roundToStep(quantile(values, 0.75))],
    bands,
  };
}
