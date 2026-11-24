import { readJson, writeJson, pause } from './demoStorage';
import { summarizeOpinions } from './opinionSummary';
import { PRICE_OPINION_STEP } from '../../../utils/priceOpinionStep';

/**
 * OPINION SIDE of the open home (concept demo; local to this browser, see demoStorage.js).
 *
 * Accepts a price for a session and nothing else: no name, contact, check-in reference, device id or time. Amounts
 * are kept sorted, so even the order they arrived in is gone. This module never imports the attendance store.
 * The agent only ever gets `opinionResults` (aggregates, see opinionSummary.js), never the list of amounts.
 */

const key = (sessionId) => `opinions:${sessionId}`;

/** `range`: the session's slider range; anything outside it, or off the $10,000 steps, is refused. */
export async function submitOpinion(sessionId, amount, range) {
  const value = Math.round(Number(amount));
  const valid = Number.isFinite(value) && value > 0 && value % PRICE_OPINION_STEP === 0
    && (!range || (value >= range.min && value <= range.max));
  if (!valid) return { ok: false };
  await pause();
  const amounts = readJson(key(sessionId), []);
  const next = [...amounts, value].sort((a, b) => a - b);
  writeJson(key(sessionId), next);
  return { ok: true };
}

/** The only read the agent side has: the aggregate view for the session's state. */
export function opinionResults(sessionId, { range, ended }) {
  return summarizeOpinions(readJson(key(sessionId), []), { range, ended });
}

/** Seeds amounts directly (demo history only). */
export function seedOpinions(sessionId, amounts) {
  writeJson(key(sessionId), [...amounts].sort((a, b) => a - b));
}
