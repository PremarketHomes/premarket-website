import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { getMarketStatusCopy, isOnMarket } from '../../src/app/utils/marketStatusCopy';

// This project has no @testing-library/react / jsdom, so — matching the
// pattern already established for brand-style.js — these tests cover the
// genuinely pure pieces of logic directly, and use source inspection to
// guard the architectural rules the redesign brief called out explicitly:
// never hard-code Harcourts (or any other agency) into the reusable
// components, and always route the accent colour through the existing
// var(--brand-primary, ...) mechanism so agency branding keeps flowing
// through unchanged.

const FORBIDDEN_ON_ON_MARKET_COPY = [
  'before it hits the market',
  'before launching',
  'before it launches',
  'off-market opportunity',
  'pre-market opportunity',
  'secure it pre-market',
  'secure a pre-market deal',
  'hits the market',
];

describe('isOnMarket', () => {
  it('is true only for the exact existing listingStatus value "on-market"', () => {
    expect(isOnMarket('on-market')).toBe(true);
  });

  it('is false for the pre-market default and any other/missing value', () => {
    expect(isOnMarket('premarket')).toBe(false);
    expect(isOnMarket(undefined)).toBe(false);
    expect(isOnMarket(null)).toBe(false);
    expect(isOnMarket('')).toBe(false);
  });
});

describe('getMarketStatusCopy — pre-market (off-market) properties', () => {
  const copy = getMarketStatusCopy('premarket');

  it('keeps the required price-opinion heading', () => {
    expect(copy.priceOpinionHeading).toBe('What do you think this property is worth?');
  });

  it('communicates the pre-launch opportunity in the price-opinion subcopy', () => {
    expect(copy.priceOpinionSubcopy.toLowerCase()).toContain('before it launches');
  });

  it('communicates the pre-market registration opportunity', () => {
    expect(copy.interestHeading).toBe('Interested in securing it before it hits the market?');
    expect(copy.interestSubcopy).toBe(
      'Register your interest directly with the agent and explore the opportunity to secure a pre-market deal.'
    );
  });

  it('flags itself as not on-market', () => {
    expect(copy.isOnMarket).toBe(false);
  });
});

describe('getMarketStatusCopy — on-market properties', () => {
  const copy = getMarketStatusCopy('on-market');

  it('keeps the same required price-opinion heading as pre-market', () => {
    expect(copy.priceOpinionHeading).toBe('What do you think this property is worth?');
  });

  it('uses price-education / buyer-sentiment framing, not a launch-timing pitch', () => {
    expect(copy.priceOpinionSubcopy.toLowerCase()).toContain('where buyers see value');
  });

  it('uses simple, neutral registration copy', () => {
    expect(copy.interestHeading).toBe('Interested in this property?');
    expect(copy.interestSubcopy).toBe('Register your interest directly with the agent.');
  });

  it('flags itself as on-market', () => {
    expect(copy.isOnMarket).toBe(true);
  });

  it('never uses pre-market-only phrasing anywhere in its own copy', () => {
    const allText = Object.values(copy).join(' ').toLowerCase();
    for (const phrase of FORBIDDEN_ON_ON_MARKET_COPY) {
      expect(allText).not.toContain(phrase);
    }
  });
});

describe('the public property page never contradicts an on-market property\'s status', () => {
  it('PropertyPageClient.js and PriceOpinionCard.js contain no hard-coded pre-market-only phrasing outside of marketStatusCopy.js', () => {
    const fs2 = fs;
    const files = [
      '../../src/app/components/PropertyPageClient.js',
      '../../src/app/components/property-page/PriceOpinionCard.js',
      '../../src/app/components/property-page/PropertyInfoCard.js',
      '../../src/app/components/property-page/PropertyHero.js',
      '../../src/app/components/property-page/PropertyHeader.js',
      '../../src/app/components/property-page/AgentSignOff.js',
    ];
    for (const relPath of files) {
      const source = fs2.readFileSync(new URL(relPath, import.meta.url), 'utf-8').toLowerCase();
      for (const phrase of FORBIDDEN_ON_ON_MARKET_COPY) {
        expect(source, `${relPath} must not hard-code "${phrase}" — it must come from marketStatusCopy.js so on-market properties never see it`).not.toContain(phrase);
      }
    }
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
  'SmartPropertyImage.js',
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

  it('PropertyPageClient.js itself contains no hard-coded Harcourts branding either', () => {
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    expect(source.toLowerCase()).not.toContain('harcourts');
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

describe('Gallery UX refinement round', () => {
  it('the hero uses SmartPropertyImage (odd-aspect-ratio aware)', () => {
    const hero = readComponent('PropertyHero.js');
    expect(hero).toContain('SmartPropertyImage');
  });

  // Real-device testing on iPhone showed SmartPropertyImage's contain/
  // letterbox behaviour producing visible black bands on legitimate wide
  // aerial photos in the gallery strip — explicitly rejected. The normal
  // scrolling gallery must always fill its frame edge-to-edge with plain
  // object-cover, full stop, regardless of the source image's aspect
  // ratio. This is a deliberate, permanent product decision for this
  // component, not a temporary regression.
  it('the gallery thumbnails always use plain object-cover — never SmartPropertyImage\'s contain/letterbox behaviour', () => {
    const gallery = readComponent('PropertyGallery.js');
    // Not imported/rendered as a component (the explanatory comment above
    // is allowed to mention it by name — only an actual import or JSX
    // usage would re-introduce the rejected behaviour).
    expect(gallery).not.toMatch(/^import SmartPropertyImage/m);
    expect(gallery).not.toContain('<SmartPropertyImage');
    expect(gallery).not.toContain('shouldContainImage');
    expect(gallery).toMatch(/<Image[\s\S]*?object-cover/);
    expect(gallery).not.toContain('object-contain');
    expect(gallery).not.toMatch(/className="[^"]*bg-black/);
  });

  it('SmartPropertyImage defaults to object-cover (no visual change for normal photos) and never mutates the source image', () => {
    const source = readComponent('SmartPropertyImage.js');
    expect(source).toContain('object-cover');
    expect(source).toContain('object-contain');
    expect(source).not.toMatch(/fetch\(|writeFile|sharp\(/);
  });

  it('the gallery preserves existing image ordering (skips only the hero/first image, does not reorder or filter the rest)', () => {
    const source = readComponent('PropertyGallery.js');
    expect(source).toContain('imageUrls.slice(1)');
    expect(source).not.toMatch(/\.sort\(/);
  });

  it('the lightbox still shows the complete image (object-contain), unchanged by this round', () => {
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    expect(source).toContain('max-w-full max-h-full object-contain');
  });

  it('the lightbox swipe handlers call the existing next/prevImage functions — no new navigation/index logic was introduced', () => {
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    expect(source).toContain('const direction = getSwipeDirection(dx, dy);');
    expect(source).toMatch(/if \(direction === 'next'\) nextImage\(\);/);
    expect(source).toMatch(/else if \(direction === 'prev'\) prevImage\(\);/);
  });

  it('desktop equal-height cards use CSS grid stretch, not a duplicated height-forcing system', () => {
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    expect(source).toContain('items-stretch');
    // The dead-space anti-pattern this was previously fixed to avoid
    // (mt-auto forcing internal content apart) must not have returned.
    const infoCard = readComponent('PropertyInfoCard.js');
    expect(infoCard).not.toContain('mt-auto');
    expect(infoCard).not.toContain('h-full flex flex-col');
  });

  it('the footer tagline is exactly restored to the original wording', () => {
    const source = readComponent('AgentSignOff.js');
    expect(source).toContain('A smarter way to sell.');
    expect(source).not.toContain('understand the market before you sell');
  });
});

describe('Preview Mode protections remain intact after the gallery refinement', () => {
  it('every previously-guarded write path still checks isPreviewDeployment()', () => {
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    const matches = source.match(/isPreviewDeployment\(\)/g) || [];
    // incrementPropertyViews + savePriceOpinion + saveIpadPriceOpinion
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('<PreviewModeBanner />');
  });
});
