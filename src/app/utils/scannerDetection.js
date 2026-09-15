/**
 * Conservative, User-Agent-based scanner/bot detection.
 *
 * This exists because Phase 2 of buyer-engagement tracking will send
 * personalised links through agent CRMs (REX/AgentBox etc.), and it's
 * common for those systems — or email/messaging clients relaying the
 * link — to automatically open a URL once server-side (a "link
 * preview"/scanner fetch) before the actual human recipient ever clicks
 * it. Left unfiltered, that would inflate "meaningful session" counts
 * and could even make it look like a buyer viewed a property they never
 * saw.
 *
 * This is deliberately NOT fingerprinting: it reads only the standard
 * User-Agent header already sent with every HTTP request, and matches it
 * against a documented list of known bot/scanner substrings. It cannot
 * be, and does not claim to be, 100% accurate — a determined scanner can
 * spoof a normal browser UA, and this will miss it. Genuine browsers are
 * never blocked or denied: a "scanner suspected" event is still fully
 * recorded (see propertyViews.scannerSuspected), just excluded from the
 * new session/opens counters so it doesn't distort buyer-intent
 * reporting. This keeps the data model able to distinguish/re-filter
 * these events later rather than baking in a permanent, unsafe
 * assumption.
 */
export const KNOWN_BOT_UA_PATTERNS = [
  // Search engine / generic web crawlers
  /googlebot/i,
  /bingbot/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /applebot/i,

  // Social / messaging link-preview scanners (exactly the kind of
  // "opens the link before the human does" behaviour Phase 2 needs to
  // guard against)
  /facebookexternalhit/i,
  /facebot/i,
  /twitterbot/i,
  /linkedinbot/i,
  /slackbot/i,
  /slack-imgproxy/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /skypeuripreview/i,
  /viber/i,

  // Email-client / mail-scanner link prefetchers
  /outlook/i,
  /mailchimp/i,
  /google-safebrowsing/i,
  /proofpoint/i,
  /barracuda/i,

  // Generic catch-alls for scripted/automated clients
  /\bbot\b/i,
  /crawler/i,
  /spider/i,
  /headlesschrome/i,
  /phantomjs/i,
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /axios\//i,
  /node-fetch/i,
  /go-http-client/i,
  /libwww-perl/i,
  /scrapy/i,
];

/**
 * Returns true if the given User-Agent string looks like a known
 * bot/crawler/link-scanner rather than a real browser. A missing/empty
 * User-Agent is treated as suspicious too (real browsers always send
 * one) but this is intentionally conservative elsewhere — see module
 * docblock.
 */
export function isLikelyScanner(userAgent) {
  if (!userAgent || typeof userAgent !== 'string' || !userAgent.trim()) {
    return true;
  }
  return KNOWN_BOT_UA_PATTERNS.some((pattern) => pattern.test(userAgent));
}
