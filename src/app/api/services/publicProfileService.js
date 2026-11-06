import { isAgent } from '../../utils/roles';
import { overlayProfessionalProfile, pickUnambiguousProfile } from '../../utils/professionalProfile';

/**
 * Server-side replacement for the public pages' direct reads of
 * `users/{uid}`. That collection holds credentials, push tokens, billing
 * ids and contact details, so it is no longer publicly readable (see
 * firestore.rules). Everything a visitor needs to see about an agent comes
 * from here, through an explicit allowlist — a new field added to a user
 * document is private until it is deliberately added to this list.
 */
export const PUBLIC_PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'companyName',
  'avatar',
  'logoUrl',
  'officeId',
  'brandColors',
  'phone',
];

export const MAX_PUBLIC_PROFILE_IDS = 25;

// Only these buyer fields are ever shown to the agent who owns the listing.
const BUYER_PROFILE_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'buyerPreferences'];

const pick = (data, fields) => {
  const out = {};
  for (const f of fields) if (data?.[f] !== undefined) out[f] = data[f];
  return out;
};

export const pickPublicProfile = (data) => pick(data, PUBLIC_PROFILE_FIELDS);

export const parseProfileIds = (raw) => {
  const ids = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{6,128}$/.test(s));
  return [...new Set(ids)].slice(0, MAX_PUBLIC_PROFILE_IDS);
};

/**
 * A user is publicly viewable only if they are an agent or own at least one
 * property. Property owners without an `agent` flag exist in production, so
 * the flag alone is not enough — but a buyer who merely liked a property
 * (their uid is public on the like) must never be resolvable here.
 */
export async function getPublicAgentProfiles(db, ids) {
  const profiles = {};
  await Promise.all(
    ids.map(async (id) => {
      const snap = await db.collection('users').doc(id).get();
      if (!snap.exists) return;
      const data = snap.data();
      let visible = isAgent(data);
      if (!visible) {
        const owned = await db.collection('properties').where('userId', '==', id).limit(1).get();
        visible = !owned.empty;
      }
      if (visible) {
        let profile = pickPublicProfile(data);
        // Office-managed professional profile (canonical when present and unambiguous). A failed lookup
        // simply falls back to the plain users data.
        if (data.officeId) {
          try {
            const q = await db.collection('officeAgents').where('officeId', '==', data.officeId).where('linkedUid', '==', id).get();
            const match = pickUnambiguousProfile(q.docs.map((d) => d.data()), { uid: id, officeId: data.officeId });
            profile = overlayProfessionalProfile(profile, match);
          } catch { /* keep users-based profile */ }
        }
        profiles[id] = profile;
      }
    }),
  );
  return profiles;
}

const normName = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The office-directory profile of the agent ASSIGNED to a listing, for listings whose assignment is a
 * listing-agent roster entry (`agents/{agentId}`, which has a name but no link to a login account).
 *
 * Only an exact, UNIQUE match is used: the listing's assigned name must equal the name of exactly one
 * agent in the owner's own office. Zero or several matches return null (the caller then shows only the
 * assigned name with a placeholder photo) — never the owner's details, never a guess.
 * Returns the same allowlisted public fields as getPublicAgentProfiles (name, photo and phone come from
 * the office directory profile when one is set).
 */
export async function getAssignedAgentProfile(db, propertyId) {
  const propSnap = await db.collection('properties').doc(propertyId).get();
  if (!propSnap.exists) return null;
  const property = propSnap.data();
  const assignedName = normName(property.agentName);
  if (!property.agentId || !assignedName || !property.userId) return null;

  const ownerSnap = await db.collection('users').doc(property.userId).get();
  const officeId = ownerSnap.exists ? ownerSnap.data().officeId : null;
  if (!officeId) return null;

  const people = await db.collection('users').where('officeId', '==', officeId).get();
  const candidates = people.docs.filter((d) => {
    const u = d.data();
    return isAgent(u) && normName(`${u.firstName || ''} ${u.lastName || ''}`) === assignedName;
  });
  if (candidates.length !== 1) return null;

  const profiles = await getPublicAgentProfiles(db, [candidates[0].id]);
  const profile = profiles[candidates[0].id];
  if (!profile) return null;
  return { firstName: profile.firstName || '', lastName: profile.lastName || '', avatar: profile.avatar || null, phone: profile.phone || null };
}

/**
 * Contact + preference fields for the buyers who registered serious interest on
 * one listing. Only users who actually appear on that listing's serious offers
 * are ever returned. Callers MUST have authorised the requester first.
 */
export async function loadBuyerProfiles(db, propertyId) {
  const offers = await db.collection('offers').where('propertyId', '==', propertyId).get();
  const buyerIds = [
    ...new Set(
      offers.docs
        .map((d) => d.data())
        .filter((o) => o.type === 'opinion' && o.serious === true && o.userId)
        .map((o) => o.userId),
    ),
  ];

  const buyers = {};
  await Promise.all(
    buyerIds.map(async (id) => {
      const snap = await db.collection('users').doc(id).get();
      if (snap.exists) buyers[id] = pick(snap.data(), BUYER_PROFILE_FIELDS);
    }),
  );
  return buyers;
}
