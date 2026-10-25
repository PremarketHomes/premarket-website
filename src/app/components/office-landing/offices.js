// Office-branded vendor landing pages. Each entry drives one page that an
// office's agents can send to a homeowner. To add an office, add an entry here
// and a one-line page at src/app/<slug>/page.js.
//
// `logo` is optional. Only point it at an approved, supplied brand asset
// (e.g. '/offices/hph/logo.svg'); when absent the page shows the office name
// as a plain text wordmark rather than an invented logo.
export const OFFICES = {
  hph: {
    slug: 'hph',
    name: 'Harcourts Property Hub',
    agentLabel: 'Harcourts Property Hub agent',
    navy: '#001f49',
    blue: '#00aeef',
    logo: null,
    contactHref: null, // optional tel:/mailto: link; none until supplied
  },
};
