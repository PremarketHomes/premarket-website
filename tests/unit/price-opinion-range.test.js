import { describe, it, expect } from 'vitest';
import { computePriceOpinionRange, PRICE_OPINION_RANGE_FRACTION } from '../../src/app/utils/priceOpinionRange';

describe('PRICE_OPINION_RANGE_FRACTION', () => {
  it('is 25%, so the base price sits exactly at the midpoint of the range', () => {
    expect(PRICE_OPINION_RANGE_FRACTION).toBe(0.25);
  });
});

describe('computePriceOpinionRange', () => {
  it('derives +/-25% from property.price', () => {
    const { min, max } = computePriceOpinionRange({ price: 1000000 });
    expect(min).toBe(750000);
    expect(max).toBe(1250000);
  });

  it('accepts a string price with currency formatting', () => {
    const { min, max } = computePriceOpinionRange({ price: '$1,000,000' });
    expect(min).toBe(750000);
    expect(max).toBe(1250000);
  });

  it('places the base price exactly at the midpoint of min and max', () => {
    const { min, max } = computePriceOpinionRange({ price: 2800000 });
    expect(min).toBe(2100000);
    expect(max).toBe(3500000);
    expect((min + max) / 2).toBe(2800000);
  });

  it('falls back to propertyJob.price_estimate.mid when price is absent', () => {
    const { min, max } = computePriceOpinionRange({
      propertyJob: { price_estimate: { mid: 800000 } },
    });
    expect(min).toBe(600000);
    expect(max).toBe(1000000);
  });

  it('falls back to price_estimate.high then .low when mid is absent', () => {
    const { min } = computePriceOpinionRange({
      propertyJob: { price_estimate: { high: 900000 } },
    });
    // 900000 * 0.75 = 675000 exactly, which rounds half-up to the next
    // $10,000 step — same pre-existing roundToStep rounding behaviour.
    expect(min).toBe(680000);
  });

  it('falls back to priceGuide when no price or estimate exists', () => {
    const { min, max } = computePriceOpinionRange({ priceGuide: 500000 });
    // 500000 * 0.75 = 375000 and 500000 * 1.25 = 625000, both exactly
    // on a $5,000 half-step, so roundToStep's half-up rounding nudges
    // both outward to the next $10,000 step.
    expect(min).toBe(380000);
    expect(max).toBe(630000);
  });

  it('defaults the base price to 1,000,000 when nothing is available', () => {
    const { min, max } = computePriceOpinionRange({});
    expect(min).toBe(750000);
    expect(max).toBe(1250000);
  });

  it('rounds to the nearest $10,000 step', () => {
    const { min, max } = computePriceOpinionRange({ price: 777777 });
    expect(min % 10000).toBe(0);
    expect(max % 10000).toBe(0);
  });

  it('never exposes the base price itself, only the min/max it derives', () => {
    const range = computePriceOpinionRange({ price: 2800000 });
    expect(Object.keys(range).sort()).toEqual(['max', 'min']);
  });
});
