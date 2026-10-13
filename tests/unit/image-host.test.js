import { describe, it, expect } from 'vitest';
import { isOptimizableImageUrl } from '../../src/app/utils/imageHost';

describe('isOptimizableImageUrl', () => {
  it('allows the known, already-whitelisted hosts (must match next.config.mjs exactly)', () => {
    expect(isOptimizableImageUrl('https://firebasestorage.googleapis.com/v0/b/x/o/y')).toBe(true);
    expect(isOptimizableImageUrl('https://premarketvideos.b-cdn.net/images/foo.jpg')).toBe(true);
    expect(isOptimizableImageUrl('https://premarket.homes/some-image.jpg')).toBe(true);
    expect(isOptimizableImageUrl('https://www.airtasker.com/image.jpg')).toBe(true);
  });

  it('rejects a REX/Agentbox-style external image host not yet rehosted by the compression cron', () => {
    expect(isOptimizableImageUrl('https://images.rexsoftware.com/some/photo.jpg')).toBe(false);
    expect(isOptimizableImageUrl('https://cdn.agentboxcrm.com.au/photo.jpg')).toBe(false);
  });

  it('rejects malformed or missing input without throwing', () => {
    expect(isOptimizableImageUrl('')).toBe(false);
    expect(isOptimizableImageUrl(null)).toBe(false);
    expect(isOptimizableImageUrl(undefined)).toBe(false);
    expect(isOptimizableImageUrl('not a url')).toBe(false);
  });
});
