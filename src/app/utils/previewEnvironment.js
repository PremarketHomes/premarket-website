/**
 * Preview-deployment detection.
 *
 * The Firebase client config in `firebase/clientApp.js` is hardcoded
 * (not environment-variable driven), so EVERY deployment of this
 * codebase — production, any Vercel Preview branch, even a local dev
 * server — connects to the same real production Firestore project.
 * There is no separate staging/preview Firebase project to fall back to,
 * and standing one up is exactly the kind of "major infrastructure
 * change" this redesign was explicitly told not to make.
 *
 * Instead, this detects a Vercel Preview deployment purely from the
 * browser's own hostname — every Preview URL is served from a
 * `*.vercel.app` domain, while production is always `premarket.homes`.
 * No new environment variables or Vercel project configuration are
 * required for this to work correctly.
 */
export function isPreviewDeployment() {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.endsWith('.vercel.app');
}
