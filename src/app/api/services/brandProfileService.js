/**
 * Agency Branding — shared default + optional per-agent override.
 *
 * agencyBrands/{brandId} is public-read (the public property page needs
 * it without requiring the buyer to log in), server-write-only (see
 * firestore.rules). Contains no secrets — only a logo URL and colour hex
 * values. This is deliberately a completely separate collection from
 * `integrationCredentials` (Rex/Agentbox secrets) — branding data and
 * third-party credentials must never live in the same place.
 *
 * Model (no approvals, no roles, no membership gate of any kind):
 *   1. The FIRST agent to submit a given agency name establishes the
 *      shared brand (createBrand) — an atomic Firestore `.create()`
 *      makes this race-safe: if two agents submit the identical name at
 *      the same instant, exactly one creates it and the other silently
 *      joins the one that won (see the ALREADY_EXISTS handling below).
 *   2. Every SUBSEQUENT agent whose company name exactly matches
 *      (case/whitespace-normalized only — never fuzzy) automatically
 *      gets `users/{uid}.agencyBrandId` set to that brand — no click,
 *      no review (see autoEstablishBrandForUser).
 *   3. Any agent, at any time, may set their OWN personal logo/colour
 *      override (`users/{uid}.logoUrl` / `.brandColors`) — this NEVER
 *      writes to the shared agencyBrands doc and never affects any
 *      other agent. Resolution is personal override → shared brand →
 *      Premarket default (see brandStyle.js). "Reset to Agency
 *      Branding" simply clears those two fields.
 *
 * `users/{uid}.agencyBrandId` is itself protected in firestore.rules so
 * only the server (via this file) can set it — never the client
 * directly. `brandColors` is likewise never in the client update
 * allowlist — color validation (buildColorSet) must always happen
 * server-side, so a direct client write could never bypass it.
 *
 * Office integration (see officeService.js): a member of an office
 * (`users/{uid}.officeId` set) never uses steps 1/2 above at all — no
 * exact-name text matching, ever, for an office member. Their shared
 * brand is instead resolved directly from `offices/{officeId}.agencyBrandId`
 * (see resolveBrandIdForUser) — an O(1) doc lookup, immune to typos, and
 * it re-resolves live on every read, so removing someone from an office
 * (officeId cleared) instantly drops the office's branding for them with
 * nothing to clean up. `createBrand` accepts an optional `officeId` to
 * support this: when given, it links the NEW brand to the office doc
 * instead of the calling user's own doc (see /api/offices/{id}/branding).
 * Personal overrides (step 3) are completely unaffected either way.
 */

import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { pickTextColor, extractBrandColors } from './brandColorExtractor';

const BRANDS_COLLECTION = 'agencyBrands';

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `brand-${Date.now()}`;
}

/** Simple RGB darken, used to derive the second gradient stop from a
 * single agent-picked primary colour (mirrors the existing orange
 * gradient's two-stop look without asking the agent to pick a second
 * "dark" shade themselves). */
function darken(hex, amount = 0.82) {
  const clean = hex.replace('#', '');
  const r = Math.round(parseInt(clean.slice(0, 2), 16) * amount);
  const g = Math.round(parseInt(clean.slice(2, 4), 16) * amount);
  const b = Math.round(parseInt(clean.slice(4, 6), 16) * amount);
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/**
 * Validates and normalizes a colour submission (recomputes text contrast
 * server-side regardless of what the client sends — never trust a
 * client-computed contrast result, since the agent may have manually
 * overridden the suggested hex values).
 */
export function buildColorSet({ primary, secondary }) {
  if (!primary || !/^#[0-9a-fA-F]{6}$/.test(primary)) {
    throw new Error('A valid primary colour (hex) is required');
  }
  const primaryText = pickTextColor(primary);
  const result = {
    primary,
    primaryDark: darken(primary),
    primaryText: primaryText.color,
    primaryTextMeetsContrast: primaryText.meetsContrast,
  };
  if (secondary && /^#[0-9a-fA-F]{6}$/.test(secondary)) {
    const secondaryText = pickTextColor(secondary);
    result.secondary = secondary;
    result.secondaryText = secondaryText.color;
    result.secondaryTextMeetsContrast = secondaryText.meetsContrast;
  }
  return result;
}

/** Firestore Admin SDK uses gRPC status code 6 (ALREADY_EXISTS) for a
 * failed .create() on an existing doc; this project's hand-rolled test
 * mocks throw a plain Error with this message instead — same check
 * billingService.js's recordPropertyCharge already uses for its own
 * .create() race. */
function isAlreadyExistsError(err) {
  return err?.code === 6 || /already exists/i.test(err?.message || '');
}

/**
 * Creates a new agency brand and links the confirming user's account to
 * it. Does not touch any other user's document.
 *
 * SECURITY: uses Firestore's atomic .create() — which fails rather
 * than overwriting if a document at this ID already exists — not
 * .set(). brandId is derived deterministically from the submitted
 * name (slugify), which is fully attacker-controlled: without this,
 * any agent could "create" a brand using an EXISTING agency's exact
 * name and silently overwrite its real createdBy/logo/colours. A
 * genuine same-name collision (not an attack — e.g. two agents at the
 * same real, brand-new office both submitting at the same instant)
 * is NOT an error under the no-approval model: the loser simply joins
 * the brand the winner just created — see the catch block below.
 */
export async function createBrand({ uid, name, logoUrl, primary, secondary, officeId }) {
  const colors = buildColorSet({ primary, secondary });
  const brandId = slugify(name);
  const brandRef = adminDb.collection(BRANDS_COLLECTION).doc(brandId);
  const linkTarget = officeId
    ? adminDb.collection('offices').doc(officeId)
    : adminDb.collection('users').doc(uid);

  try {
    await brandRef.create({
      name: name.trim(),
      logoUrl: logoUrl || null,
      colors,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      status: 'active',
    });
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      // Someone else's identical submission won the race a moment
      // ago (or this brand already existed for an unrelated reason).
      // No approval, no error surfaced to the agent — just join the
      // brand that's actually there, exactly like any other exact-name
      // match. The loser's own submitted logo/colours are discarded —
      // the brand that won the race is the one of record, byte for
      // byte, same guarantee as before this change.
      await linkTarget.update({ agencyBrandId: brandId });
      const existingBrand = await adminDb.collection(BRANDS_COLLECTION).doc(brandId).get();
      return { brandId, colors: existingBrand.data()?.colors || colors, joinedExisting: true };
    }
    throw err;
  }

  // Only ever reached if THIS call's .create() genuinely just
  // succeeded — on any failure (including the race case above),
  // execution never reaches here, so a failed/colliding creation can
  // never leave a dangling agencyBrandId behind for an account that
  // doesn't actually own a real brand.
  await linkTarget.update({ agencyBrandId: brandId });

  return { brandId, colors };
}

/** Pure (well, one Firestore read) — which agencyBrands doc id (if any)
 * applies to this user right now. An office member's brand ALWAYS
 * comes from their office, never from their own agencyBrandId field
 * (which office members never have set in the first place — see
 * autoEstablishBrandForUser's early office-member skip below); an
 * independent agent's comes from their own field exactly as before
 * office support was added. */
async function resolveBrandIdForUser(userData) {
  if (userData?.officeId) {
    const officeDoc = await adminDb.collection('offices').doc(userData.officeId).get();
    return officeDoc.exists ? (officeDoc.data()?.agencyBrandId || null) : null;
  }
  return userData?.agencyBrandId || null;
}

export async function getBrandForUser(uid) {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  if (!userDoc.exists) return null;
  const brandId = await resolveBrandIdForUser(userDoc.data());
  if (!brandId) return null;
  const brandDoc = await adminDb.collection(BRANDS_COLLECTION).doc(brandId).get();
  if (!brandDoc.exists) return null;
  return { id: brandDoc.id, ...brandDoc.data() };
}

/** Pure — the normalization used for EVERY exact-name comparison in this
 * file: trim, lowercase, and collapse repeated internal whitespace to a
 * single space, so "Ray  White " and "ray white" compare identical, but
 * "Ray White" and "Ray White Brisbane" never do (no substring/fuzzy
 * matching here at all). */
export function normalizeAgencyNameExact(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Finds an existing brand whose name EXACTLY matches the given company
 * name (case/whitespace-normalized only) — never a fuzzy or partial
 * match, never franchise-level grouping ("Ray White Brisbane" and "Ray
 * White Gold Coast" are, and must stay, two different brands). Used
 * both as the dedup check inside autoEstablishBrandForUser (so every
 * agent at the same exact office name ends up sharing one brand) and
 * directly by createBrand's slugify (which collapses the same way, so
 * the two are always consistent).
 */
export async function findBrandByExactName(companyName) {
  const normalized = normalizeAgencyNameExact(companyName);
  if (!normalized) return null;
  const snap = await adminDb.collection(BRANDS_COLLECTION).where('status', '==', 'active').get();
  const match = snap.docs.find((d) => normalizeAgencyNameExact(d.data().name) === normalized);
  return match ? { id: match.id, ...match.data() } : null;
}

/**
 * Automatically establishes OR joins agency branding for an agent,
 * entirely without any click or review. Called lazily (see
 * /api/branding/mine, and the signup flow's own non-blocking call
 * right after account creation) — never a background cron, so it only
 * ever runs in the context of a request from that specific
 * authenticated agent.
 *
 * Safe by construction:
 *   - No-ops entirely if the account already has a brand (never
 *     overwrites/reruns for an already-branded account) — this is also
 *     exactly what makes "Reset to Agency Branding" (clearing the
 *     personal-override fields) safe to call repeatedly: it never
 *     re-triggers this function or re-derives a different brand.
 *   - If an EXACT name match already exists, immediately sets
 *     `agencyBrandId` to it — no approval, no agent action. This is
 *     the entire point of the "shared default" model: a brand-new
 *     agent at an existing office should see correct branding from
 *     their very first page load, with zero setup.
 *   - Only CREATES a new brand (the "first agent establishes it" case)
 *     when colour extraction from their own already-uploaded logoUrl
 *     is confident (`usable: true`) — an unsupervised path should
 *     decline rather than publish a low-confidence guess; the agent
 *     can still do this manually via the dashboard, where they get to
 *     see and adjust it before confirming.
 *   - Reuses createBrand/buildColorSet exactly as the manual flow does,
 *     so contrast is still always recomputed server-side, and the same
 *     race-safe atomic `.create()` + auto-join-on-collision applies.
 */
export async function autoEstablishBrandForUser(uid) {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  if (!userDoc.exists) return { status: 'skipped', reason: 'no-user' };
  const u = userDoc.data();

  // Office members never use exact-name text matching at all — their
  // brand is resolved directly from their office (see
  // resolveBrandIdForUser/getBrandForUser), which is immune to typos
  // and re-resolves live, so there's nothing for this function to
  // establish or join on their behalf, ever.
  if (u.officeId) return { status: 'skipped', reason: 'office-member' };

  if (u.agencyBrandId) return { status: 'skipped', reason: 'already-branded' };
  if (!u.companyName || !u.companyName.trim()) return { status: 'skipped', reason: 'no-company-name' };

  const existing = await findBrandByExactName(u.companyName);
  if (existing) {
    await adminDb.collection('users').doc(uid).update({ agencyBrandId: existing.id });
    return { status: 'joined', brandId: existing.id };
  }

  if (!u.logoUrl) return { status: 'skipped', reason: 'no-logo' };

  let extraction;
  try {
    const res = await fetch(u.logoUrl);
    if (!res.ok) return { status: 'skipped', reason: 'logo-fetch-failed' };
    const buffer = Buffer.from(await res.arrayBuffer());
    extraction = await extractBrandColors(buffer);
  } catch (err) {
    return { status: 'skipped', reason: 'extraction-error' };
  }

  if (!extraction.usable) {
    return { status: 'skipped', reason: 'low-confidence-extraction' };
  }

  const { brandId } = await createBrand({
    uid,
    name: u.companyName,
    logoUrl: u.logoUrl,
    primary: extraction.primary.hex,
    secondary: extraction.secondary ? extraction.secondary.hex : undefined,
  });
  return { status: 'created', brandId };
}

/**
 * Sets an agent's OWN personal logo/colour override — this NEVER writes
 * to the shared agencyBrands doc (whether or not the agent has one
 * linked) and never touches any other agent's data. Resolution order
 * (see brandStyle.js) is: this personal override → the inherited
 * shared brand (if any) → the Premarket default. An agent with no
 * shared brand at all can still use this — a personal override has no
 * dependency on `agencyBrandId` being set.
 *
 * Uses `.update()` with an explicit, minimal field list — never `.set()`
 * — so this can only ever touch `logoUrl`/`brandColors` on the calling
 * agent's own doc, regardless of what else is on it (firstName, roles,
 * billing fields, etc. are never at risk of being silently erased).
 * `colors` is only recomputed (and only overwrites `brandColors`) when
 * a `primary` is actually supplied — passing just a new `logoUrl`
 * leaves any existing colour override untouched, and vice versa, since
 * the two are independently overridable.
 */
export async function setPersonalBrandOverride({ uid, logoUrl, primary, secondary }) {
  const patch = {};
  if (logoUrl !== undefined) patch.logoUrl = logoUrl || null;
  if (primary) patch.brandColors = buildColorSet({ primary, secondary });

  if (Object.keys(patch).length === 0) {
    throw new Error('Nothing to save — provide a logo and/or a primary colour');
  }

  await adminDb.collection('users').doc(uid).update(patch);
  return { uid, ...patch };
}

/**
 * "Reset to Agency Branding" — clears the agent's personal logo/colour
 * override, falling back to whatever the shared brand provides (or the
 * Premarket default, if they have no shared brand at all). Deliberately
 * `.update()` with FieldValue.delete() on exactly these two fields —
 * never touches `agencyBrandId` itself (the shared-brand link stays
 * exactly as it was) or any other field on the user doc.
 */
export async function resetPersonalBrandOverride({ uid }) {
  await adminDb.collection('users').doc(uid).update({
    logoUrl: FieldValue.delete(),
    brandColors: FieldValue.delete(),
  });
  return { uid, reset: true };
}
