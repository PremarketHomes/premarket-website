import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // NEXT_PUBLIC_SENTRY_DISABLED=1 (staging/test deployments) turns Sentry off entirely.
  enabled: process.env.NEXT_PUBLIC_SENTRY_DISABLED !== '1',
  dsn: process.env.NEXT_PUBLIC_SENTRY_DISABLED === '1' ? undefined : process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  sendDefaultPii: true,
});
