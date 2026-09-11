/**
 * Shareable Property Card — pure, testable logic.
 *
 * All I/O (Firestore reads, image fetch, sharp compositing) lives in the
 * route handler (src/app/api/reports/property-card/route.js). Everything
 * in this file is a deterministic function of its inputs so it can be unit
 * tested without mocking Firestore, sharp, or the network.
 *
 * Stat calculation mirrors src/app/dashboard/property/[id]/page.js exactly
 * (opinions = offers where type === 'opinion'; serious = offers where
 * serious === true; combined median = median of all opinion amounts,
 * serious + passive). That file is the Report and is intentionally left
 * untouched — if its calculation ever changes, this must be updated to
 * match, since the card's numbers must always agree with the Report.
 */

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

/** Same median implementation as the Report page. */
export function median(arr) {
  if (!arr || !arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Computes the same three opinion-derived stats the Report shows
 * ("Price Opinions", "Serious Buyers", "Combined Median") from a raw
 * array of offer documents.
 */
export function computeOpinionStats(offers) {
  const list = Array.isArray(offers) ? offers : [];
  const opinions = list.filter((o) => o?.type === 'opinion');
  const seriousBuyers = opinions.filter((o) => o?.serious === true);
  const passiveBuyers = opinions.filter((o) => o?.serious !== true);

  const seriousAmounts = seriousBuyers.map((o) => parseFloat(o.offerAmount) || 0).filter((a) => a > 0);
  const passiveAmounts = passiveBuyers.map((o) => parseFloat(o.offerAmount) || 0).filter((a) => a > 0);
  const allAmounts = [...seriousAmounts, ...passiveAmounts];

  return {
    opinionsCount: opinions.length,
    seriousBuyersCount: seriousBuyers.length,
    combinedMedian: median(allAmounts),
  };
}

/** Escapes text for safe embedding inside SVG/XML markup. */
export function escapeXml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[ch]));
}

/**
 * Greedily wraps an address into up to `maxLines` lines of roughly
 * `maxCharsPerLine` characters, truncating the final line with an
 * ellipsis if there's more text than fits. Never throws and never
 * produces a line longer than the budget, so unusually long addresses
 * can't break the card layout.
 */
export function wrapAddressLines(address, maxCharsPerLine = 28, maxLines = 2) {
  const text = String(address || '').trim();
  if (!text) return ['Address unavailable'];

  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length > maxLines) lines.length = maxLines;

  // If there's leftover text beyond what fits, ellipsize the last line.
  const consumed = lines.join(' ').length;
  if (consumed < text.replace(/\s+/g, ' ').length) {
    const last = lines[lines.length - 1] || '';
    const trimmed = last.length > maxCharsPerLine - 1 ? last.slice(0, maxCharsPerLine - 1) : last;
    lines[lines.length - 1] = `${trimmed}…`;
  }

  return lines.length ? lines : ['Address unavailable'];
}

/**
 * Builds a full-canvas SVG containing ONLY vector shapes — a dark bottom
 * gradient (for text legibility over any photograph) and the Premarket
 * brand mark (the same 2x2 rounded-square grid as
 * src/app/components/BrandMark.js). Deliberately contains no <text> at
 * all: SVG/vector shapes rasterize identically everywhere regardless of
 * what fonts a machine has installed, so keeping text out of this layer
 * entirely sidesteps the font-availability problem for the parts of the
 * design that don't need it. All actual text is rendered separately by
 * propertyCardRenderer.js using an explicitly bundled font file.
 */
export function buildBackgroundOverlaySvg({
  width = CARD_WIDTH,
  height = CARD_HEIGHT,
  gradientTop,
  brandMark, // { x, y, size } — top-left origin of the 2x2 grid
}) {
  const top = Math.max(0, Math.min(gradientTop ?? Math.round(height * 0.55), height));

  let brandMarkSvg = '';
  if (brandMark) {
    const { x, y, size } = brandMark;
    const sq = size * 0.4;
    const gap = size * 0.14;
    brandMarkSvg = `
      <g transform="translate(${x}, ${y})">
        <rect x="0" y="0" width="${sq}" height="${sq}" rx="4" fill="#e48900" />
        <rect x="${sq + gap}" y="0" width="${sq}" height="${sq}" rx="4" fill="#e48900" />
        <rect x="0" y="${sq + gap}" width="${sq}" height="${sq}" rx="4" fill="#e48900" />
        <rect x="${sq + gap}" y="${sq + gap}" width="${sq}" height="${sq}" rx="4" fill="#e48900" />
      </g>
    `;
  }

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0" />
      <stop offset="45%" stop-color="#000000" stop-opacity="0.55" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.9" />
    </linearGradient>
  </defs>
  <rect x="0" y="${top}" width="${width}" height="${height - top}" fill="url(#fade)" />
  ${brandMarkSvg}
</svg>
`;
}
