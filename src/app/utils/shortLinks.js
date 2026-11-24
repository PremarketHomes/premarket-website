/**
 * Premarket short links: premarket.homes/p/{code}, a short, SMS-friendly address for a campaign's buyer page.
 *
 * Why: agents send campaign links by SMS from their CRM (e.g. Rex). The full buyer link
 * (https://premarket.homes/find-property?propertyId=<20 chars>, 69 characters) eats most of an SMS segment, and
 * public shorteners (bit.ly, tinyurl.com) are refused by SMS senders/filters. A short link on our own domain is
 * 33 characters and never leaves premarket.homes.
 *
 * A code is 7 characters from a 28-character alphabet with no vowels (so codes don't spell words) and no look-alike
 * characters (0/o, 1/l/i): about 13.5 billion possible codes. Codes are random (they never encode the property id
 * or anything about the campaign) and are matched case-insensitively, so a link that was retyped or re-cased still
 * works. This file is shared by the browser and the server; it has no Firebase dependency.
 */

export const SHORT_CODE_ALPHABET = '23456789bcdfghjkmnpqrstvwxyz';
export const SHORT_CODE_LENGTH = 7;
export const SHORT_LINK_PATH = '/p/';
export const PUBLIC_ORIGIN = 'https://premarket.homes';

const CODE_RE = new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

export const isShortCode = (value) => typeof value === 'string' && CODE_RE.test(value);

/**
 * The canonical code for whatever followed /p/ in a link, or null when it cannot be one of ours. Tolerates the ways a
 * link gets mangled when it is pasted into a message: different letter case, a trailing full stop or bracket that a
 * phone included in the link, surrounding spaces, percent-encoding.
 */
export function normalizeShortCode(raw) {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  let s = raw;
  try { s = decodeURIComponent(s); } catch { /* keep the raw text */ }
  s = s.trim().replace(/[.,;:!?)\]}>'"]+$/, '').toLowerCase();
  return isShortCode(s) ? s : null;
}

/** The short link for a code. `origin` defaults to the live site; the dashboard passes its own origin. */
export const shortLinkUrl = (code, origin = PUBLIC_ORIGIN) => `${origin}${SHORT_LINK_PATH}${code}`;

/** The full buyer link: unchanged, still valid forever, and the fallback whenever a short link is not available. */
export const fullBuyerLink = (propertyId, origin = PUBLIC_ORIGIN) =>
  `${origin}/find-property?propertyId=${encodeURIComponent(propertyId)}`;
