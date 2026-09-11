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
 * Builds the full-canvas SVG overlay (gradient + address + stats +
 * Premarket branding) that gets composited on top of the cover-cropped
 * hero image. Returns a complete SVG document string.
 */
export function buildCardOverlaySvg({
  addressLines,
  viewsCount,
  opinionsCount,
  seriousBuyersCount,
  medianDisplay,
  width = CARD_WIDTH,
  height = CARD_HEIGHT,
}) {
  const safeAddressLines = (addressLines && addressLines.length ? addressLines : ['Address unavailable'])
    .map(escapeXml);

  const leftMargin = 80;
  const addressLineHeight = 52;
  const statBlockHeight = 128;

  // Reserve space for up to 2 address lines regardless of how many this
  // property actually has, so every other element's position is fixed and
  // can never overlap depending on address length.
  const addressReserved = 2 * addressLineHeight;

  const stats = [
    { value: String(viewsCount ?? 0), label: 'Views' },
    { value: String(opinionsCount ?? 0), label: opinionsCount === 1 ? 'Price Opinion' : 'Price Opinions' },
    { value: medianDisplay || '--', label: 'Combined Median' },
  ];
  const seriousLabel = seriousBuyersCount === 1 ? 'Serious Buyer' : 'Serious Buyers';

  // Fixed block heights, laid out top-to-bottom with a running cursor so
  // positions are computed sequentially and can never collide.
  const topPadding = 70;
  const gapAfterAddress = 44;
  const gapAfterStats = 30;
  const gapAfterSerious = 46;
  const bottomPadding = 56;
  const brandRowHeight = 40;
  const seriousRowHeight = 40;

  const contentHeight = topPadding
    + addressReserved
    + gapAfterAddress
    + stats.length * statBlockHeight
    + gapAfterStats
    + seriousRowHeight
    + gapAfterSerious
    + brandRowHeight
    + bottomPadding;

  const gradientTop = Math.max(height - contentHeight, Math.round(height * 0.35));

  let cursorY = gradientTop + topPadding;

  const addressStartY = cursorY + addressLineHeight * 0.7; // first baseline within the reserved block
  const addressText = safeAddressLines.map((line, i) => (
    `<text x="${leftMargin}" y="${addressStartY + i * addressLineHeight}" font-family="Helvetica, Arial, sans-serif" font-size="42" font-weight="600" fill="#ffffff">${line}</text>`
  )).join('\n');
  cursorY += addressReserved + gapAfterAddress;

  const statLines = stats.map((stat) => {
    const numberBaseline = cursorY + 78;
    const labelBaseline = numberBaseline + 40;
    cursorY += statBlockHeight;
    return `
      <text x="${leftMargin}" y="${numberBaseline}" font-family="Helvetica, Arial, sans-serif" font-size="84" font-weight="700" fill="#ffffff">${escapeXml(stat.value)}</text>
      <text x="${leftMargin}" y="${labelBaseline}" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="500" fill="rgba(255,255,255,0.82)" letter-spacing="0.5">${escapeXml(stat.label)}</text>
    `;
  }).join('\n');
  cursorY += gapAfterStats;

  const seriousY = cursorY + 30;
  cursorY += seriousRowHeight + gapAfterSerious;

  // Premarket brand mark — the same 2x2 rounded-square grid as
  // src/app/components/BrandMark.js, scaled down and placed bottom-left,
  // last in reading order so it reads as a subtle sign-off, not a header.
  const brandSize = 34;
  const brandY = cursorY;
  const sq = brandSize * 0.4;
  const brandGap = brandSize * 0.14;
  const brandMark = `
    <g transform="translate(${leftMargin}, ${brandY - brandSize * 0.72})">
      <rect x="0" y="0" width="${sq}" height="${sq}" rx="4" fill="#e48900" />
      <rect x="${sq + brandGap}" y="0" width="${sq}" height="${sq}" rx="4" fill="#e48900" />
      <rect x="0" y="${sq + brandGap}" width="${sq}" height="${sq}" rx="4" fill="#e48900" />
      <rect x="${sq + brandGap}" y="${sq + brandGap}" width="${sq}" height="${sq}" rx="4" fill="#e48900" />
    </g>
  `;

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0" />
      <stop offset="30%" stop-color="#000000" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.92" />
    </linearGradient>
  </defs>
  <rect x="0" y="${gradientTop}" width="${width}" height="${height - gradientTop}" fill="url(#fade)" />
  ${addressText}
  ${statLines}
  <text x="${leftMargin}" y="${seriousY}" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="600" fill="#ffffff">${escapeXml(String(seriousBuyersCount ?? 0))} ${escapeXml(seriousLabel)}</text>
  ${brandMark}
  <text x="${leftMargin + brandSize + 16}" y="${brandY + 6}" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="700" fill="#ffffff">Premarket</text>
</svg>
`;
}
