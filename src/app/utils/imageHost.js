/**
 * Mirrors the `images.remotePatterns` hostnames in next.config.mjs —
 * the only hosts Next's image optimizer is actually allowed to fetch
 * from. Property photos don't always live on one of these: a listing
 * freshly synced from REX or Agentbox keeps whatever raw image URL that
 * integration returned (see rexService.js/agentboxService.js) until the
 * separate image-compression cron rehosts it to Bunny CDN — which can
 * be any external domain in the meantime.
 *
 * Passing `unoptimized` on next/image is always safe; passing an
 * unlisted host to the *optimizer* is not — it fails to render. This is
 * the one check standing between "unconditionally drop `unoptimized`
 * for a faster hero" and silently breaking hero photos for synced
 * listings, so the default for anything not recognised here must stay
 * unoptimized.
 */
const OPTIMIZABLE_IMAGE_HOSTS = [
  'premarketvideos.b-cdn.net',
  'premarket.homes',
  'www.airtasker.com',
  'firebasestorage.googleapis.com',
];

export function isOptimizableImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    return OPTIMIZABLE_IMAGE_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
