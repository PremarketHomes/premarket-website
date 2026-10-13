import { describe, it, expect } from 'vitest';
import { computePriceOpinionRange, PRICE_OPINION_RANGE_FRACTION } from '../../src/app/utils/priceOpinionRange';

describe('PRICE_OPINION_RANGE_FRACTION', () => {
  it('is 35%, widened from the original 25%', () => {
    expect(PRICE_OPINION_RANGE_FRACTION).toBe(0.35);
  });
});

describe('computePriceOpinionRange', () => {
  it('derives +/-35% from property.price', () => {
    const { min, max } = computePriceOpinionRange({ price: 1000000 });
    expect(min).toBe(650000);
    expect(max).toBe(1350000);
  });

  it('accepts a string price with currency formatting', () => {
    const { min, max } = computePriceOpinionRange({ price: '$1,000,000' });
    expect(min).toBe(650000);
    expect(max).toBe(1350000);
  });

  it('falls back to propertyJob.price_estimate.mid when price is absent', () => {
    const { min, max } = computePriceOpinionRange({
      propertyJob: { price_estimate: { mid: 800000 } },
    });
    expect(min).toBe(520000);
    expect(max).toBe(1080000);
  });

  it('falls back to price_estimate.high then .low when mid is absent', () => {
    const { min } = computePriceOpinionRange({
      propertyJob: { price_estimate: { high: 900000 } },
    });
    // 900000 * 0.65 = 585000 exactly, which rounds half-up to the next
    // $10,000 step — same pre-existing roundToStep rounding behaviour.
    expect(min).toBe(590000);
  });

  it('falls back to priceGuide when no price or estimate exists', () => {
    const { min, max } = computePriceOpinionRange({ priceGuide: 500000 });
    expect(min).toBe(330000);
    expect(max).toBe(680000);
  });

  it('defaults the base price to 1,000,000 when nothing is available', () => {
    const { min, max } = computePriceOpinionRange({});
    expect(min).toBe(650000);
    expect(max).toBe(1350000);
  });

  it('rounds to the nearest $10,000 step', () => {
    const { min, max } = computePriceOpinionRange({ price: 777777 });
    expect(min % 10000).toBe(0);
    expect(max % 10000).toBe(0);
  });
});
