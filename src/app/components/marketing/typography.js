// Shared inline style for headings that should use the Playfair Display
// serif treatment established by the homepage/property-page, without
// pulling every marketing page onto `font-bold` sans display type.
// Requires the caller's page to apply `playfairDisplay.variable`
// (src/app/components/property-page/fonts.js) somewhere in its tree —
// falls back to a generic serif if that variable isn't present.
export const playfairFontStyle = { fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 };
