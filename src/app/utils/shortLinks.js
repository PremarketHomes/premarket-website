/**
 * Premarket campaign links. Shared by the browser and the server; no Firebase dependency.
 *
 * THE link for a campaign (what every agent/BSO share action hands out):
 *   premarket.homes/prop{number}        e.g. premarket.homes/prop4827319056
 *
 *   - "prop" + 10 digits, the first never 0, so every link is exactly 30 characters (38 with https://) and reads like
 *     a listing number. Nothing about the property (address, suburb, agent, office, campaign id) is in it.
 *   - The number is random (crypto-strength), never sequential and never derived from the campaign id.
 *   - 9,000,000,000 possible numbers. Even if every home sold in Australia for the next 50 years ran on Premarket
 *     (~25-30 million campaigns) under 0.4% of the numbers would be in use: a new number collides with an existing
 *     one rarely, and a collision is simply re-rolled. A guessed number almost never lands on a real campaign
 *     (about 1 in 90,000 at 100,000 campaigns), the same order as the older /p/ codes (13.5 billion possibilities).
 *   - A campaign gets one number, the first time someone asks for its link, and keeps it forever.
 *
 * Marketing channel links (campaignChannels.js): the same link plus one letter, e.g. premarket.homes/prop4827319056s for
 * SMS. Same page; the letter only lets the campaign report count which link buyers opened.
 *
 * Older addresses, all still valid forever and rendering the very same page:
 *   premarket.homes/p/{code}            7-character short links handed out before the prop format (Nov 2026)
 *   premarket.homes/find-property?propertyId=...   the original full link
 */

import { channelForSuffix, suffixForChannel } from './campaignChannels';

export const PUBLIC_ORIGIN = 'https://premarket.homes';

// --- prop links (current) ---
export const PROP_PREFIX = 'prop';
export const PROP_NUMBER_DIGITS = 10;
const PROP_NUMBER_RE = /^[1-9][0-9]{9}$/;

/** True for a well-formed prop number (the digits after "prop"). */
export const isPropNumber = (value) => typeof value === 'string' && PROP_NUMBER_RE.test(value);

/**
 * The number in a prop link's path segment ("prop4827319056"), or null when it cannot be one of ours. Tolerates the
 * ways a link gets mangled in a message: a capitalised "Prop" (phones capitalise the first word of a sentence), a
 * trailing full stop or bracket, surrounding spaces, percent-encoding.
 */
export function normalizePropSlug(raw) {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  let s = raw;
  try { s = decodeURIComponent(s); } catch { /* keep the raw text */ }
  s = s.trim().replace(/[.,;:!?)\]}>'"]+$/, '').toLowerCase();
  if (!s.startsWith(PROP_PREFIX)) return null;
  const number = s.slice(PROP_PREFIX.length);
  return isPropNumber(number) ? number : null;
}

/**
 * A prop link's path segment read with its optional marketing-channel letter (see campaignChannels.js):
 *   "prop4827319056"  -> { number: '4827319056', channel: null }     the general link
 *   "prop4827319056s" -> { number: '4827319056', channel: 'sms' }
 * null when it cannot be one of ours. Same tolerance as normalizePropSlug (capital letters, trailing punctuation).
 * An unknown letter is not a link (null), never quietly treated as the general link.
 */
export function parsePropSlug(raw) {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  let s = raw;
  try { s = decodeURIComponent(s); } catch { /* keep the raw text */ }
  s = s.trim().replace(/[.,;:!?)\]}>'"]+$/, '').toLowerCase();
  if (!s.startsWith(PROP_PREFIX)) return null;
  const rest = s.slice(PROP_PREFIX.length);
  if (isPropNumber(rest)) return { number: rest, channel: null };
  const number = rest.slice(0, PROP_NUMBER_DIGITS);
  const channel = rest.length === PROP_NUMBER_DIGITS + 1 ? channelForSuffix(rest.slice(PROP_NUMBER_DIGITS)) : null;
  return isPropNumber(number) && channel ? { number, channel } : null;
}

/** Same-site path of a campaign's prop link: /prop4827319056, or /prop4827319056s for a channel's link. */
export const propPath = (number, channel) => `/${PROP_PREFIX}${number}${suffixForChannel(channel)}`;

/**
 * A campaign's prop link. `origin` defaults to the live site; the dashboard passes its own origin (staging).
 * `channel` ('email' | 'sms') gives that channel's link; leave it out for the general link.
 */
export const propLinkUrl = (number, origin = PUBLIC_ORIGIN, channel) => `${origin}${propPath(number, channel)}`;

// --- /p/ short links (legacy: still resolved forever, no longer handed out) ---
export const SHORT_CODE_ALPHABET = '23456789bcdfghjkmnpqrstvwxyz';
export const SHORT_CODE_LENGTH = 7;
export const SHORT_LINK_PATH = '/p/';

const CODE_RE = new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

export const isShortCode = (value) => typeof value === 'string' && CODE_RE.test(value);

/** The canonical code for whatever followed /p/ in a legacy short link, or null (same tolerance as prop links). */
export function normalizeShortCode(raw) {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  let s = raw;
  try { s = decodeURIComponent(s); } catch { /* keep the raw text */ }
  s = s.trim().replace(/[.,;:!?)\]}>'"]+$/, '').toLowerCase();
  return isShortCode(s) ? s : null;
}

/** A legacy /p/ short link for a code. */
export const shortLinkUrl = (code, origin = PUBLIC_ORIGIN) => `${origin}${SHORT_LINK_PATH}${code}`;

/** The original full buyer link: unchanged and still valid forever (no share screen hands it out any more). */
export const fullBuyerLink = (propertyId, origin = PUBLIC_ORIGIN) =>
  `${origin}/find-property?propertyId=${encodeURIComponent(propertyId)}`;
