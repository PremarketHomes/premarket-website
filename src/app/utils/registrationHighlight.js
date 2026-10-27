/**
 * Helpers for the "?registration=<offerId>" deep link into the property report.
 * Pure so the behaviour is unit-tested without a browser.
 */

// Opaque Firestore ids only — anything else is ignored rather than used in a DOM lookup.
const ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

export function getRegistrationIdFromSearch(search) {
  const raw = new URLSearchParams(search || '').get('registration');
  return raw && ID_PATTERN.test(raw) ? raw : null;
}

export const registrationElementId = (id) => `registration-${id}`;

/** Is the linked registration one of this listing's registered buyers? */
export function findRegistration(opinions, id) {
  if (!id) return null;
  return (opinions || []).find((o) => o.id === id && o.serious === true) || null;
}

/**
 * When to (re)scroll the linked registration into view, in ms after the list
 * mounts. The first scroll is smooth; later ones correct for layout shifts as
 * images and charts above the list finish loading (common on mobile). Scrolling
 * stops as soon as the person scrolls or types themselves.
 */
export const HIGHLIGHT_SCROLL_DELAYS = [0, 350, 1200, 2500];
