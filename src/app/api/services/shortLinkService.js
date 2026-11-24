import { randomInt } from 'node:crypto';
import {
  PROP_NUMBER_DIGITS, isPropNumber, propLinkUrl,
  SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, isShortCode, shortLinkUrl, fullBuyerLink,
} from '../../utils/shortLinks';
import { previewWritesBlocked } from './environmentGuard';

/**
 * Campaign links (see utils/shortLinks.js for the formats). Server only (Admin SDK).
 *
 * Data (all four collections are server-only: no client rule matches them, so the default-deny rule applies):
 *   propLinks/{number}                { propertyId, createdAt }   premarket.homes/prop{number} -> campaign. The number is
 *                                                                 the document id, so it can never point at two campaigns
 *   propertyPropLinks/{propertyId}    { number, createdAt }       the one prop number a campaign has
 *   shortLinks/{code}                 { propertyId, createdAt }   legacy premarket.homes/p/{code} -> campaign
 *   propertyShortLinks/{propertyId}   { code, createdAt }         legacy: a campaign's /p/ code
 *
 * Nothing here ever updates or deletes a document: a campaign's link is created (create(), which refuses to overwrite)
 * the first time a share screen, or the agent's campaign-link email, asks for it, and kept forever. Existing campaigns
 * therefore get their prop link on first use with no migration, campaign documents are never written, and the legacy
 * /p/ mappings are left exactly as they are (they keep resolving).
 *
 * Who may create one: any signed-in user, for a campaign that exists. A link is only another address for the
 * campaign's buyer page, which anyone who has the campaign id can already open; it grants nothing the full link does
 * not. Creation is idempotent (one link per campaign), so the number of writes can never exceed the number of campaigns.
 *
 * A preview deployment connected to the live database only READS links (see environmentGuard.js).
 */

export const PROP_LINKS = 'propLinks';
export const PROPERTY_PROP_LINKS = 'propertyPropLinks';
export const SHORT_LINKS = 'shortLinks';
export const PROPERTY_SHORT_LINKS = 'propertyShortLinks';
export const MAX_SHORT_LINK_BATCH = 50;
const MAX_CANDIDATES = 5; // unused numbers tried inside one transaction
const MAX_TRANSACTION_ROUNDS = 3; // a transaction that loses a race is run again (re-reading everything)
const PROPERTY_ID_RE = /^[A-Za-z0-9_-]{6,128}$/;

export const isPropertyId = (id) => typeof id === 'string' && PROPERTY_ID_RE.test(id);

/** A fresh prop number: 10 digits, first digit 1-9, uniformly random (crypto-strength; injectable for tests). */
export function generatePropNumber(rand = randomInt) {
  return String(rand(10 ** (PROP_NUMBER_DIGITS - 1), 10 ** PROP_NUMBER_DIGITS));
}

/** A fresh legacy /p/ code (only dashboards opened before the prop format still ask for these). */
export function generateShortCode(rand = randomInt) {
  let code = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i += 1) code += SHORT_CODE_ALPHABET[rand(SHORT_CODE_ALPHABET.length)];
  return code;
}

const KINDS = {
  prop: { links: PROP_LINKS, own: PROPERTY_PROP_LINKS, field: 'number', isValid: isPropNumber, generate: generatePropNumber },
  short: { links: SHORT_LINKS, own: PROPERTY_SHORT_LINKS, field: 'code', isValid: isShortCode, generate: generateShortCode },
};

const valueOf = (kind, snap) => {
  const value = snap?.exists ? snap.data()?.[kind.field] : null;
  return kind.isValid(value) ? value : null;
};

/**
 * Creates the campaign's link in one transaction: re-checks it has none, and picks a value no other campaign uses.
 * Concurrent requests (two tabs, two BSOs, a Copy click racing the page's own request) are safe: a transaction that
 * loses the race is retried, and if another request created this campaign's link meanwhile, that link is returned.
 */
async function createLink(db, kind, propertyId, generate) {
  const ownRef = db.collection(kind.own).doc(propertyId);
  let lastError = null;
  for (let round = 0; round < MAX_TRANSACTION_ROUNDS; round += 1) {
    try {
      return await db.runTransaction(async (tx) => {
        const existing = valueOf(kind, await tx.get(ownRef));
        if (existing) return existing; // created meanwhile by another request

        let value = null;
        for (let attempt = 0; attempt < MAX_CANDIDATES && !value; attempt += 1) {
          const candidate = generate();
          if (!kind.isValid(candidate)) continue;
          const taken = await tx.get(db.collection(kind.links).doc(candidate));
          if (!taken.exists) value = candidate;
        }
        if (!value) throw new Error('Could not find an unused link number');

        const createdAt = new Date();
        // create() (not set()) fails the transaction if either document appeared in the meantime: nothing is overwritten,
        // and a number already used by another campaign can never be reassigned.
        tx.create(db.collection(kind.links).doc(value), { propertyId, createdAt });
        tx.create(ownRef, { [kind.field]: value, createdAt });
        return value;
      });
    } catch (err) {
      lastError = err;
      const meanwhile = valueOf(kind, await ownRef.get().catch(() => null));
      if (meanwhile) return meanwhile;
    }
  }
  throw lastError;
}

/**
 * { [propertyId]: value | null } for up to MAX_SHORT_LINK_BATCH campaigns. Existing links are read in one round trip;
 * a campaign without one gets one created, unless creating is switched off (preview) or the campaign does not exist.
 * One campaign failing never fails the others: it gets null (its share screen then reports the failure).
 */
async function getOrCreate(db, kind, propertyIds, { generate = kind.generate, allowCreate = !previewWritesBlocked() } = {}) {
  const ids = [...new Set((propertyIds || []).filter(isPropertyId))].slice(0, MAX_SHORT_LINK_BATCH);
  const result = Object.fromEntries(ids.map((id) => [id, null]));
  if (ids.length === 0) return result;

  const own = await db.getAll(...ids.map((id) => db.collection(kind.own).doc(id)));
  const missing = [];
  own.forEach((snap, i) => {
    const value = valueOf(kind, snap);
    if (value) result[ids[i]] = value;
    else missing.push(ids[i]);
  });
  if (missing.length === 0 || !allowCreate) return result;

  // Only campaigns that exist get a link (read outside the transaction so a busy campaign document is never locked).
  const properties = await db.getAll(...missing.map((id) => db.collection('properties').doc(id)));
  const toCreate = missing.filter((_, i) => properties[i].exists);
  for (let i = 0; i < toCreate.length; i += 10) {
    await Promise.all(toCreate.slice(i, i + 10).map(async (id) => {
      try {
        result[id] = await createLink(db, kind, id, generate);
      } catch (err) {
        console.error(`Campaign link could not be created for ${id}:`, err?.message || err);
      }
    }));
  }
  return result;
}

/** { [propertyId]: prop number | null }, creating each campaign's number the first time it is asked for. */
export const getOrCreatePropNumbers = (db, propertyIds, options) => getOrCreate(db, KINDS.prop, propertyIds, options);

/** Legacy: { [propertyId]: /p/ code | null } (only dashboards opened before the prop format still ask). */
export const getOrCreateShortCodes = (db, propertyIds, options) => getOrCreate(db, KINDS.short, propertyIds, options);

/** The campaign's prop number if it already has one (read only, never creates). */
export async function existingPropNumber(db, propertyId) {
  if (!isPropertyId(propertyId)) return null;
  return valueOf(KINDS.prop, await db.collection(PROPERTY_PROP_LINKS).doc(propertyId).get());
}

/**
 * The link an email should carry: the campaign's prop link (created if needed); failing that, the /p/ link it already
 * has; failing that, the full link. Never throws: an email must always go out with a working link.
 */
export async function buyerShareLink(db, propertyId, origin) {
  try {
    const number = (await getOrCreatePropNumbers(db, [propertyId]))[propertyId];
    if (number) return propLinkUrl(number, origin);
  } catch (err) {
    console.error('Prop link lookup failed:', err?.message || err);
  }
  try {
    const code = (await getOrCreateShortCodes(db, [propertyId], { allowCreate: false }))[propertyId];
    if (code) return shortLinkUrl(code, origin);
  } catch { /* fall through to the full link */ }
  return fullBuyerLink(propertyId, origin);
}

/** { [propertyId]: link } for an email listing several campaigns (same fallbacks as buyerShareLink; never throws). */
export async function buyerShareLinks(db, propertyIds, origin) {
  const ids = [...new Set((propertyIds || []).filter(isPropertyId))];
  let numbers = {};
  try {
    for (let i = 0; i < ids.length; i += MAX_SHORT_LINK_BATCH) {
      Object.assign(numbers, await getOrCreatePropNumbers(db, ids.slice(i, i + MAX_SHORT_LINK_BATCH)));
    }
  } catch (err) {
    console.error('Prop link lookup failed:', err?.message || err);
    numbers = {};
  }
  return Object.fromEntries(ids.map((id) => [id, numbers[id] ? propLinkUrl(numbers[id], origin) : fullBuyerLink(id, origin)]));
}

/** The campaign a link points at, read straight from the mapping (null when there is no such link). */
export async function linkedPropertyId(db, kindName, value) {
  const kind = KINDS[kindName];
  if (!kind || !kind.isValid(value)) return null;
  const link = await db.collection(kind.links).doc(value).get();
  const propertyId = link.exists ? link.data().propertyId : null;
  return isPropertyId(propertyId) ? propertyId : null;
}

/**
 * What a link points at:
 *   { status: 'ok', propertyId }   the campaign exists: show its buyer page, which applies exactly the same rules as
 *                                  the full link (archived, sold, private, preview, ...)
 *   { status: 'gone', propertyId } the link is ours but the campaign has been deleted
 *   { status: 'unknown' }          no such link
 */
async function resolve(db, kindName, value) {
  const propertyId = await linkedPropertyId(db, kindName, value);
  if (!propertyId) return { status: 'unknown' };
  const property = await db.collection('properties').doc(propertyId).get();
  return property.exists ? { status: 'ok', propertyId } : { status: 'gone', propertyId };
}

export const resolvePropNumber = (db, number) => resolve(db, 'prop', number);
export const resolveShortCode = (db, code) => resolve(db, 'short', code);
