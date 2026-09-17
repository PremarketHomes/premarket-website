/**
 * Shared client-side helpers for the property media uploader (Add Property
 * and Edit Property both use these). Two independent concerns:
 *
 * 1. Resize/re-encode oversized photos in the browser before they go over
 *    the network, so agents aren't uploading full 8-25MB camera/phone
 *    originals just to have the server immediately re-download, resize and
 *    re-upload them (see /api/images/compress). 2000px width matches the
 *    server-side compression target already in production, so this doesn't
 *    change the final quality bar buyers see — it just does the same resize
 *    once, earlier, instead of twice.
 * 2. A small bounded-concurrency runner so multiple photos upload in
 *    parallel (a handful at a time) instead of strictly one-at-a-time,
 *    without ever firing off dozens of simultaneous uploads/decodes that
 *    could exhaust memory on a phone browser.
 */

const MAX_UPLOAD_WIDTH = 2000;
const JPEG_QUALITY = 0.85;
// Below this, decoding + re-encoding only spends CPU/battery for no real
// byte savings — leave the file exactly as selected.
const SKIP_RESIZE_UNDER_BYTES = 900 * 1024;

/**
 * Pure sizing decision, kept separate from any canvas/DOM work so it can be
 * unit tested without a browser environment. Returns null when the source
 * is already at or under the target width (nothing to do), otherwise the
 * target dimensions preserving aspect ratio.
 */
export function computeResizeTarget(width, height, maxWidth = MAX_UPLOAD_WIDTH) {
  if (!width || !height || width <= maxWidth) return null;
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.round(height * scale) };
}

/**
 * Resizes/re-encodes a single image File in the browser ahead of upload.
 * Always resolves — any failure (unsupported format, decode error, etc.)
 * falls back to returning the original, untouched file rather than
 * blocking the upload.
 */
export async function resizeImageForUpload(file, options = {}) {
  const maxWidth = options.maxWidth ?? MAX_UPLOAD_WIDTH;
  const quality = options.quality ?? JPEG_QUALITY;

  if (!file || file.size <= SKIP_RESIZE_UNDER_BYTES) return file;
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const target = computeResizeTarget(bitmap.width, bitmap.height, maxWidth);
    if (!target) return file;

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;

    const baseName = (file.name || 'photo').replace(/\.(png|jpe?g|webp|heic|heif)$/i, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    console.error('Client-side image resize failed, uploading original:', err);
    return file;
  } finally {
    bitmap?.close?.();
  }
}

/**
 * Runs `worker` over `items` with at most `limit` in flight at once.
 * Each item's success/failure is isolated — one rejection does not stop
 * the others from running. Results are returned in the same order as
 * `items`, each as { ok: true, value } or { ok: false, error }.
 */
export async function runWithConcurrency(items, worker, limit = 4) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runNext() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
}
