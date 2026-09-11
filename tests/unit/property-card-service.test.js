import { describe, it, expect } from 'vitest';
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  median,
  computeOpinionStats,
  escapeXml,
  wrapAddressLines,
  buildBackgroundOverlaySvg,
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

describe('buildBackgroundOverlaySvg', () => {
  // This overlay deliberately contains no <text> at all — see the module
  // comment in propertyCardService.js. All text is rendered separately
  // in propertyCardRenderer.js via an explicit bundled font file, which
  // is what actually fixed the square/missing-glyph rendering bug.

  it('produces a well-formed SVG at the exact card dimensions', () => {
    const svg = buildBackgroundOverlaySvg({ gradientTop: 700 });
    expect(svg).toContain(`width="${CARD_WIDTH}"`);
    expect(svg).toContain(`height="${CARD_HEIGHT}"`);
    expect(svg.trim().startsWith('<svg')).toBe(true);
  });

  it('contains no text elements', () => {
    const svg = buildBackgroundOverlaySvg({ gradientTop: 700, brandMark: { x: 72, y: 1200, size: 30 } });
    expect(svg).not.toContain('<text');
  });

  it('includes the brand mark grid only when brandMark is provided', () => {
    const withMark = buildBackgroundOverlaySvg({ gradientTop: 700, brandMark: { x: 72, y: 1200, size: 30 } });
    const withoutMark = buildBackgroundOverlaySvg({ gradientTop: 700 });
    expect(withMark).toContain('#e48900');
    expect(withoutMark).not.toContain('#e48900');
  });

  it('clamps the gradient position within the canvas bounds', () => {
    const svgNegative = buildBackgroundOverlaySvg({ gradientTop: -500 });
    const svgTooLarge = buildBackgroundOverlaySvg({ gradientTop: 99999 });
    expect(svgNegative).toContain('y="0"');
    expect(svgTooLarge).toContain(`y="${CARD_HEIGHT}"`);
  });
});
