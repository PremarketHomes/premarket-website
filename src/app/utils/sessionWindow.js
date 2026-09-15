/**
 * Meaningful viewing-session boundary logic.
 *
 * Premarket already counts every property-page open (see
 * `stats.views`/`propertyViews` — untouched by this module). This adds a
 * second, additive concept on top: a "session" — a burst of activity from
 * one visitor on one property that represents a single meaningful look,
 * as opposed to that same visitor refreshing or briefly re-opening the
 * page moments later.
 *
 * The only signal used to decide "same session" vs "new session" is
 * elapsed wall-clock time since that visitor's last recorded activity on
 * that property. There is no reliable way to distinguish a literal
 * browser refresh from a genuine re-open of the page (both look
 * identical from the server: a new request with the same visitorId), so
 * this deliberately does not try — it only measures the gap and applies
 * one consistent rule. That is enough to satisfy the real behaviour we
 * care about: rapid refreshes/re-opens collapse into one session, while
 * a return after a genuine break (e.g. going to show a partner) counts
 * as a new one.
 *
 * SESSION_INACTIVITY_WINDOW_MS is the single place this threshold is
 * defined. Chosen deliberately short (10 minutes, not e.g. 30+) because
 * real-estate buying intent often involves returning to a listing
 * 15-20 minutes later, and that return should register as a fresh,
 * meaningful session rather than being folded into the first one.
 */
export const SESSION_INACTIVITY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Pure function: given the existing session-rollup document for a
 * visitor+property (or null if this is their first-ever recorded open)
 * and the current timestamp (as a JS Date), returns the new rollup field
 * values to write.
 *
 * `existing` shape (all fields optional/nullable on first call):
 *   { sessionCount, totalOpens, currentSessionOpens,
 *     currentSessionStartedAt: Date, lastActivityAt: Date }
 *
 * `now` must be a JS Date (callers pass a resolved server timestamp so
 * this function stays pure/synchronous and trivially testable).
 *
 * Returns:
 *   { sessionCount, totalOpens, currentSessionOpens,
 *     currentSessionStartedAt: Date, lastActivityAt: Date,
 *     isNewSession: boolean }
 */
export function computeSessionUpdate({ existing, now }) {
  if (!existing || !existing.lastActivityAt) {
    return {
      sessionCount: 1,
      totalOpens: 1,
      currentSessionOpens: 1,
      currentSessionStartedAt: now,
      lastActivityAt: now,
      isNewSession: true,
    };
  }

  const gapMs = now.getTime() - existing.lastActivityAt.getTime();
  const isNewSession = gapMs > SESSION_INACTIVITY_WINDOW_MS;

  if (isNewSession) {
    return {
      sessionCount: (existing.sessionCount || 0) + 1,
      totalOpens: (existing.totalOpens || 0) + 1,
      currentSessionOpens: 1,
      currentSessionStartedAt: now,
      lastActivityAt: now,
      isNewSession: true,
    };
  }

  return {
    sessionCount: existing.sessionCount || 1,
    totalOpens: (existing.totalOpens || 0) + 1,
    currentSessionOpens: (existing.currentSessionOpens || 0) + 1,
    currentSessionStartedAt: existing.currentSessionStartedAt || now,
    lastActivityAt: now,
    isNewSession: false,
  };
}
