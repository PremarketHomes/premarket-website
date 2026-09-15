import { describe, it, expect } from 'vitest';
import { shouldContainImage } from '../../src/app/utils/imageFit';

describe('shouldContainImage', () => {
  it('does not contain normal real-estate landscape photo ratios', () => {
    expect(shouldContainImage(1600, 1200)).toBe(false); // 4:3
    expect(shouldContainImage(1500, 1000)).toBe(false); // 3:2
    expect(shouldContainImage(1920, 1080)).toBe(false); // 16:9
    expect(shouldContainImage(1920, 1200)).toBe(false); // 16:10
  });

  it('does not contain the hero\'s own widest 21:9 frame ratio', () => {
    expect(shouldContainImage(2560, 1080)).toBe(false); // 21:9 ≈ 2.37
  });

  it('contains a portrait phone screenshot', () => {
    expect(shouldContainImage(1170, 2532)).toBe(true); // iPhone screenshot, ~0.46
  });

  it('contains a near-square screenshot', () => {
    expect(shouldContainImage(1080, 1080)).toBe(true); // exactly square
  });

  it('contains an extreme panorama', () => {
    expect(shouldContainImage(4500, 1000)).toBe(true); // 4.5:1
  });

  it('is false (safe default) when dimensions are missing', () => {
    expect(shouldContainImage(0, 0)).toBe(false);
    expect(shouldContainImage(undefined, undefined)).toBe(false);
    expect(shouldContainImage(1600, 0)).toBe(false);
  });
});
