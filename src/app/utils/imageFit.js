/**
 * Decides whether a specific uploaded image would be destructively
 * cropped by `object-cover` inside one of this page's landscape-oriented
 * photo frames (hero, gallery thumbnails) — e.g. a portrait phone
 * screenshot, a near-square screenshot, or an extreme panorama.
 *
 * Real-estate photography is reliably landscape, roughly in the 1.2–2.3
 * aspect-ratio range (4:3, 3:2, 16:9, up to the hero's own widest 21:9
 * frame). Anything well outside that band would lose most of its content
 * under `object-cover` and should be shown with `object-contain` +
 * letterboxing instead. Deliberately simple and breakpoint-agnostic
 * (rather than trying to track which exact responsive frame ratio is
 * currently active) — the goal is just to catch the genuinely odd cases
 * without ever second-guessing a normal photo.
 */
export function shouldContainImage(naturalWidth, naturalHeight) {
  if (!naturalWidth || !naturalHeight) return false;
  const ratio = naturalWidth / naturalHeight;
  return ratio < 1.15 || ratio > 2.5;
}
