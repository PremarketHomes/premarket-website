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
    contactHref: null, // optional tel:/mailto: link; none until supplied
  },
};
