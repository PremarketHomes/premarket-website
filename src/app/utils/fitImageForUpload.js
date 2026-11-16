/**
 * Makes a photo small enough for /api/upload-image (client side).
 *
 * Why: photos now upload through /api/upload-image (Bunny), the route the office-admin flow already uses, instead of
 * Firebase Storage. That route runs as a Vercel Function, and Vercel rejects request bodies over 4.5 MB before the route
 * even runs. Phone and camera photos can be larger than that.
 *
 * What it does:
 *  - A photo at or under the limit is returned UNCHANGED, so it is uploaded byte-for-byte (no recompression).
 *  - A larger photo is re-encoded once as a high-quality JPEG, stepping the long edge down from 4096 px until it fits.
 *    The camera's rotation is applied first (EXIF orientation), so the result is upright.
 *  - If nothing fits, it throws a clear, final (413) error rather than sending a file the server would refuse.
 */

// 4.5 MB is Vercel's request-body limit; keep headroom for the multipart envelope.
export const UPLOAD_LIMIT_BYTES = 4_000_000;
const MAX_EDGES = [4096, 3200, 2560, 2048];
const QUALITIES = [0.9, 0.82];

/** Pure: scale (width, height) so the long edge is at most `maxEdge`, keeping the aspect ratio. Never enlarges. */
export function targetSize(width, height, maxEdge) {
  const long = Math.max(width, height);
  if (!long || long <= maxEdge) return { width, height };
  const s = maxEdge / long;
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

const jpgName = (name) => `${String(name || 'photo').replace(/\.[^./]+$/, '')}.jpg`;

async function defaultDecode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back to <img> */ }
  }
  // <img> applies EXIF orientation by default in every current browser.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function defaultEncode(bitmap, width, height, quality) {
  const source = bitmap.source || bitmap;
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** `decode` / `encode` exist only so unit tests can run without a browser. */
export async function fitImageForUpload(file, { limit = UPLOAD_LIMIT_BYTES, decode = defaultDecode, encode = defaultEncode } = {}) {
  if (!file || typeof file.size !== 'number' || file.size <= limit) return file;
  const bitmap = await decode(file);
  try {
    for (const edge of MAX_EDGES) {
      const { width, height } = targetSize(bitmap.width, bitmap.height, edge);
      for (const quality of QUALITIES) {
        const blob = await encode(bitmap, width, height, quality);
        if (blob && blob.size <= limit) {
          return new File([blob], jpgName(file.name), { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
        }
      }
    }
  } finally {
    bitmap.close?.();
  }
  const err = new Error(`"${file.name || 'A photo'}" is too large to upload. Please choose a smaller photo.`);
  err.status = 413;
  throw err;
}
