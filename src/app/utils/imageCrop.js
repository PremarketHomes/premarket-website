// Pure, framework-free canvas helpers for ImagePositioner.js. Kept
// separate (no 'use client', no JSX) so it can be unit tested without
// needing a DOM — the pixel-math functions below have no canvas/Image
// dependency at all; only getCroppedImageBlob touches the DOM, and is
// deliberately the one function this file keeps uncovered by unit tests.

/**
 * Loads an image from a URL (including a local blob: object URL) as an
 * HTMLImageElement, resolving once it's actually decoded and ready to
 * draw — getting this wrong is the most common source of a blank/broken
 * canvas export.
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Computes the canvas size for a baked export: fills `outputWidth` ×
 * `outputHeight` exactly when background is null (logo/avatar's own crop
 * rectangle already matches the target aspect, since the cropper is
 * locked to it) — background/padding is handled by the caller drawing
 * onto a larger canvas first when it wants breathing room around the
 * subject rather than an edge-to-edge fill.
 */
export function computeOutputSize({ outputWidth, outputHeight, maxDimension = 1600 }) {
  const scale = Math.min(1, maxDimension / Math.max(outputWidth, outputHeight));
  return {
    width: Math.round(outputWidth * scale),
    height: Math.round(outputHeight * scale),
  };
}

/**
 * Bakes the user's crop/zoom/pan into a single final image, drawn via
 * canvas from the ORIGINAL, full-resolution source — never from an
 * already-downscaled preview — so the exported file is never worse
 * quality than a direct crop of the original would be.
 *
 * `croppedAreaPixels` is react-easy-crop's own onCropComplete output:
 * the crop rectangle in the original image's own pixel coordinates.
 *
 * `background`, when provided, is drawn first and the cropped subject
 * is then composited centred on top at `subjectScale` (<=1) of the
 * canvas — this is how the agency-logo flow gets "the entire logo with
 * appropriate spacing" rather than an edge-to-edge crop: the agent
 * crops/zooms to frame the logo how they want inside the crop circle
 * shown in the UI, and that framed result is then inset with margin
 * rather than stretched to fill the whole canvas.
 */
export async function getCroppedImageBlob(imageSrc, croppedAreaPixels, {
  outputWidth,
  outputHeight,
  mimeType = 'image/png',
  quality = 0.92,
  background = null,
  subjectScale = 1,
} = {}) {
  const image = await loadImage(imageSrc);
  const { width, height } = computeOutputSize({ outputWidth, outputHeight });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  const drawWidth = width * subjectScale;
  const drawHeight = height * subjectScale;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;

  ctx.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      mimeType,
      quality
    );
  });
}

/**
 * Converts a Blob into a File with a sensible name/type, since the
 * existing /api/upload-image endpoint (unchanged by this feature) reads
 * a File out of FormData — this is the one bridge point back into the
 * existing, untouched upload pipeline.
 */
export function blobToFile(blob, filename) {
  return new File([blob], filename, { type: blob.type });
}

/**
 * Turns a percentage-based crop rectangle (react-easy-crop's own
 * `croppedArea` — {x, y, width, height}, all 0-100, as a fraction of the
 * ORIGINAL image) into a plain CSS `object-position` value, by taking
 * the rectangle's centre point.
 *
 * Deliberately NOT a zoom/transform: property photos render through
 * SmartPropertyImage.js, which already has its own object-fit/
 * object-contain fallback logic for photos that don't match their
 * frame's aspect ratio (see that file's own comment) — layering a
 * custom scale+translate transform on top of next/image's `fill` mode
 * would fight that, in ways hard to verify without a real browser.
 * `object-position` composes with `object-fit` natively, with no such
 * conflict, at the cost of only supporting repositioning, not zoom —
 * which is also why the property-hero picker that produces this locks
 * ImagePositioner's zoom at 1 (see dashboard add/edit pages): the crop
 * rectangle this reads is always the same size, so only its centre
 * (the focal point) ever actually varies.
 *
 * Returns null for a missing/invalid area, so a caller can fall back to
 * its existing default centred rendering for every property that has
 * never had a focal point set — this is purely additive, no existing
 * property needs any new data to keep rendering exactly as it does
 * today.
 */
export function cropAreaToObjectPosition(area) {
  if (!area || typeof area.x !== 'number' || typeof area.y !== 'number') return null;
  const width = area.width || 0;
  const height = area.height || 0;
  const cx = area.x + width / 2;
  const cy = area.y + height / 2;
  return `${cx}% ${cy}%`;
}
