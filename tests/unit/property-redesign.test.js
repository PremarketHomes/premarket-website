import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { computeListingEyebrow } from '../../src/app/utils/brandStyle';

// This project has no @testing-library/react / jsdom, so — matching the
// pattern already established for brand-style.js — these tests cover the
// one genuinely pure piece of new logic directly, and use source
// inspection to guard the architectural rules the redesign brief called
// out explicitly: never hard-code Harcourts (or any other agency) into
// the reusable components, and always route the accent colour through
// the existing var(--brand-primary, ...) mechanism so agency branding
// keeps flowing through unchanged.

describe('computeListingEyebrow', () => {
  it('labels an on-market property correctly', () => {
    expect(computeListingEyebrow('on-market')).toBe('On-Market Opportunity');
  });

  it('defaults to off-market for any other value, including missing data', () => {
    expect(computeListingEyebrow('pre-market')).toBe('Off-Market Opportunity');
    expect(computeListingEyebrow(undefined)).toBe('Off-Market Opportunity');
    expect(computeListingEyebrow(null)).toBe('Off-Market Opportunity');
  });
});

const PROPERTY_PAGE_COMPONENTS = [
  'PropertyHeader.js',
  'PropertyHero.js',
  'PriceOpinionCard.js',
  'PropertyInfoCard.js',
  'PropertyGallery.js',
  'AgentSignOff.js',
  'PremarketBadge.js',
];

function readComponent(name) {
  return fs.readFileSync(
    new URL(`../../src/app/components/property-page/${name}`, import.meta.url),
    'utf-8'
  );
}

describe('redesigned property-page components never hard-code a specific agency', () => {
  it.each(PROPERTY_PAGE_COMPONENTS)('%s contains no hard-coded Harcourts branding', (name) => {
    const source = readComponent(name);
    expect(source.toLowerCase()).not.toContain('harcourts');
    // The known Harcourts brand hex values must never appear as a bare
    // literal — only ever as data flowing through props/CSS vars.
    expect(source).not.toContain('#011d47');
    expect(source).not.toContain('#01a8ec');
  });
});

describe('redesigned components route their accent colour through CSS vars, not bare hex', () => {
  it('PriceOpinionCard\'s price figure and primary button use var(--brand-primary, ...) with a fallback, never a bare colour', () => {
    const source = readComponent('PriceOpinionCard.js');
    expect(source).toContain('var(--brand-primary,#c2410c)');
    // The button/price colour must be driven by the CSS var, not a raw
    // Tailwind colour utility like bg-orange-600 (that would ignore
    // agency branding entirely).
    expect(source).not.toMatch(/bg-orange-\d{3}/);
  });

  it('PremarketBadge always renders the Premarket wordmark and mark, regardless of agency branding', () => {
    const source = readComponent('PremarketBadge.js');
    expect(source).toContain('Premarket');
    expect(source).toContain('BrandMark');
  });
});

describe('PropertyInfoCard never fabricates property data', () => {
  it('only renders stats it was actually given as props — no hard-coded amenity tags', () => {
    const source = readComponent('PropertyInfoCard.js');
    // These are exactly the kind of plausible-but-fabricated tags a naive
    // reproduction of the design reference might hard-code (e.g. "Pool",
    // "Water views") — they must never appear as literal strings here;
    // every stat must come from the props this component receives.
    expect(source).not.toMatch(/>\s*Pool\s*</);
    expect(source).not.toMatch(/>\s*Water views\s*</);
    expect(source).not.toMatch(/>\s*Multiple living areas\s*</);
  });
});
