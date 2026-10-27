/**
 * Who a buyer registration belongs to.
 *
 * Two rules, kept here so the website form, the agent report and the vendor
 * report email can't drift apart:
 *
 * 1. ATTRIBUTION — a registration is linked to the signed-in account (userId)
 *    only when the email typed into the form is that account's own email.
 *    Otherwise the typed details stand alone. Being logged in as an agent or
 *    office admin must never make a registration someone else's.
 *
 * 2. DISPLAY — the name, email and phone typed into the registration win;
 *    the linked account's profile only fills what is missing.
 */

export const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/** Trimmed, case-insensitive; both sides must be non-empty. */
export function shouldLinkAccount({ typedEmail, accountEmail }) {
  const typed = normalizeEmail(typedEmail);
  const account = normalizeEmail(accountEmail);
  return typed !== '' && typed === account;
}

/**
 * The linked account's profile, but only if it can be this registration's buyer:
 * the registration has no typed email (older, account-only registrations), or the
 * typed email is the account's own. A profile belonging to someone else (e.g. an
 * agent who was logged in) is never used — not even to fill a missing phone or
 * to supply buyer preferences.
 */
export function profileForRegistration(offer, profile) {
  if (!profile) return null;
  const typed = normalizeEmail(offer?.buyerEmail);
  if (!typed) return profile;
  return typed === normalizeEmail(profile.email) ? profile : null;
}

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * @param offer   the registration (offers document): buyerName / buyerEmail / buyerPhone / userName
 * @param profile the linked account's users document, if any (fallback only)
 */
export function resolveBuyerIdentity(offer, linkedProfile) {
  const profile = profileForRegistration(offer, linkedProfile);
  const profileFullName = profile?.firstName && profile?.lastName
    ? `${profile.firstName} ${profile.lastName}`.trim()
    : null;
  return {
    name: clean(offer?.buyerName) || profileFullName || clean(profile?.firstName) || clean(offer?.userName),
    email: clean(offer?.buyerEmail) || clean(profile?.email),
    phone: clean(offer?.buyerPhone) || clean(profile?.phone),
  };
}
