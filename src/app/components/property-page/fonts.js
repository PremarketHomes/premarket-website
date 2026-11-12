import localFont from 'next/font/local';

// Scoped to the redesigned property page only — applied via
// `playfairDisplay.variable` on that page's own wrapper element, never on
// layout.js/body, so no other page's typography is affected by this branch.
//
// Self-hosted (src/app/fonts/, see README there) instead of next/font/google: the production
// build used to download this font from Google Fonts at build time, and failed whenever Google
// answered Vercel's build servers with a font URL format next/font cannot parse (Nov 2026).
export const playfairDisplay = localFont({
  src: [{ path: '../../fonts/playfair-display-latin-variable.woff2', weight: '500 700', style: 'normal' }],
  variable: '--font-playfair',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Times New Roman',
});
