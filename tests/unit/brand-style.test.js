import { describe, it, expect } from 'vitest';
import { computeBrandStyle, computeDisplayLogoUrl } from '../../src/app/utils/brandStyle';

// These tests exist specifically to guarantee: an agent with no agency
// branding gets exactly today's Premarket appearance, with zero visual
// change. PropertyPageClient.js and PriceOpinionSlider.js only ever
// reference brand colours via var(--brand-x, <existing-default-hex>) —
// so as long as computeBrandStyle returns `undefined` for "no brand",
// no inline style is applied at all and every one of those CSS
// variables resolves to its fallback, unchanged.

describe('computeBrandStyle — no-branding default guarantee', () => {
  it('returns undefined (no inline style at all) when there is no brand', () => {
    expect(computeBrandStyle(null)).toBeUndefined();
    expect(computeBrandStyle(undefined)).toBeUndefined();
  });

  it('returns undefined for a malformed/incomplete brand (missing colors)', () => {
    expect(computeBrandStyle({ name: 'Harcourts' })).toBeUndefined();
    expect(computeBrandStyle({ colors: {} })).toBeUndefined();
  });

  it('returns the correct CSS custom properties for a real brand', () => {
    const style = computeBrandStyle({
      colors: { primary: '#011d47', primaryDark: '#010f2c', secondary: '#01a8ec', primaryText: '#ffffff' },
    });
    expect(style).toEqual({
      '--brand-primary': '#011d47',
      '--brand-primary-dark': '#010f2c',
      '--brand-text-on-primary': '#ffffff',
      '--brand-secondary': '#01a8ec',
    });
  });

  it('omits --brand-secondary when the brand has no secondary colour', () => {
    const style = computeBrandStyle({
      colors: { primary: '#011d47', primaryDark: '#010f2c', primaryText: '#ffffff' },
    });
    expect(style).not.toHaveProperty('--brand-secondary');
  });
});

describe('computeDisplayLogoUrl', () => {
  it('falls back to the agent\'s personal logoUrl when there is no brand (existing behaviour)', () => {
    expect(computeDisplayLogoUrl({ brand: null, agentData: { logoUrl: 'https://example.com/me.png' } }))
      .toBe('https://example.com/me.png');
  });

  it('prefers the agency brand logo over the agent\'s personal logo when both exist', () => {
    expect(computeDisplayLogoUrl({
      brand: { logoUrl: 'https://example.com/harcourts.png' },
      agentData: { logoUrl: 'https://example.com/me.png' },
    })).toBe('https://example.com/harcourts.png');
  });

  it('returns null when neither exists, never undefined/empty-string surprises', () => {
    expect(computeDisplayLogoUrl({ brand: null, agentData: null })).toBeNull();
    expect(computeDisplayLogoUrl({ brand: null, agentData: {} })).toBeNull();
  });
});

describe('PropertyPageClient.js / PriceOpinionSlider.js — default fallback values match today\'s live theme', () => {
  // A lightweight, dependency-free guard against the refactor ever
  // drifting: every var(--brand-x, ...) fallback must be the exact
  // hex values Premarket has always used, and the old bare literals
  // must not remain anywhere outside of those fallbacks.
  it('PropertyPageClient.js only references the brand gradient via var() with the original hex as fallback', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    expect(source).not.toContain('from-[#e48900] to-[#c64500]');
    const matches = source.match(/from-\[var\(--brand-primary,#e48900\)\] to-\[var\(--brand-primary-dark,#c64500\)\]/g) || [];
    expect(matches.length).toBe(15);
  });

  it('PriceOpinionSlider.js only references the thumb colour via var() with the original hex as fallback', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../src/app/components/PriceOpinionSlider.js', import.meta.url),
      'utf-8'
    );
    // The old bare (non-fallback) literals must be gone...
    expect(source).not.toContain('solid #ea580c');
    expect(source).not.toContain('to right, #e48900, #c64500');
    // ...replaced by the var()-with-fallback form, using the exact same hex.
    expect(source).toContain('var(--brand-primary, #ea580c)');
    expect(source).toContain('var(--brand-primary, #e48900), var(--brand-primary-dark, #c64500)');
  });
});
