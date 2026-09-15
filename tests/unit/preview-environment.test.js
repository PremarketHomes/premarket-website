import { describe, it, expect, vi, afterEach } from 'vitest';
import { isPreviewDeployment } from '../../src/app/utils/previewEnvironment';

function setHostname(hostname) {
  vi.stubGlobal('window', { location: { hostname } });
}

describe('isPreviewDeployment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true on a Vercel preview URL', () => {
    setHostname('premarket-website-git-feature-branch-premarkethomes.vercel.app');
    expect(isPreviewDeployment()).toBe(true);
  });

  it('is false on real production', () => {
    setHostname('premarket.homes');
    expect(isPreviewDeployment()).toBe(false);
  });

  it('is false on a custom domain that merely contains "vercel" in a subdomain segment', () => {
    setHostname('vercel.premarket.homes');
    expect(isPreviewDeployment()).toBe(false);
  });

  it('is false when window is unavailable (server-side)', () => {
    vi.stubGlobal('window', undefined);
    expect(isPreviewDeployment()).toBe(false);
  });
});
