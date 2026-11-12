# Self-hosted fonts

These are Google's own latin-subset WOFF2 files for Poppins (400–800), Inter (variable),
Anton (400) and Playfair Display (variable), downloaded from Google Fonts on 2026-11-13.
They are loaded with `next/font/local` in `src/app/layout.js` and
`src/app/components/property-page/fonts.js`.

Why: `next/font/google` downloads fonts from Google during every build. Production builds on
Vercel failed (Nov 2026) whenever Google answered Vercel's build servers with a font URL
format next/font cannot parse ("next/font/google queries have exactly one entry").
Self-hosting removes that build-time network dependency entirely.

Licence: all four families are under the SIL Open Font License 1.1 (OFL-*.txt in this folder),
which permits bundling them with the site.
