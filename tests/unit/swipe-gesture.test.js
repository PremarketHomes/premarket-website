import { describe, it, expect } from 'vitest';
import { getSwipeDirection } from '../../src/app/utils/swipeGesture';

describe('getSwipeDirection', () => {
  it('detects a left swipe (finger moves right-to-left) as "next"', () => {
    expect(getSwipeDirection(-100, 0)).toBe('next');
  });

  it('detects a right swipe (finger moves left-to-right) as "prev"', () => {
    expect(getSwipeDirection(100, 0)).toBe('prev');
  });

  it('ignores short movements below the threshold (a tap, not a swipe)', () => {
    expect(getSwipeDirection(10, 0)).toBeNull();
    expect(getSwipeDirection(-10, 0)).toBeNull();
    expect(getSwipeDirection(0, 0)).toBeNull();
  });

  it('ignores a mostly-vertical gesture, even a long one', () => {
    expect(getSwipeDirection(20, 200)).toBeNull();
    expect(getSwipeDirection(-20, -200)).toBeNull();
  });

  it('respects a custom threshold', () => {
    expect(getSwipeDirection(60, 0, 100)).toBeNull();
    expect(getSwipeDirection(150, 0, 100)).toBe('prev');
  });

  it('rapid repeated swipes each resolve independently (pure function, no shared state)', () => {
    expect(getSwipeDirection(-80, 5)).toBe('next');
    expect(getSwipeDirection(-80, 5)).toBe('next');
    expect(getSwipeDirection(80, 5)).toBe('prev');
  });
});
