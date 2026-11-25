/**
 * Marketing channel links: the same campaign link with one extra letter saying which channel it was handed out in.
 * Shared by the browser and the server; no Firebase dependency.
 *
 *   premarket.homes/prop4827319056     General link (the campaign link every screen already hands out)
 *   premarket.homes/prop4827319056e    Email link
 *   premarket.homes/prop4827319056s    SMS link
 *
 * All three open the very same buyer page. The letter is a campaign-level label of the LINK, nothing else: it says
 * nothing about the buyer, and it is the same for everyone the agent sent that link to. What it measures is the link a
 * buyer opened, not how they first heard about the campaign (a forwarded email link still counts as Email).
 *
 * Adding a channel later (e.g. a QR sign) is one entry here: a new, unused lowercase letter, never reusing an old one.
 * next.config.mjs must accept the new letter in its /prop rewrite.
 */

export const CHANNELS = [
  { key: 'email', suffix: 'e', label: 'Email', linkLabel: 'Email link' },
  { key: 'sms', suffix: 's', label: 'SMS', linkLabel: 'SMS link' },
];

/** Everything without a channel letter: the general link, older links, the full link, and activity from before channel links. */
export const GENERAL_CHANNEL = { key: 'general', label: 'General / Unknown', linkLabel: 'General link' };

/**
 * A channel's opinion count is shown only when it is at least this many (the same minimum the report already uses for
 * group medians, opinionPrivacy.MIN_GROUP). See api/services/channelReport.js.
 */
export const MIN_CHANNEL_OPINIONS = 3;

const BY_KEY = new Map(CHANNELS.map((c) => [c.key, c]));
const BY_SUFFIX = new Map(CHANNELS.map((c) => [c.suffix, c]));

/** True for a channel that has its own link ('email', 'sms'). 'general' and anything else are not. */
export const isChannel = (key) => typeof key === 'string' && BY_KEY.has(key);

/** The channel for a link letter ('e' -> 'email'), or null. */
export const channelForSuffix = (suffix) => (typeof suffix === 'string' ? BY_SUFFIX.get(suffix.toLowerCase())?.key || null : null);

/** The link letter for a channel ('sms' -> 's'), or '' for the general link / anything unknown. */
export const suffixForChannel = (key) => BY_KEY.get(key)?.suffix || '';

/** Display label for a channel key, including 'general'. */
export const channelLabel = (key) => BY_KEY.get(key)?.label || GENERAL_CHANNEL.label;

/** The letters the /prop rewrite accepts (used by the tests to keep next.config.mjs in step). */
export const CHANNEL_SUFFIXES = CHANNELS.map((c) => c.suffix);
