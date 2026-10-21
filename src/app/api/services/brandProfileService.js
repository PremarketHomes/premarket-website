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
 * it. Does not touch any other user's document — inheriting the brand
 * (a second Harcourts agent joining the same office) is a deliberate,
 * separate, explicit action, not automatic.
 *
 * SECURITY: uses Firestore's atomic .create() — which fails rather
 * than overwriting if a document at this ID already exists — not
 * .set(). brandId is derived deterministically from the submitted
 * name (slugify), which is fully attacker-controlled: without this,
 * any agent could "create" a brand using an EXISTING agency's exact
 * name and silently overwrite its real createdBy/logo/colours,
 * instantly becoming that agency's trusted root of verification
 * (isVerifiedAgencyMember trusts a brand's createdBy unconditionally)
 * with zero admin review — a complete bypass of the whole membership
 * model, not just a cosmetic takeover. A genuine same-name collision
 * (not an attack — e.g. two unrelated real agencies that happen to
 * share a name) must go through the explicit join/request flow
 * instead (requestAgencyMembership), exactly like any other agent
 * joining an existing brand.
 */
export async function createBrand({ uid, name, logoUrl, primary, secondary }) {
  const colors = buildColorSet({ primary, secondary });
  const brandId = slugify(name);
  const brandRef = adminDb.collection(BRANDS_COLLECTION).doc(brandId);

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
      throw new Error(`An agency named "${name.trim()}" already exists. Request to join it instead of creating a new one.`);
    }
    throw err;
  }

  // Only ever reached if THIS call's .create() genuinely just
  // succeeded — on any failure (including the collision case above),
  // execution never reaches here, so a failed/colliding creation can
  // never leave a dangling agencyBrandId or a verified membership
  // behind for an account that doesn't actually own a real brand.
  await adminDb.collection('users').doc(uid).update({ agencyBrandId: brandId });

  // The creator is the root of trust for a brand they just made —
  // verified immediately, no admin action needed. Every OTHER agent
  // who later sets this same agencyBrandId (see requestAgencyMembership
  // below) starts at 'pending' instead.
  await adminDb.collection('agencyMemberships').doc(uid).set({
    uid,
    agencyBrandId: brandId,
    status: 'verified',
    verifiedBy: 'self:creator',
    verifiedAt: FieldValue.serverTimestamp(),
    requestedAt: FieldValue.serverTimestamp(),
  });

  return { brandId, colors };
}

/**
 * Links an existing agency brand to an additional agent's account for
 * DISPLAY purposes immediately (their own campaigns pick up the
 * agency's logo/colours right away — preserves the existing branding
 * UX, see dashboard/branding/page.js's "Apply Branding" button), and
 * simultaneously files a membership request that starts at 'pending'.
 *
 * This is deliberately NOT the same as being trusted for BILLING.
 * Historically this function immediately made the joining agent's
 * billing consolidate with the brand's, authorised by nothing more
 * than their own companyName matching the brand's name — exactly the
 * unverified signal that let an unrelated agent influence another
 * agency's billing contact just by typing its name. Billing/charges/
 * Xero now only ever trust a VERIFIED agencyMemberships record (see
 * isVerifiedAgencyMember in billingService.js's resolveAgencyBrand) —
 * a superAdmin must explicitly approve this request before that
 * happens (see approveAgencyMembership below).
 *
 * The companyName match check is kept as a sanity/spam guard only —
 * it no longer grants any trust by itself, just avoids a flood of
 * obviously-unrelated join requests landing in the admin queue.
 */
export async function requestAgencyMembership({ uid, brandId }) {
  const brandDoc = await adminDb.collection(BRANDS_COLLECTION).doc(brandId).get();
  if (!brandDoc.exists) {
    throw new Error('Brand not found');
  }

  // The brand's own creator "requesting" membership in their own brand
  // is a no-op — they're already verified, and don't need to pass the
  // companyName sanity check below (createBrand never requires their
  // companyName to equal the brand name they chose to create).
  if (brandDoc.data()?.createdBy === uid) {
    await adminDb.collection('users').doc(uid).update({ agencyBrandId: brandId });
    return { brandId, membershipStatus: 'verified' };
  }

  const userDoc = await adminDb.collection('users').doc(uid).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const companyName = userData?.companyName;
  const brandName = brandDoc.data()?.name;
  const normalizedMatch = String(companyName || '').trim().toLowerCase() === String(brandName || '').trim().toLowerCase();
  if (!companyName || !normalizedMatch) {
    throw new Error('You can only request to join an agency brand that matches your own company name');
  }

  await adminDb.collection('users').doc(uid).update({ agencyBrandId: brandId });

  const membershipRef = adminDb.collection('agencyMemberships').doc(uid);
  const existing = await membershipRef.get();
  if (existing.exists && existing.data().status === 'verified' && existing.data().agencyBrandId === brandId) {
    // Already verified for this exact brand (e.g. re-clicking an old
    // suggestion) — nothing to change.
    return { brandId, membershipStatus: 'verified' };
  }

  await membershipRef.set({
    uid,
    agencyBrandId: brandId,
    requestedCompanyName: companyName,
    status: 'pending',
    requestedAt: FieldValue.serverTimestamp(),
    source: 'request',
  });

  return { brandId, membershipStatus: 'pending' };
}

/**
 * The one and only way agencyMemberships.status ever becomes
 * 'verified' for a non-creator. Admin-only (enforced by the caller
 * route, verifyAdmin). Idempotent on the status field itself, but not
 * wrapped in a transaction — a double-click here just writes the same
 * verified state twice, which is harmless, unlike billing-contact
 * approval where a race could pick a stale value.
 */
export async function approveAgencyMembership({ uid, adminUid }) {
  const ref = adminDb.collection('agencyMemberships').doc(uid);
  const snap = await ref.get();

  // A "legacy" entry (agencyBrandId set on the user doc before this
  // system existed) has no agencyMemberships doc yet at all — this is
  // the first one ever written for them, created here at the moment
  // an admin explicitly reviews and approves it, never automatically.
  let agencyBrandId = snap.exists ? snap.data().agencyBrandId : null;
  if (!agencyBrandId) {
    const userDoc = await adminDb.collection('users').doc(uid).get();
    agencyBrandId = userDoc.exists ? userDoc.data()?.agencyBrandId : null;
  }
  if (!agencyBrandId) {
    throw new Error('No membership request or existing agency link found for this account');
  }

  await ref.set({
    uid,
    agencyBrandId,
    status: 'verified',
    verifiedBy: adminUid,
    verifiedAt: FieldValue.serverTimestamp(),
    requestedAt: snap.exists ? snap.data().requestedAt || null : null,
  });
  return { uid, agencyBrandId, status: 'verified' };
}

/**
 * Declines a membership request/legacy link. Also clears the user's
 * own agencyBrandId — if they're confirmed NOT a member, they should
 * not keep displaying that agency's branding either. This never
 * touches any already-recorded charge or billing record; an agent who
 * had been incorrectly treated as part of the agency before this
 * system existed keeps their past charges exactly as they were (see
 * resolvePinnedCompanyNameEntity) — only their FUTURE resolution
 * changes, by virtue of agencyBrandId now being unset.
 */
export async function rejectAgencyMembership({ uid, adminUid, reason }) {
  const ref = adminDb.collection('agencyMemberships').doc(uid);
  const snap = await ref.get();
  const prior = snap.exists ? snap.data() : {};

  // Same "legacy" case as approveAgencyMembership — fall back to the
  // user doc's current agencyBrandId when no membership record exists
  // yet, purely so the rejected record shows what they're being
  // rejected FROM.
  let agencyBrandId = prior.agencyBrandId || null;
  if (!agencyBrandId) {
    const userDoc = await adminDb.collection('users').doc(uid).get();
    agencyBrandId = userDoc.exists ? userDoc.data()?.agencyBrandId : null;
  }

  await ref.set({
    uid,
    agencyBrandId,
    status: 'rejected',
    rejectedBy: adminUid,
    rejectedAt: FieldValue.serverTimestamp(),
    rejectionReason: reason || '',
    previousRequestedAt: prior.requestedAt || null,
  });

  await adminDb.collection('users').doc(uid).update({ agencyBrandId: null });

  return { uid, status: 'rejected' };
}

/**
 * The single trust decision every billing-affecting use of
 * agencyBrandId goes through (see billingService.js's
 * resolveAgencyBrand). True only for:
 *   - the brand's own createdBy (no separate record needed, including
 *     for brands that existed before this membership system shipped —
 *     they are, by definition, the account that established this
 *     brand in the first place), or
 *   - an agencyMemberships/{agentUserId} doc with status 'verified'
 *     AND agencyBrandId matching the one being checked (matching the
 *     brand matters so a stale verified record for a brand the agent
 *     has since switched away from can never apply to the new one).
 * Everything else — including an agent who simply has agencyBrandId
 * set on their own profile, with no membership record at all — is
 * unverified. That covers every account that predates this system:
 * they are deliberately NOT grandfathered in automatically (see the
 * migration plan), surfaced instead in listPendingAgencyMemberships
 * below for an admin to explicitly review.
 */
export async function isVerifiedAgencyMember(agentUserId, agencyBrandId, brandData) {
  if (!agentUserId || !agencyBrandId) return false;

  if (brandData === undefined) {
    const brandDoc = await adminDb.collection(BRANDS_COLLECTION).doc(agencyBrandId).get();
    brandData = brandDoc.exists ? brandDoc.data() : null;
  }
  if (brandData?.createdBy === agentUserId) return true;

  const membershipDoc = await adminDb.collection('agencyMemberships').doc(agentUserId).get();
  if (!membershipDoc.exists) return false;
  const m = membershipDoc.data();
  return m.status === 'verified' && m.agencyBrandId === agencyBrandId;
}

/**
 * Admin-dashboard listing — every account needing a membership
 * decision, from two sources:
 *   - explicit requests (agencyMemberships.status === 'pending'),
 *   - "legacy" accounts: agencyBrandId is set, they are NOT the
 *     brand's creator, and no agencyMemberships record exists for
 *     them at all (i.e. every account that was linked before this
 *     system shipped — see requirement to never auto-migrate these).
 * Legacy entries are synthesized read-only here, from the existing
 * users/agencyBrands collections — nothing is written until an admin
 * explicitly approves or rejects one (which is the first time a real
 * agencyMemberships doc gets created for that uid).
 */
export async function listPendingAgencyMemberships() {
  const [pendingSnap, usersSnap, brandsSnap] = await Promise.all([
    adminDb.collection('agencyMemberships').where('status', '==', 'pending').get(),
    adminDb.collection('users').where('agencyBrandId', '!=', null).get(),
    adminDb.collection(BRANDS_COLLECTION).get(),
  ]);

  const brandsById = new Map(brandsSnap.docs.map((d) => [d.id, d.data()]));
  const alreadyTracked = new Set(); // uids with ANY agencyMemberships doc, pending or otherwise
  const membershipsSnap = await adminDb.collection('agencyMemberships').get();
  membershipsSnap.docs.forEach((d) => alreadyTracked.add(d.id));

  const requests = pendingSnap.docs.map((d) => {
    const data = d.data();
    return {
      uid: d.id,
      agencyBrandId: data.agencyBrandId,
      agencyBrandName: brandsById.get(data.agencyBrandId)?.name || data.agencyBrandId,
      requestedCompanyName: data.requestedCompanyName || null,
      requestedAt: data.requestedAt || null,
      source: 'request',
    };
  });

  const legacy = usersSnap.docs
    .filter((d) => {
      const u = d.data();
      if (!u.agencyBrandId) return false;
      if (brandsById.get(u.agencyBrandId)?.createdBy === d.id) return false; // the creator, always verified
      return !alreadyTracked.has(d.id); // no membership record at all yet
    })
    .map((d) => {
      const u = d.data();
      return {
        uid: d.id,
        agencyBrandId: u.agencyBrandId,
        agencyBrandName: brandsById.get(u.agencyBrandId)?.name || u.agencyBrandId,
        requestedCompanyName: u.companyName || null,
        requestedAt: null, // predates this system — no request timestamp exists
        source: 'legacy',
      };
    });

  return [...requests, ...legacy];
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
 * Finds an existing brand whose name closely matches the given company
 * name — an exact (case/whitespace-normalized) match only, never a fuzzy
 * one, per the "do not silently assign on a weak match" requirement.
 * Used two ways: as a suggestion for the dashboard UI to offer with an
 * explicit confirm step, and as the dedup check inside
 * autoEstablishBrandForUser below (so two agents at the same company
 * always end up sharing one brand instead of each getting their own).
 */
export async function findBrandByExactName(companyName) {
  const normalized = String(companyName || '').trim().toLowerCase();
  if (!normalized) return null;
  const snap = await adminDb.collection(BRANDS_COLLECTION).where('status', '==', 'active').get();
  const match = snap.docs.find((d) => (d.data().name || '').trim().toLowerCase() === normalized);
  return match ? { id: match.id, ...match.data() } : null;
}

/**
 * Automatically establishes (or reuses) agency branding for an existing
 * agent who already has a `logoUrl` on their profile, without requiring
 * them to visit the branding dashboard first. Called lazily (see
 * /api/branding/mine and the dashboard's own mount effect) — never a
 * background cron, so it only ever runs in the context of a request from
 * that specific authenticated agent.
 *
 * Safe by construction:
 *   - No-ops entirely if the account already has a brand (never
 *     overwrites/reruns for an already-branded account).
 *   - No-ops if there's no logoUrl or no companyName — falls through to
 *     the existing default Premarket branding, exactly as today.
 *   - Does NOT auto-join an existing brand that matches by companyName
 *     any more — that used to happen here silently (no agent action at
 *     all), which was exactly the unverified-by-companyName-alone path
 *     that let an unrelated agent get folded into another agency's
 *     billing identity just by having the same company name on file.
 *     When an existing match is found, this now simply declines to act
 *     (status 'existing-match-found') and leaves it to the agent to
 *     explicitly request to join (see requestAgencyMembership) — the
 *     dashboard's own suggestion flow (findBrandByExactName, offered
 *     with an explicit "Apply Branding" choice) already surfaces this
 *     exact case without this function's help.
 *   - Only creates a new brand when colour extraction is confident
 *     (`usable: true`) — an unsupervised path should decline rather than
 *     publish a low-confidence guess; the agent can still do this
 *     manually via the dashboard, where they get to see and adjust it
 *     before confirming. Creating a brand NO ONE ELSE has yet carries no
 *     identity risk — there's nothing to be verified against.
 *   - Reuses createBrand/buildColorSet exactly as the manual flow does,
 *     so contrast is still always recomputed server-side.
 */
export async function autoEstablishBrandForUser(uid) {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  if (!userDoc.exists) return { status: 'skipped', reason: 'no-user' };
  const u = userDoc.data();

  if (u.agencyBrandId) return { status: 'skipped', reason: 'already-branded' };
  if (!u.companyName || !u.companyName.trim()) return { status: 'skipped', reason: 'no-company-name' };

  const existing = await findBrandByExactName(u.companyName);
  if (existing) {
    return { status: 'existing-match-found', brandId: existing.id };
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
