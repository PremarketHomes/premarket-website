/**
 * Agency Branding — brand profile storage.
 *
 * agencyBrands/{brandId} is public-read (the public property page needs
 * it without requiring the buyer to log in), server-write-only (see
 * firestore.rules). Contains no secrets — only a logo URL and colour hex
 * values. This is deliberately a completely separate collection from
 * `integrationCredentials` (Rex/Agentbox secrets) — branding data and
 * third-party credentials must never live in the same place.
 *
 * One brand can be shared by many agents: `users/{uid}.agencyBrandId`
 * points at a brand here, and that link is itself protected in
 * firestore.rules so only the server (via confirmBranding below) can
 * set it — never the client directly.
 */

import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { pickTextColor } from './brandColorExtractor';

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

/**
 * Creates a new agency brand and links the confirming user's account to
 * it. Does not touch any other user's document — inheriting the brand
 * (a second Harcourts agent joining the same office) is a deliberate,
 * separate, explicit action, not automatic.
 */
export async function createBrand({ uid, name, logoUrl, primary, secondary }) {
  const colors = buildColorSet({ primary, secondary });
  const brandId = slugify(name);
  const brandRef = adminDb.collection(BRANDS_COLLECTION).doc(brandId);

  await brandRef.set({
    name: name.trim(),
    logoUrl: logoUrl || null,
    colors,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    status: 'active',
  });

  await adminDb.collection('users').doc(uid).update({ agencyBrandId: brandId });

  return { brandId, colors };
}

/** Links an existing agency brand to an additional agent's account
 * (the "join Harcourts Property Hub" path for a second agent at the
 * same office) — never created implicitly, always an explicit action.
 *
 * Authorization: the joining agent's own `companyName` must exactly
 * match the brand's name (same exact-match rule used to suggest it in
 * the first place — see findBrandByExactName). Without this check any
 * authenticated agent could pass an arbitrary/guessed brandId and have
 * a competing agency's logo/colours applied to their own listings,
 * which is exactly what the client-write protection on
 * users/{uid}.agencyBrandId in firestore.rules is meant to prevent —
 * the check has to live here since that rule only protects the field,
 * not who the server links it to. */
export async function linkExistingBrand({ uid, brandId }) {
  const brandDoc = await adminDb.collection(BRANDS_COLLECTION).doc(brandId).get();
  if (!brandDoc.exists) {
    throw new Error('Brand not found');
  }

  const userDoc = await adminDb.collection('users').doc(uid).get();
  const companyName = userDoc.exists ? userDoc.data()?.companyName : null;
  const brandName = brandDoc.data()?.name;
  const normalizedMatch = String(companyName || '').trim().toLowerCase() === String(brandName || '').trim().toLowerCase();
  if (!companyName || !normalizedMatch) {
    throw new Error('You can only join an agency brand that matches your own company name');
  }

  await adminDb.collection('users').doc(uid).update({ agencyBrandId: brandId });
  return { brandId };
}

export async function getBrandForUser(uid) {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  const brandId = userDoc.exists ? userDoc.data()?.agencyBrandId : null;
  if (!brandId) return null;
  const brandDoc = await adminDb.collection(BRANDS_COLLECTION).doc(brandId).get();
  if (!brandDoc.exists) return null;
  return { id: brandDoc.id, ...brandDoc.data() };
}

/**
 * Suggests existing brands whose name closely matches the given company
 * name — an exact (case/whitespace-normalized) match only, never a fuzzy
 * one, per the "do not silently assign on a weak match" requirement.
 * Always just a suggestion for the UI to offer with an explicit confirm
 * step — never applied automatically.
 */
export async function findBrandByExactName(companyName) {
  const normalized = String(companyName || '').trim().toLowerCase();
  if (!normalized) return null;
  const snap = await adminDb.collection(BRANDS_COLLECTION).where('status', '==', 'active').get();
  const match = snap.docs.find((d) => (d.data().name || '').trim().toLowerCase() === normalized);
  return match ? { id: match.id, ...match.data() } : null;
}
