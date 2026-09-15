/**
 * Decides whether a pointer/touch gesture (start -> end delta) counts as
 * an Instagram-style horizontal swipe, and which direction — used by the
 * property page's lightbox to navigate photos.
 *
 * A gesture only counts once it moves further horizontally than
 * vertically and past `threshold` px — this is what keeps a short tap
 * (e.g. tapping the photo, which shouldn't close or navigate anything)
 * and a vertical scroll/drag from ever being misread as a swipe.
 */
export function getSwipeDirection(dx, dy, threshold = 45) {
  if (Math.abs(dx) <= threshold) return null;
  if (Math.abs(dx) <= Math.abs(dy)) return null;
  return dx < 0 ? 'next' : 'prev';
}
