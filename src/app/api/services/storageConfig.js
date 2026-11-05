/**
 * Where uploaded images go (Bunny storage zone + the public CDN base that serves them). Production values are the defaults;
 * a staging deployment sets BUNNY_STORAGE_ZONE / BUNNY_CDN_BASE (and NEXT_PUBLIC_EXTRA_IMAGE_HOST at build time for next/image)
 * so staging uploads never touch the live zone. Read at call time so tests and deployments can override.
 */
export const DEFAULT_STORAGE_ZONE = 'premarketvideos';
export const DEFAULT_CDN_BASE = 'https://premarketvideos.b-cdn.net/';

export const bunnyStorageZone = (env = process.env) => (env.BUNNY_STORAGE_ZONE || DEFAULT_STORAGE_ZONE).replace(/[^A-Za-z0-9_-]/g, '');

export function cdnBase(env = process.env) {
  const raw = env.BUNNY_CDN_BASE || DEFAULT_CDN_BASE;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return DEFAULT_CDN_BASE;
    return `${u.origin}/`;
  } catch { return DEFAULT_CDN_BASE; }
}

export const bunnyUploadUrl = (filename, env = process.env) => `https://syd.storage.bunnycdn.com/${bunnyStorageZone(env)}/${filename}`;
export const cdnUrlFor = (filename, env = process.env) => `${cdnBase(env)}${filename}`;
