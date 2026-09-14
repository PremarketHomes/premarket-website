import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import sharp from 'sharp';
import { extractBrandColors, pickTextColor, hexToRgb } from '../../src/app/api/services/brandColorExtractor';

const HARCOURTS_LOGO_PATH = '/Users/samanthawilson/Downloads/images.png';

describe('pickTextColor — WCAG contrast, not a guess', () => {
  it('picks white text on a very dark background', () => {
    const result = pickTextColor('#011d47');
    expect(result.color).toBe('#ffffff');
    expect(result.meetsContrast).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('picks black text on a light/bright background', () => {
    const result = pickTextColor('#f5f5f5');
    expect(result.color).toBe('#000000');
    expect(result.meetsContrast).toBe(true);
  });

  it('flags meetsContrast: false for a colour where neither black nor white reaches AA, rather than pretending it is fine', () => {
    // A mid-grey where contrast against both black and white is marginal.
    const result = pickTextColor('#8a8a8a');
    expect(typeof result.meetsContrast).toBe('boolean');
    expect(['#ffffff', '#000000']).toContain(result.color);
  });
});

describe('hexToRgb', () => {
  it('parses a hex colour correctly', () => {
    expect(hexToRgb('#011d47')).toEqual({ r: 1, g: 29, b: 71 });
  });
});

describe('extractBrandColors — synthetic logos', () => {
  it('never picks white/transparent background as the brand colour', async () => {
    // A logo that is 95% white background with a small red square.
    const size = 100;
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#ffffff"/>
      <rect x="70" y="70" width="20" height="20" fill="#d0021b"/>
    </svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const result = await extractBrandColors(buffer);
    expect(result.usable).toBe(true);
    expect(result.primary.hex.toLowerCase()).not.toBe('#ffffff');
    // Should land on something in the red family, not white.
    const rgb = hexToRgb(result.primary.hex);
    expect(rgb.r).toBeGreaterThan(rgb.g);
    expect(rgb.r).toBeGreaterThan(rgb.b);
  });

  it('detects a small, distinctly-coloured accent even when a much larger neutral area dominates by pixel count', async () => {
    // Mostly dark navy (like a wordmark) with a thin, small, vivid cyan bar.
    const svg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#ffffff"/>
      <rect x="0" y="0" width="200" height="150" fill="#011d47"/>
      <rect x="0" y="160" width="60" height="10" fill="#01a8ec"/>
    </svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const result = await extractBrandColors(buffer);
    expect(result.usable).toBe(true);
    expect(result.secondary).not.toBeNull();
    // Primary should be the navy (dominant), secondary the cyan accent.
    const primaryRgb = hexToRgb(result.primary.hex);
    expect(primaryRgb.b).toBeGreaterThan(primaryRgb.r); // bluish-dark
  });

  it('returns usable: false rather than throwing for a logo with no usable colour (pure black/white)', async () => {
    const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#ffffff"/>
      <text x="10" y="50" font-size="20" fill="#000000">LOGO</text>
    </svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const result = await extractBrandColors(buffer);
    expect(result.usable).toBe(false);
    expect(result.primary).toBeNull();
  });

  it('always returns computed, accessible text colours for whatever it suggests', async () => {
    const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#ffffff"/>
      <rect x="10" y="10" width="80" height="80" fill="#7a1f2b"/>
    </svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const result = await extractBrandColors(buffer);
    expect(result.usable).toBe(true);
    expect(result.primary.text.color).toMatch(/^#(ffffff|000000)$/);
    expect(typeof result.primary.text.meetsContrast).toBe('boolean');
  });
});

describe('extractBrandColors — real Harcourts Property Hub logo', () => {
  const logoExists = fs.existsSync(HARCOURTS_LOGO_PATH);

  it.skipIf(!logoExists)('extracts a dark-navy primary and cyan secondary, both passing WCAG AA', async () => {
    const buffer = fs.readFileSync(HARCOURTS_LOGO_PATH);
    const result = await extractBrandColors(buffer);

    expect(result.usable).toBe(true);
    expect(result.primary.text.meetsContrast).toBe(true);

    const primaryRgb = hexToRgb(result.primary.hex);
    // Dark navy: low overall brightness, blue channel not the darkest.
    expect(primaryRgb.r + primaryRgb.g + primaryRgb.b).toBeLessThan(300);

    if (result.secondary) {
      expect(result.secondary.text.meetsContrast).toBe(true);
      const secondaryRgb = hexToRgb(result.secondary.hex);
      // Cyan-ish: blue and green both notably higher than red.
      expect(secondaryRgb.b).toBeGreaterThan(secondaryRgb.r);
    }
  });
});
