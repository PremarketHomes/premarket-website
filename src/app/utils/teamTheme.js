/**
 * Team accent themes: a small, display-only colour accent for ONE named team's dashboard and buyer-facing
 * campaign pages. Pure and client-safe. Which team (if any) a campaign or dashboard belongs to is decided
 * server-side only (api/services/teamThemes.js); the browser only ever receives the palette below, never a
 * team id or membership.
 *
 * Not a branding system: there is no logo, no agency name, no layout change. The office's master brand (its logo
 * and agency title) keeps applying exactly as before; a team theme only swaps the accent colour, and only where
 * the page already used an accent.
 *
 * Every palette must keep text readable (WCAG AA, 4.5:1), enforced by tests/unit/team-theme.test.js:
 *   `primaryText` on `primary` and `primaryDark` (button labels on the accent fill), and `accentText` on white and on
 *   `soft` (accent-coloured text such as prices, badges, links and labels). A bright `primary` is only ever a fill,
 *   a slider, a ring or a rule, never text on white.
 */

// Mitch Harrop Team (Harcourts Property Hub). No team logo or colours are configured in Premarket (the only agency
// brand is the HPH office brand). The accent is the bright pink of Mitch Harrop's public branding (~#FA5DB5, supplied
// by Luke on 2026-11-17); the text shades are the same hue, darkened only as far as readability requires.
export const MITCH_HARROP_PINK = Object.freeze({
  key: 'mitch-harrop-pink',
  official: false,
  colors: Object.freeze({
    primary: '#FA5DB5', // accent fill: buttons, slider, rings, rules, highlights
    primaryDark: '#F943A9', // gradient end / hover fill
    primaryText: '#3D0626', // text ON the accent fill (deep plum, 5.8:1; white would be 2.9:1)
    accentText: '#C61076', // accent-coloured text on white (5.6:1)
    soft: '#FFF0F8', // faint tint behind labels
    softBorder: '#FDC3E4',
    // The iPad kiosk tints its photo with the brand colour; for a team accent it stays the neutral slate it has with
    // no brand, so the pink is only on the slider and the approve button, never washed over the photo.
    tint: '#334155',
    tintDark: '#0f172a',
  }),
});

export const TEAM_THEME_PALETTES = Object.freeze({ [MITCH_HARROP_PINK.key]: MITCH_HARROP_PINK });

/** Only a known palette, looked up by key, is ever applied: a response can't inject arbitrary CSS. */
export function knownTeamTheme(theme) {
  const key = theme && typeof theme === 'object' ? theme.key : null;
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(TEAM_THEME_PALETTES, key) ? TEAM_THEME_PALETTES[key] : null;
}

/** Colours in the shape computeBrandStyle/computeEffectiveColors (brandStyle.js) already use on the buyer page,
 * the price-opinion slider, the confirmation dialog and the iPad kiosk. null = no team theme. */
export function teamBrandColors(theme) {
  const t = knownTeamTheme(theme);
  if (!t) return null;
  const { primary, primaryDark, primaryText, accentText, tint, tintDark } = t.colors;
  return { primary, primaryDark, primaryText, accentText, buttonText: primaryText, tint, tintDark };
}

/** Dashboard accent variables. Every dashboard use reads `var(--team-accent, <today's colour>)`, so with no theme
 * (undefined: no style attribute) every agent and team keeps exactly today's appearance. */
export function teamAccentStyle(theme) {
  const t = knownTeamTheme(theme);
  if (!t) return undefined;
  return {
    '--team-accent': t.colors.primary,
    '--team-accent-strong': t.colors.primaryDark,
    '--team-accent-soft': t.colors.soft,
    '--team-accent-border': t.colors.softBorder,
    '--team-accent-text': t.colors.accentText,
    '--team-accent-on': t.colors.primaryText,
  };
}

// `initial` makes a custom property the guaranteed-invalid value, so every var(--team-accent, <today's colour>)
// below it uses its fallback again: today's colours, whatever an enclosing dashboard is themed with.
const NO_TEAM_ACCENT = Object.freeze({
  '--team-accent': 'initial',
  '--team-accent-strong': 'initial',
  '--team-accent-soft': 'initial',
  '--team-accent-border': 'initial',
  '--team-accent-text': 'initial',
  '--team-accent-on': 'initial',
});

/** For one CAMPAIGN's card inside a dashboard: `theme` undefined = not known yet (inherit the dashboard's accent),
 * null = this campaign has no team theme (today's colours, even on a themed team's dashboard), else its palette. */
export function campaignAccentStyle(theme) {
  if (theme === undefined) return undefined;
  return teamAccentStyle(theme) || NO_TEAM_ACCENT;
}

/** WCAG relative-luminance contrast ratio of two #rrggbb colours. Used by the tests to guard every palette. */
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
