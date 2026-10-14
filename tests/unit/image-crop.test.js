import { describe, it, expect } from 'vitest';
import { computeOutputSize, cropAreaToObjectPosition } from '../../src/app/utils/imageCrop';

describe('computeOutputSize', () => {
  it('returns the requested size unchanged when under maxDimension', () => {
    expect(computeOutputSize({ outputWidth: 480, outputHeight: 480, maxDimension: 1600 }))
      .toEqual({ width: 480, height: 480 });
  });

  it('scales down proportionally when the larger side exceeds maxDimension', () => {
    const result = computeOutputSize({ outputWidth: 4000, outputHeight: 2000, maxDimension: 1600 });
    expect(result.width).toBe(1600);
    expect(result.height).toBe(800);
  });

  it('never upscales — a smaller request stays smaller than maxDimension', () => {
    const result = computeOutputSize({ outputWidth: 200, outputHeight: 100, maxDimension: 1600 });
    expect(result).toEqual({ width: 200, height: 100 });
  });

  it('preserves aspect ratio exactly when scaling a wide logo frame', () => {
    const result = computeOutputSize({ outputWidth: 4800, outputHeight: 1200, maxDimension: 1600 });
    expect(result.width / result.height).toBeCloseTo(4800 / 1200, 5);
  });
});

describe('cropAreaToObjectPosition', () => {
  it('returns null for a missing/invalid area — callers fall back to default centred rendering', () => {
    expect(cropAreaToObjectPosition(null)).toBeNull();
    expect(cropAreaToObjectPosition(undefined)).toBeNull();
    expect(cropAreaToObjectPosition({})).toBeNull();
  });

  it('a full-image crop centres on 50% 50% — identical to the existing default', () => {
    expect(cropAreaToObjectPosition({ x: 0, y: 0, width: 100, height: 100 })).toBe('50% 50%');
  });

  it('takes the centre point of the crop rectangle, not its top-left corner', () => {
    // A 40%-wide/tall crop starting at (10, 60) is centred at (30, 80).
    expect(cropAreaToObjectPosition({ x: 10, y: 60, width: 40, height: 40 })).toBe('30% 80%');
  });

  it('handles a zero-size (pure point) crop — the locked-zoom focal-point case', () => {
    expect(cropAreaToObjectPosition({ x: 25, y: 75, width: 0, height: 0 })).toBe('25% 75%');
  });
});
