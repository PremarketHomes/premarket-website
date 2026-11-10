// Loaded on demand by instrumentation-client.js after the page is idle, so Sentry Replay's recorder is a separate,
// later download instead of part of every page's first load.
import { addIntegration, replayIntegration } from '@sentry/nextjs';

export function startSentryReplay() {
  addIntegration(replayIntegration());
}
