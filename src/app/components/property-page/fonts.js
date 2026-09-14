import { Playfair_Display } from 'next/font/google';

// Scoped to the redesigned property page only — applied via
// `playfairDisplay.variable` on that page's own wrapper element, never on
// layout.js/body, so no other page's typography is affected by this branch.
export const playfairDisplay = Playfair_Display({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
  preload: true,
});
