import { describe, it, expect } from 'vitest';
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  median,
  computeOpinionStats,
  escapeXml,
  wrapAddressLines,
  buildCardOverlaySvg,
} from '../../src/app/api/services/propertyCardService';

describe('median', () => {
  it('returns 0 for an empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns the middle value for an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('computeOpinionStats', () => {
  it('matches the Report page\'s calculation shape for a mixed set of offers', () => {
    const offers = [
      { type: 'opinion', serious: true, offerAmount: 900000 },
      { type: 'opinion', serious: true, offerAmount: 950000 },
      { type: 'opinion', serious: false, offerAmount: 850000 },
      { type: 'registration' }, // non-opinion offer must be ignored
    ];
    const stats = computeOpinionStats(offers);
    expect(stats.opinionsCount).toBe(3);
    expect(stats.seriousBuyersCount).toBe(2);
    expect(stats.combinedMedian).toBe(900000);
  });

  it('handles an empty/undefined offers list gracefully — no NaN, no throw', () => {
    expect(computeOpinionStats([])).toEqual({ opinionsCount: 0, seriousBuyersCount: 0, combinedMedian: 0 });
    expect(computeOpinionStats(undefined)).toEqual({ opinionsCount: 0, seriousBuyersCount: 0, combinedMedian: 0 });
  });

  it('ignores non-positive or unparsable offer amounts', () => {
    const offers = [
      { type: 'opinion', serious: false, offerAmount: 0 },
      { type: 'opinion', serious: false, offerAmount: 'not-a-number' },
      { type: 'opinion', serious: false, offerAmount: 500000 },
    ];
    const stats = computeOpinionStats(offers);
    expect(stats.opinionsCount).toBe(3);
    expect(stats.combinedMedian).toBe(500000);
  });
});

describe('escapeXml', () => {
  it('escapes characters that would otherwise break the SVG document', () => {
    expect(escapeXml('5 & 7 <Main> "St"')).toBe('5 &amp; 7 &lt;Main&gt; &quot;St&quot;');
  });

  it('handles null/undefined without throwing', () => {
    expect(escapeXml(null)).toBe('');
    expect(escapeXml(undefined)).toBe('');
  });
});

describe('wrapAddressLines', () => {
  it('keeps a short address on one line', () => {
    expect(wrapAddressLines('12 Main St, Sydney')).toEqual(['12 Main St, Sydney']);
  });

  it('wraps a long address across at most 2 lines by default', () => {
    const lines = wrapAddressLines('1/456 Old Pacific Highway North, Upper Corindi Beach, NSW 2456, Australia');
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(28);
    }
  });

  it('truncates with an ellipsis rather than overflowing when text exceeds the line budget', () => {
    const lines = wrapAddressLines('1/456 Old Pacific Highway North, Upper Corindi Beach, NSW 2456, Australia');
    expect(lines[lines.length - 1]).toMatch(/…$/);
  });

  it('never throws and never returns an empty array for missing input', () => {
    expect(wrapAddressLines('')).toEqual(['Address unavailable']);
    expect(wrapAddressLines(null)).toEqual(['Address unavailable']);
    expect(wrapAddressLines(undefined)).toEqual(['Address unavailable']);
  });
});

describe('buildCardOverlaySvg', () => {
  const baseArgs = {
    addressLines: ['12 Main St, Sydney NSW 2000'],
    viewsCount: 126,
    opinionsCount: 19,
    seriousBuyersCount: 5,
    medianDisplay: '$2.9M',
  };

  it('produces a well-formed SVG at the exact card dimensions', () => {
    const svg = buildCardOverlaySvg(baseArgs);
    expect(svg).toContain(`width="${CARD_WIDTH}"`);
    expect(svg).toContain(`height="${CARD_HEIGHT}"`);
    expect(svg.trim().startsWith('<svg')).toBe(true);
  });

  it('includes every stat value and the Premarket wordmark', () => {
    const svg = buildCardOverlaySvg(baseArgs);
    expect(svg).toContain('126');
    expect(svg).toContain('19');
    expect(svg).toContain('$2.9M');
    expect(svg).toContain('5 Serious Buyers');
    expect(svg).toContain('Premarket');
  });

  it('never emits "undefined" or "NaN" even when stats are missing/zero', () => {
    const svg = buildCardOverlaySvg({
      addressLines: undefined,
      viewsCount: undefined,
      opinionsCount: 0,
      seriousBuyersCount: 0,
      medianDisplay: undefined,
    });
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('Address unavailable');
  });

  it('correctly pluralizes singular counts', () => {
    const svg = buildCardOverlaySvg({ ...baseArgs, opinionsCount: 1, seriousBuyersCount: 1 });
    expect(svg).toContain('Price Opinion<');
    expect(svg).toContain('1 Serious Buyer<');
  });

  it('escapes address text that contains XML-sensitive characters', () => {
    const svg = buildCardOverlaySvg({ ...baseArgs, addressLines: ['5 <Test> & "Co" St'] });
    expect(svg).toContain('&lt;Test&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).not.toContain('<Test>');
  });
});
