import { describe, it, expect } from 'vitest';
import { fitImageForUpload, targetSize, UPLOAD_LIMIT_BYTES } from '../../src/app/utils/fitImageForUpload';

const MB = 1_000_000;
const fakeFile = (name, size, type = 'image/jpeg') => ({ name, size, type, lastModified: 1 });
// Fake encoder: output size proportional to pixels and quality, so the step-down logic is exercised.
const encodeBy = (bytesPerPixelAtQ1) => async (_bmp, w, h, q) => ({ size: Math.round(w * h * bytesPerPixelAtQ1 * q) });

describe('targetSize', () => {
  it('keeps the aspect ratio, limits the long edge, never enlarges', () => {
    expect(targetSize(8000, 6000, 4096)).toEqual({ width: 4096, height: 3072 });
    expect(targetSize(3000, 6000, 4096)).toEqual({ width: 2048, height: 4096 });
    expect(targetSize(1200, 800, 4096)).toEqual({ width: 1200, height: 800 });
  });
});

describe('fitImageForUpload', () => {
  it('stays under the 4.5 MB Vercel request limit with headroom', () => {
    expect(UPLOAD_LIMIT_BYTES).toBeLessThan(4.5 * MB);
  });

  it('returns a photo at or under the limit UNCHANGED (sent byte-for-byte), without decoding it', async () => {
    const f = fakeFile('a.jpg', UPLOAD_LIMIT_BYTES);
    let decoded = false;
    expect(await fitImageForUpload(f, { decode: async () => { decoded = true; } })).toBe(f);
    expect(decoded).toBe(false);
  });

  it('re-encodes a larger photo once as JPEG at the first size that fits, renamed .jpg', async () => {
    let closed = false;
    const out = await fitImageForUpload(fakeFile('IMG_1.PNG', 12 * MB, 'image/png'), {
      decode: async () => ({ width: 8064, height: 6048, close: () => { closed = true; } }),
      encode: encodeBy(0.3), // 4096x3072 at q0.9 ≈ 3.4 MB → fits at the first step
    });
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('IMG_1.jpg');
    expect(out.size).toBeLessThanOrEqual(UPLOAD_LIMIT_BYTES);
    expect(closed).toBe(true);
  });

  it('steps down the long edge until it fits', async () => {
    const sizes = [];
    const out = await fitImageForUpload(fakeFile('b.jpg', 20 * MB), {
      decode: async () => ({ width: 8000, height: 6000 }),
      encode: async (b, w, h, q) => { sizes.push(w); return { size: Math.round(w * h * 0.6 * q) }; },
    });
    expect(out.size).toBeLessThanOrEqual(UPLOAD_LIMIT_BYTES);
    expect(sizes[0]).toBe(4096);
    expect(Math.min(...sizes)).toBeLessThan(4096);
  });

  it('throws a clear, final (413) error naming the photo when nothing fits', async () => {
    await expect(fitImageForUpload(fakeFile('huge.tif', 90 * MB), {
      decode: async () => ({ width: 8000, height: 6000 }),
      encode: async () => ({ size: 10 * MB }),
    })).rejects.toMatchObject({ status: 413, code: 'PHOTO_UNUSABLE', message: expect.stringContaining('"huge.tif" is too large') });
  });

  it('a large file the browser cannot decode is reported as unusable (skipped), not a crash', async () => {
    await expect(fitImageForUpload(fakeFile('scan.tiff', 9 * MB, 'image/tiff'), {
      decode: async () => { throw new Error('decode failed'); },
    })).rejects.toMatchObject({ code: 'PHOTO_UNUSABLE', message: '"scan.tiff" could not be read as a photo.' });
  });
});
