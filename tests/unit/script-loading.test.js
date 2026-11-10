import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(p, 'utf8');

describe('Sentry: errors always reported, lighter tracing, replay loaded after the page is idle', () => {
  const s = read('src/instrumentation-client.js');
  it('keeps error reporting and replay sampling, traces 10% of sessions', () => {
    expect(s).toContain('Sentry.init({');
    expect(s).toContain('tracesSampleRate: 0.1,');
    expect(s).toContain('replaysSessionSampleRate: 0.1,');
    expect(s).toContain('replaysOnErrorSampleRate: 1.0,');
    expect(s).toContain('integrations: [],');
    expect(s).toContain('export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;');
  });
  it('adds Replay from the app bundle once the page has loaded and is idle', () => {
    expect(s).toContain("import('./sentryReplay').then((m) => m.startSentryReplay())");
    expect(s).toContain("window.addEventListener('load', whenIdle, { once: true });");
    expect(read('src/sentryReplay.js')).toContain('addIntegration(replayIntegration());');
  });
});

describe('Google Tag Manager deferred without losing events', () => {
  const layout = read('src/app/layout.js');
  it('creates the dataLayer queue before the page runs and loads GTM lazily', () => {
    expect(layout).toContain("<script id=\"datalayer-init\" dangerouslySetInnerHTML={{ __html: 'window.dataLayer = window.dataLayer || [];' }} />");
    expect(layout).toContain('<Script id="google-tag-manager" strategy="lazyOnload">');
    expect(layout).toContain("'GTM-PS65V87'");
  });
});

describe('server and edge Sentry: errors always reported, 10% tracing', () => {
  it('lowers server/edge trace sampling only', () => {
    for (const p of ['sentry.server.config.js', 'sentry.edge.config.js']) {
      const s = read(p);
      expect(s).toContain('tracesSampleRate: 0.1,');
      expect(s).toContain("enabled: process.env.NEXT_PUBLIC_SENTRY_DISABLED !== '1',");
    }
  });
});
