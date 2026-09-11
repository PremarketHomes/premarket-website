/**
 * Shareable Property Card — text + final compositing.
 *
 * Root cause of the original "square/missing-glyph" bug: text was drawn
 * via an SVG <text> element with font-family="Helvetica, Arial,
 * sans-serif". That works locally (macOS ships Helvetica), but Vercel's
 * production containers have no such font installed, so librsvg's
 * text renderer fell back to "missing glyph" boxes for every character.
 *
 * Fix: every piece of text here is rendered with sharp's native `text`
 * create-mode, which is given an explicit `fontfile` — a real TTF file
 * bundled in ./fonts, converted from this app's own existing brand font
 * (public/fonts/PangeaAfrikan-*.woff, already used across the live site).
 * This reads the font file directly and does not depend on the host
 * having any font installed or registered by name, so it renders
 * identically in a from-scratch Vercel container and locally. Verified
 * empirically: this still renders correct glyphs even when the local
 * fontconfig setup is broken/unavailable (see PR description/tests).
 *
 * next.config.mjs also explicitly lists ./fonts/** under
 * outputFileTracingIncludes for this route, so the font files are
 * guaranteed to ship with the deployed function regardless of whether
 * Vercel's automatic dependency tracing would have picked them up on its
 * own (sharp opens the file from native code, which static tracing can
 * miss).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CARD_WIDTH, CARD_HEIGHT, buildBackgroundOverlaySvg, escapeXml } from './propertyCardService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, 'fonts');

export const FONTS = {
  regular: path.join(FONT_DIR, 'PangeaAfrikan-Regular.ttf'),
  semibold: path.join(FONT_DIR, 'PangeaAfrikan-SemiBold.ttf'),
  bold: path.join(FONT_DIR, 'PangeaAfrikan-Bold.ttf'),
};

// Pango markup's `size` attribute is in 1024ths-of-a-point units. Calibrated
// empirically against this exact bundled font (see PR description): at the
// default text-rendering DPI, size 112000 renders a bold digit string at
// roughly 80-95px tall, 34000 renders a label at ~32px, matching the
// "large number, smaller label" hierarchy the design calls for.
const FONT_SIZE = {
  number: 112000,
  label: 34000,
  address: 58000,
  brand: 36000,
};

/**
 * Renders one block of text to its own transparent PNG buffer using an
 * explicit font file (see module comment for why this, not font-family).
 */
async function renderText({ text, fontfile, width, color = '#ffffff', size }) {
  const sizeAttr = size ? ` size="${size}"` : '';
  const markup = `<span foreground="${color}"${sizeAttr}>${escapeXml(text)}</span>`;
  const buffer = await sharp({
    text: {
      text: markup,
      fontfile,
      width,
      rgba: true,
      align: 'left',
    },
  }).png().toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width || 1, height: meta.height || 1 };
}

/**
 * Composites the final 1080x1350 card: the cover-cropped hero photo,
 * a bottom gradient + Premarket brand mark (vector shapes, no font
 * dependency), and every piece of text rendered via renderText(). Layout
 * positions are computed from each element's real measured size, so
 * nothing can overlap regardless of address length or stat digit count.
 */
export async function renderPropertyCardPng({
  heroBuffer,
  addressLines,
  viewsCount,
  opinionsCount,
  seriousBuyersCount,
  medianDisplay,
}) {
  const leftMargin = 72;
  const usableWidth = CARD_WIDTH - leftMargin * 2;
  const colGutter = 40;
  const colWidth = Math.floor((usableWidth - colGutter) / 2);

  const addressText = (addressLines && addressLines.length ? addressLines : ['Address unavailable']).join('\n');
  const address = await renderText({ text: addressText, fontfile: FONTS.semibold, width: usableWidth, color: '#ffffff', size: FONT_SIZE.address });

  const statDefs = [
    { value: String(viewsCount ?? 0), label: 'Views' },
    { value: String(opinionsCount ?? 0), label: opinionsCount === 1 ? 'Price Opinion' : 'Price Opinions' },
    { value: medianDisplay || '--', label: 'Combined Median' },
    { value: String(seriousBuyersCount ?? 0), label: seriousBuyersCount === 1 ? 'Serious Buyer' : 'Serious Buyers' },
  ];

  const stats = [];
  for (const def of statDefs) {
    const number = await renderText({ text: def.value, fontfile: FONTS.bold, width: colWidth, color: '#ffffff', size: FONT_SIZE.number });
    // Pango markup's foreground attribute only understands hex/named
    // colors, not CSS rgba() — use a solid light gray for the muted look.
    const label = await renderText({ text: def.label, fontfile: FONTS.regular, width: colWidth, color: '#d8d8d8', size: FONT_SIZE.label });
    stats.push({ number, label });
  }

  const brandWordmark = await renderText({ text: 'Premarket', fontfile: FONTS.semibold, width: 320, color: '#ffffff', size: FONT_SIZE.brand });

  // --- Layout: top-down cursor driven by real measured heights ---
  const topPadding = 64;
  const gapAfterAddress = 40;
  const numberLabelGap = 6;
  const rowGap = 32;
  const gapAfterStats = 34;
  const bottomPadding = 56;
  const brandMarkSize = 30;

  const row1Height = Math.max(stats[0].number.height, stats[1].number.height)
    + numberLabelGap
    + Math.max(stats[0].label.height, stats[1].label.height);
  const row2Height = Math.max(stats[2].number.height, stats[3].number.height)
    + numberLabelGap
    + Math.max(stats[2].label.height, stats[3].label.height);
  const brandRowHeight = Math.max(brandMarkSize, brandWordmark.height);

  const contentHeight = topPadding
    + address.height
    + gapAfterAddress
    + row1Height
    + rowGap
    + row2Height
    + gapAfterStats
    + brandRowHeight
    + bottomPadding;

  // Never let the protected zone shrink below ~34% of the canvas (keeps
  // layout sane for pathological inputs) and never push it above the top.
  const gradientTop = Math.min(
    Math.max(CARD_HEIGHT - contentHeight, Math.round(CARD_HEIGHT * 0.34)),
    CARD_HEIGHT - 200
  );

  let cursorY = gradientTop + topPadding;
  const composites = [];

  composites.push({ input: address.buffer, left: leftMargin, top: Math.round(cursorY) });
  cursorY += address.height + gapAfterAddress;

  const col0X = leftMargin;
  const col1X = leftMargin + colWidth + colGutter;

  const placeRow = (leftStat, rightStat, rowTop, rowHeight) => {
    composites.push({ input: leftStat.number.buffer, left: col0X, top: Math.round(rowTop) });
    composites.push({ input: leftStat.label.buffer, left: col0X, top: Math.round(rowTop + leftStat.number.height + numberLabelGap) });
    composites.push({ input: rightStat.number.buffer, left: col1X, top: Math.round(rowTop) });
    composites.push({ input: rightStat.label.buffer, left: col1X, top: Math.round(rowTop + rightStat.number.height + numberLabelGap) });
    return rowTop + rowHeight;
  };

  cursorY = placeRow(stats[0], stats[1], cursorY, row1Height) + rowGap;
  cursorY = placeRow(stats[2], stats[3], cursorY, row2Height) + gapAfterStats;

  const brandY = cursorY;
  composites.push({
    input: brandWordmark.buffer,
    left: Math.round(leftMargin + brandMarkSize + 14),
    top: Math.round(brandY + (brandMarkSize - brandWordmark.height) / 2),
  });

  const backgroundSvg = buildBackgroundOverlaySvg({
    gradientTop: Math.round(gradientTop),
    brandMark: { x: leftMargin, y: Math.round(brandY), size: brandMarkSize },
  });

  return sharp(heroBuffer)
    .composite([
      { input: Buffer.from(backgroundSvg), top: 0, left: 0 },
      ...composites,
    ])
    .png()
    .toBuffer();
}
