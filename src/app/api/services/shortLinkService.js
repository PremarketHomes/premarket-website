import { randomInt } from 'node:crypto';
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, isShortCode, shortLinkUrl, fullBuyerLink } from '../../utils/shortLinks';
import { previewWritesBlocked } from './environmentGuard';

/**
 * Short links for campaign buyer pages (premarket.homes/p/{code}). Server only (Admin SDK).
 *
 * Data (both collections are server-only: no client rule matches them, so the default-deny rule applies):
 *   shortLinks/{code}                   { propertyId, createdAt }   resolves a link; the code is the document id, so a
 *                                                                   code can never point at two campaigns
 *   propertyShortLinks/{propertyId}     { code, createdAt }         the one code a campaign has, so every share screen
 *                                                                   shows the same link
 * Existing documents are never changed: a campaign's code is created the first time a share screen (or the agent's
 * campaign-link email) asks for it, and kept forever. Campaign documents are not touched at all.
 *
 * Who may create one: any signed-in user, for a campaign that exists. A short link is only a second address for the
 * campaign's buyer page, which anyone who has the campaign id can already open; it grants nothing the full link does
 * not. Creation is idempotent (one code per campaign), so the total number of writes can never exceed the number of
 * campaigns.
 *
 * A preview deployment connected to the live database only READS codes (see environmentGuard.js): share screens there
 * fall back to the full link for a campaign that has no code yet.
 */

export const SHORT_LINKS = 'shortLinks';
export const PROPERTY_SHORT_LINKS = 'propertyShortLinks';
export const MAX_SHORT_LINK_BATCH = 50;
const MAX_CODE_ATTEMPTS = 5;
const PROPERTY_ID_RE = /^[A-Za-z0-9_-]{6,128}$/;

export const isPropertyId = (id) => typeof id === 'string' && PROPERTY_ID_RE.test(id);

/** A fresh random code (crypto-strength randomness; injectable for tests). */
export function generateShortCode(rand = randomInt) {
  let code = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i += 1) code += SHORT_CODE_ALPHABET[rand(SHORT_CODE_ALPHABET.length)];
  return code;
}

/** Creates the campaign's code in one transaction: re-checks it has none, and picks a code no other campaign uses. */
async function createShortCode(db, propertyId, generate) {
  return db.runTransaction(async (tx) => {
    const ownRef = db.collection(PROPERTY_SHORT_LINKS).doc(propertyId);
    const own = await tx.get(ownRef);
    if (own.exists && isShortCode(own.data().code)) return own.data().code; // created meanwhile by another tab

    let code = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !code; attempt += 1) {
      const candidate = generate();
      if (!isShortCode(candidate)) continue;
      const taken = await tx.get(db.collection(SHORT_LINKS).doc(candidate));
      if (!taken.exists) code = candidate;
    }
    if (!code) throw new Error('Could not find an unused short-link code');

    const createdAt = new Date();
    // create() (not set()) fails the transaction if either document appeared in the meantime: nothing is overwritten.
    tx.create(db.collection(SHORT_LINKS).doc(code), { propertyId, createdAt });
    tx.create(ownRef, { code, createdAt });
    return code;
  });
}

/**
 * { [propertyId]: code | null } for up to MAX_SHORT_LINK_BATCH campaigns. Existing codes are read in one round trip;
 * a campaign without one gets one created, unless creating is switched off (preview) or the campaign does not exist.
 * One campaign failing never fails the others: it simply gets null and its share screen shows the full link.
 */
export async function getOrCreateShortCodes(db, propertyIds, { generate = generateShortCode, allowCreate = !previewWritesBlocked() } = {}) {
  const ids = [...new Set((propertyIds || []).filter(isPropertyId))].slice(0, MAX_SHORT_LINK_BATCH);
  const result = Object.fromEntries(ids.map((id) => [id, null]));
  if (ids.length === 0) return result;

  const own = await db.getAll(...ids.map((id) => db.collection(PROPERTY_SHORT_LINKS).doc(id)));
  const missing = [];
  own.forEach((snap, i) => {
    const code = snap.exists ? snap.data().code : null;
    if (isShortCode(code)) result[ids[i]] = code;
    else missing.push(ids[i]);
  });
  if (missing.length === 0 || !allowCreate) return result;

  // Only campaigns that exist get a code (read outside the transaction so a busy campaign document is never locked).
  const properties = await db.getAll(...missing.map((id) => db.collection('properties').doc(id)));
  const toCreate = missing.filter((_, i) => properties[i].exists);
  for (let i = 0; i < toCreate.length; i += 10) {
    await Promise.all(toCreate.slice(i, i + 10).map(async (id) => {
      try {
        result[id] = await createShortCode(db, id, generate);
      } catch (err) {
        console.error(`Short link could not be created for ${id}:`, err?.message || err);
      }
    }));
  }
  return result;
}

/** The campaign's short link, or its full buyer link when a short link can't be had. Never throws (used in emails). */
export async function buyerShareLink(db, propertyId, origin) {
  try {
    const code = (await getOrCreateShortCodes(db, [propertyId]))[propertyId];
    if (code) return shortLinkUrl(code, origin);
  } catch (err) {
    console.error('Short link lookup failed, using the full link:', err?.message || err);
  }
  return fullBuyerLink(propertyId, origin);
}

/**
 * What a short link points at:
 *   { status: 'ok', propertyId }   the campaign exists: send the visitor to its buyer page, which applies exactly the
 *                                  same rules as the full link (archived, sold, private, preview, ...)
 *   { status: 'gone', propertyId } the code is ours but the campaign has been deleted
 *   { status: 'unknown' }          no such code
 */
export async function resolveShortCode(db, code) {
  if (!isShortCode(code)) return { status: 'unknown' };
  const link = await db.collection(SHORT_LINKS).doc(code).get();
  const propertyId = link.exists ? link.data().propertyId : null;
  if (!isPropertyId(propertyId)) return { status: 'unknown' };
  const property = await db.collection('properties').doc(propertyId).get();
  return property.exists ? { status: 'ok', propertyId } : { status: 'gone', propertyId };
}
