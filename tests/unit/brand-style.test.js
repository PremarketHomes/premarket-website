import { describe, it, expect } from 'vitest';
import { computeBrandStyle, computeDisplayLogoUrl, computeEffectiveColors } from '../../src/app/utils/brandStyle';

// These tests exist specifically to guarantee: an agent with no agency
// branding AND no personal override gets exactly today's Premarket
// appearance, with zero visual change. PropertyPageClient.js and
// PriceOpinionSlider.js only ever reference brand colours via
// var(--brand-x, <existing-default-hex>) — so as long as
// computeBrandStyle returns `undefined` for "nothing to apply", no
// inline style is applied at all and every one of those CSS variables
// resolves to its fallback, unchanged.

describe('computeBrandStyle — no-branding default guarantee', () => {
  it('returns undefined (no inline style at all) when there are no colours', () => {
    expect(computeBrandStyle(null)).toBeUndefined();
    expect(computeBrandStyle(undefined)).toBeUndefined();
  });

  it('returns undefined for a malformed/incomplete colours object', () => {
    expect(computeBrandStyle({})).toBeUndefined();
    expect(computeBrandStyle({ primaryDark: '#000' })).toBeUndefined();
  });

  it('returns the correct CSS custom properties for a real colour set', () => {
    const style = computeBrandStyle({ primary: '#011d47', primaryDark: '#010f2c', secondary: '#01a8ec', primaryText: '#ffffff' });
    expect(style).toEqual({
      '--brand-primary': '#011d47',
      '--brand-primary-dark': '#010f2c',
      '--brand-text-on-primary': '#ffffff',
      '--brand-secondary': '#01a8ec',
    });
  });

  it('omits --brand-secondary when there is no secondary colour', () => {
    const style = computeBrandStyle({ primary: '#011d47', primaryDark: '#010f2c', primaryText: '#ffffff' });
    expect(style).not.toHaveProperty('--brand-secondary');
  });
});

describe('computeEffectiveColors — personal override wins over the shared agency default', () => {
  it('falls back to the shared brand\'s colours when the agent has no personal override', () => {
    expect(computeEffectiveColors({
      brand: { colors: { primary: '#011d47' } },
      agentData: {},
    })).toEqual({ primary: '#011d47' });
  });

  it('SECURITY/CORE RULE: the agent\'s own personal colour override always wins over the shared brand', () => {
    expect(computeEffectiveColors({
      brand: { colors: { primary: '#011d47' } },
      agentData: { brandColors: { primary: '#ff0000' } },
    })).toEqual({ primary: '#ff0000' });
  });

  it('a personal override works even with no shared brand at all (independent agent)', () => {
    expect(computeEffectiveColors({
      brand: null,
      agentData: { brandColors: { primary: '#ff0000' } },
    })).toEqual({ primary: '#ff0000' });
  });

  it('returns null when neither exists', () => {
    expect(computeEffectiveColors({ brand: null, agentData: null })).toBeNull();
    expect(computeEffectiveColors({ brand: null, agentData: {} })).toBeNull();
  });

  it('previewBrand (dashboard-only) takes absolute precedence over both, for the live "about to save" preview', () => {
    expect(computeEffectiveColors({
      brand: { colors: { primary: '#011d47' } },
      agentData: { brandColors: { primary: '#ff0000' } },
      previewBrand: { colors: { primary: '#00ff00' } },
    })).toEqual({ primary: '#00ff00' });
  });
});

describe('computeDisplayLogoUrl — personal override wins over the shared agency default', () => {
  it('falls back to the agent\'s personal logoUrl when there is no shared brand (independent agent)', () => {
    expect(computeDisplayLogoUrl({ brand: null, agentData: { logoUrl: 'https://example.com/me.png' } }))
      .toBe('https://example.com/me.png');
  });

  it('CORE RULE: the agent\'s own personal logo always wins over the shared brand\'s logo', () => {
    expect(computeDisplayLogoUrl({
      brand: { logoUrl: 'https://example.com/harcourts.png' },
      agentData: { logoUrl: 'https://example.com/me.png' },
    })).toBe('https://example.com/me.png');
  });

  it('falls back to the shared brand\'s logo when the agent has no personal override', () => {
    expect(computeDisplayLogoUrl({
      brand: { logoUrl: 'https://example.com/harcourts.png' },
      agentData: {},
    })).toBe('https://example.com/harcourts.png');
  });

  it('returns null when neither exists, never undefined/empty-string surprises', () => {
    expect(computeDisplayLogoUrl({ brand: null, agentData: null })).toBeNull();
    expect(computeDisplayLogoUrl({ brand: null, agentData: {} })).toBeNull();
  });

  it('previewBrand (dashboard-only) takes absolute precedence over both', () => {
    expect(computeDisplayLogoUrl({
      brand: { logoUrl: 'https://example.com/harcourts.png' },
      agentData: { logoUrl: 'https://example.com/me.png' },
      previewBrand: { logoUrl: 'https://example.com/proposed.png' },
    })).toBe('https://example.com/proposed.png');
  });
});

describe('PropertyPageClient.js / PriceOpinionSlider.js — default fallback values match today\'s live theme', () => {
  // A lightweight, dependency-free guard against the refactor ever
  // drifting: every var(--brand-x, ...) fallback must be the exact
  // hex values Premarket has always used, and the old bare literals
  // must not remain anywhere outside of those fallbacks.
  it('PropertyPageClient.js only references the old orange gradient via var() with the original hex as fallback, and only in the untouched iPad kiosk mode', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    expect(source).not.toContain('from-[#e48900] to-[#c64500]');
    // The premium redesign (default, non-iPad branch) intentionally moved
    // off this old two-tone orange gradient to a single, more restrained
    // accent colour (see the redesigned-page assertion below). The iPad
    // open-home kiosk used to own five more references; it is now its own
    // component (components/kiosk/OpenHomeKiosk.js, covered below), so only
    // the confirmOpinionModal variable (1) still uses it here.
    const matches = source.match(/from-\[var\(--brand-primary,#e48900\)\] to-\[var\(--brand-primary-dark,#c64500\)\]/g) || [];
    expect(matches.length).toBe(1);
  });

  it('the iPad kiosk components inherit office/agent branding via var() and keep the original Premarket hex as the fallback', async () => {
    const fs = await import('node:fs');
    for (const file of ['OpenHomeKiosk.js', 'KioskSlider.js']) {
      const source = fs.readFileSync(new URL(`../../src/app/components/kiosk/${file}`, import.meta.url), 'utf-8');
      // never a bare brand literal: every use goes through the branding variables
      expect(source).not.toMatch(/from-\[#e48900\] to-\[#c64500\]/);
      for (const m of source.matchAll(/var\(--brand-primary(?:-dark)?,\s*(#[0-9a-fA-F]{3,8})\)/g)) {
        expect(['#e48900', '#c64500', '#c2410c', '#334155', '#0f172a']).toContain(m[1]);
      }
    }
    const kiosk = fs.readFileSync(new URL('../../src/app/components/kiosk/OpenHomeKiosk.js', import.meta.url), 'utf-8');
    expect(kiosk).toContain('var(--brand-primary');
    expect(kiosk).toContain('brandStyle');
  });

  it('the redesigned (non-iPad) property page uses a single restrained brand-primary accent, with the original orange as its own distinct default fallback', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    // Every redesigned accent (price figure, primary buttons) must flow
    // through var(--brand-primary, ...) — never a bare hardcoded colour —
    // so agency branding (e.g. Harcourts navy) still overrides it exactly
    // like the rest of the app.
    expect(source).toContain('var(--brand-primary,#c2410c)');
    expect(source).not.toMatch(/bg-\[#c2410c\]/);
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
