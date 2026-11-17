import { MITCH_HARROP_PINK } from '../../utils/teamTheme';

// Office-branded vendor landing pages. Each entry drives one page that an
// office's agents can send to a homeowner. To add an office, add an entry here
// and a one-line page at src/app/<slug>/page.js.
//
// `logo` is optional: { src, width, height } of a white-on-transparent brand
// asset (shown on navy). Only use an approved, supplied asset; when absent the page shows the office name
// as a plain text wordmark rather than an invented logo.
export const OFFICES = {
  hph: {
    slug: 'hph',
    name: 'Harcourts Property Hub',
    agentLabel: 'Harcourts Property Hub agent',
    navy: '#001f49',
    blue: '#00aeef',
    logo: { src: '/offices/hph/logo-white.png', width: 390, height: 174 }, // white-on-transparent, for navy backgrounds
    // Full-colour logo on white (supplied by HPH), for light backgrounds. It is also the office's Premarket branding logo:
    // an office admin sets https://premarket.homes/offices/hph/logo-colour.png in Office > Branding (no code hardcodes it).
    logoColour: { src: '/offices/hph/logo-colour.png', width: 636, height: 314 },
    contactHref: null, // optional tel:/mailto: link; none until supplied
  },
};

// Team variants of an office's vendor page: the office page EXACTLY (same component, layout, copy, logo and features),
// derived from the office entry so every update to it flows through, with only the team's accent colour (in place of
// the office's light-blue accent, which only ever appears on the navy background) and the team's name.
export const TEAM_PAGES = {
  harropteam: {
    ...OFFICES.hph,
    slug: 'harropteam',
    blue: MITCH_HARROP_PINK.colors.primary, // #FA5DB5 on HPH navy: 5.7:1
    team: { id: 'ICSKK5kDs5RF5OYs11mM', name: 'Mitch Harrop Team' },
  },
};
