// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // Staging/test deployments set NEXT_PUBLIC_SENTRY_DISABLED=1 so nothing is sent to the production Sentry project.
  enabled: process.env.NEXT_PUBLIC_SENTRY_DISABLED !== '1',
  dsn: process.env.NEXT_PUBLIC_SENTRY_DISABLED === '1' ? undefined : "https://836bdb08380a219800aa9dbe3c829880@o4510456194072576.ingest.us.sentry.io/4511122303025152",

  // Session replay is added once the page has loaded and gone idle (see below), so its recorder is not part of the
  // first download on every page. The replay sample rates below still apply when it is added.
  integrations: [],

  // Performance tracing for 10% of sessions (was 100%), enough for trends at a fraction of the overhead.
  // Errors are always reported, whatever this rate.
  tracesSampleRate: 0.1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

// Sentry's documented lazy-loading pattern for Replay, loaded from this app's own bundle (no extra third-party domain).
// Errors that happen before it loads are still reported; they just come without a replay.
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SENTRY_DISABLED !== '1') {
  const startReplay = () => { import('./sentryReplay').then((m) => m.startSentryReplay()).catch(() => {}); };
  const whenIdle = () => (window.requestIdleCallback ? window.requestIdleCallback(startReplay, { timeout: 5000 }) : setTimeout(startReplay, 2000));
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
