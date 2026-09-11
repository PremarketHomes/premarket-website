import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import sharp from 'sharp';
import { CARD_WIDTH, CARD_HEIGHT } from '../../src/app/api/services/propertyCardService';
import { renderPropertyCardPng, FONTS } from '../../src/app/api/services/propertyCardRenderer';

// Deliberately NOT mocking sharp here. This is the exact pipeline that
// broke in production (text rendered as missing-glyph boxes) — the
// fastest way to catch a regression is to actually run it with the real,
// bundled font files, not a mock that would hide the bug entirely.

describe('bundled card fonts', () => {
  it('exist on disk at the paths the renderer references', () => {
    for (const [weight, filePath] of Object.entries(FONTS)) {
      expect(fs.existsSync(filePath), `missing font file for ${weight}: ${filePath}`).toBe(true);
    }
  });
});

describe('renderPropertyCardPng (real sharp + real bundled fonts)', () => {
  async function makeHero() {
    // A small synthetic base image is enough — this test is about text
    // rendering and layout, not photo quality.
    return sharp({ create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 3, background: '#335544' } })
      .png()
      .toBuffer();
  }

  it('produces a genuine 1080x1350 PNG for a normal set of stats', async () => {
    const heroBuffer = await makeHero();
    const png = await renderPropertyCardPng({
      heroBuffer,
      addressLines: ['59 Nautilus Way, Kingscliff'],
      viewsCount: 126,
      opinionsCount: 19,
      seriousBuyersCount: 5,
      medianDisplay: '$2.95M',
    });
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(CARD_WIDTH);
    expect(meta.height).toBe(CARD_HEIGHT);
    expect(meta.format).toBe('png');
  });

  it('does not throw for zero/missing stats and still produces the exact card size', async () => {
    const heroBuffer = await makeHero();
    const png = await renderPropertyCardPng({
      heroBuffer,
      addressLines: ['7 Test Street, Nowhere, WA 6000'],
      viewsCount: 0,
      opinionsCount: 0,
      seriousBuyersCount: 0,
      medianDisplay: '--',
    });
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(CARD_WIDTH);
    expect(meta.height).toBe(CARD_HEIGHT);
  });

  it('does not throw for a long, wrapped address', async () => {
    const heroBuffer = await makeHero();
    const png = await renderPropertyCardPng({
      heroBuffer,
      addressLines: ['1/456 Old Pacific Highway North', 'Upper Corindi Beach, NSW 2456…'],
      viewsCount: 4,
      opinionsCount: 19,
      seriousBuyersCount: 5,
      medianDisplay: '$2.95M',
    });
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(CARD_WIDTH);
    expect(meta.height).toBe(CARD_HEIGHT);
  });

  it('rejects a CSS rgba() color value rather than silently mis-rendering (regression guard)', async () => {
    // Pango markup's `foreground` attribute only understands hex/named
    // colors. This test exists because that exact mistake shipped once
    // already (see PR description) — if it recurs, this fails loudly
    // instead of quietly producing broken output.
    const heroBuffer = await makeHero();
    await expect(sharp({
      text: {
        text: '<span foreground="rgba(255,255,255,0.8)">Test</span>',
        fontfile: FONTS.regular,
        width: 400,
        rgba: true,
      },
    }).png().toBuffer()).rejects.toThrow();
    // Sanity: the real renderer (which never uses rgba()) must still work.
    const png = await renderPropertyCardPng({
      heroBuffer,
      addressLines: ['1 Test St'],
      viewsCount: 1,
      opinionsCount: 1,
      seriousBuyersCount: 1,
      medianDisplay: '$1.0M',
    });
    expect((await sharp(png).metadata()).width).toBe(CARD_WIDTH);
  });
});
