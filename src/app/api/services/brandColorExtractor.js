/**
 * Agency Branding — logo colour extraction.
 *
 * Given an uploaded logo image (PNG/JPEG/SVG, any of which sharp can
 * decode/rasterize), suggests a small, web-appropriate colour palette:
 * a dominant "primary" colour, a distinct "secondary/accent" colour, and
 * the correct (computed, not guessed) text colour for legibility on top
 * of each.
 *
 * This never picks the single most common pixel colour outright — logos
 * are overwhelmingly white/transparent background, so that would almost
 * always suggest white as the "brand colour". Instead:
 *   1. Decode + downsample the logo to a small pixel grid via sharp.
 *   2. Discard near-white, near-black, and fully-transparent pixels as
 *      background candidates (not brand colours).
 *   3. Quantize remaining pixels into a reduced colour space and count
 *      frequency per bucket.
 *   4. Rank buckets by a combination of pixel count AND saturation, so a
 *      small but vivid accent (e.g. a thin coloured underline) isn't
 *      drowned out by a much larger neutral/dark wordmark.
 *   5. Compute WCAG contrast ratio for each candidate against both white
 *      and black text and pick whichever passes; if neither passes
 *      comfortably, fall back to whichever has the higher ratio and flag
 *      it so the UI can warn the agent.
 *
 * Nothing here writes anywhere — this is a pure suggestion function. The
 * agent always confirms (or manually overrides) before anything is saved
 * (see src/app/api/branding/confirm/route.js).
 */

import sharp from 'sharp';

const SAMPLE_SIZE = 240; // downsample target — plenty for colour analysis, fast to process
const BUCKET_STEP = 24; // quantization step per RGB channel (0-255 -> ~11 buckets/channel)

function isNearWhite(r, g, b) {
  return r > 235 && g > 235 && b > 235;
}
function isNearBlack(r, g, b) {
  return r < 20 && g < 20 && b < 20;
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** Standard perceptual saturation-ish measure (HSL saturation). */
function saturation(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/** WCAG relative luminance. */
function relativeLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** WCAG contrast ratio between two colours (each {r,g,b}). */
function contrastRatio(a, b) {
  const l1 = relativeLuminance(a.r, a.g, a.b);
  const l2 = relativeLuminance(b.r, b.g, b.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };
const WCAG_AA_NORMAL = 4.5;

/**
 * Picks white or black text for a given background colour, preferring
 * whichever meets WCAG AA (4.5:1) for normal text; if neither does,
 * returns the better of the two and flags `meetsContrast: false`.
 */
export function pickTextColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const whiteRatio = contrastRatio({ r, g, b }, WHITE);
  const blackRatio = contrastRatio({ r, g, b }, BLACK);
  if (whiteRatio >= WCAG_AA_NORMAL || blackRatio >= WCAG_AA_NORMAL) {
    return {
      color: whiteRatio >= blackRatio ? '#ffffff' : '#000000',
      ratio: Math.max(whiteRatio, blackRatio),
      meetsContrast: true,
    };
  }
  return {
    color: whiteRatio >= blackRatio ? '#ffffff' : '#000000',
    ratio: Math.max(whiteRatio, blackRatio),
    meetsContrast: false,
  };
}

export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/**
 * Extracts up to two candidate brand colours (primary + secondary) from
 * an image buffer. Returns null candidates (not a throw) if the logo has
 * no usable non-background colour at all (e.g. a purely black-on-white
 * wordmark) — callers should fall back to manual colour selection.
 */
export async function extractBrandColors(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map(); // key: quantized rgb -> { count, rSum, gSum, bSum }
  const channels = info.channels; // 4 (RGBA) due to ensureAlpha

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 128) continue; // mostly-transparent pixel — not a colour source
    if (isNearWhite(r, g, b) || isNearBlack(r, g, b)) continue; // background/ink-black, not "a brand colour"
    // Low-saturation greys — including anti-aliased edge pixels along
    // black text/strokes — aren't a "brand colour" either. Without this,
    // a purely black-and-white logo would spuriously suggest a random
    // grey as its primary colour instead of correctly reporting
    // `usable: false` so the agent picks a colour manually.
    if (saturation(r, g, b) < 0.15) continue;

    const key = [
      Math.round(r / BUCKET_STEP),
      Math.round(g / BUCKET_STEP),
      Math.round(b / BUCKET_STEP),
    ].join(',');

    const bucket = buckets.get(key) || { count: 0, rSum: 0, gSum: 0, bSum: 0 };
    bucket.count += 1;
    bucket.rSum += r;
    bucket.gSum += g;
    bucket.bSum += b;
    buckets.set(key, bucket);
  }

  const candidates = [...buckets.values()]
    .map((bucket) => {
      const r = bucket.rSum / bucket.count;
      const g = bucket.gSum / bucket.count;
      const b = bucket.bSum / bucket.count;
      return { r, g, b, count: bucket.count, saturation: saturation(r, g, b) };
    })
    // Rank by a blend of frequency and saturation, so a small vivid accent
    // can outrank a much larger but duller/neutral region.
    .sort((a, b) => (b.count * (0.4 + b.saturation)) - (a.count * (0.4 + a.saturation)));

  if (candidates.length === 0) {
    return { primary: null, secondary: null, usable: false };
  }

  const primary = candidates[0];
  // Secondary: the next candidate that's meaningfully different in hue
  // from the primary (avoid picking two near-identical shades of the
  // same colour as "primary" and "secondary").
  const secondary = candidates.slice(1).find((c) => colorDistance(c, primary) > 60) || null;

  const primaryHex = rgbToHex(primary.r, primary.g, primary.b);
  const secondaryHex = secondary ? rgbToHex(secondary.r, secondary.g, secondary.b) : null;

  return {
    usable: true,
    primary: {
      hex: primaryHex,
      text: pickTextColor(primaryHex),
    },
    secondary: secondaryHex
      ? { hex: secondaryHex, text: pickTextColor(secondaryHex) }
      : null,
  };
}

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}
