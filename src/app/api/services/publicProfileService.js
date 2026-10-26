import { isAgent } from '../../utils/roles';

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
      if (visible) profiles[id] = pickPublicProfile(data);
    }),
  );
  return profiles;
}

/**
 * Contact + preference details for the buyers who registered serious interest
 * on one listing. Only the listing's own agent (or a superAdmin) may ask, and
 * only for users who actually appear on that listing's serious offers.
 */
export async function getBuyerProfilesForProperty(db, { uid, propertyId }) {
  const propertySnap = await db.collection('properties').doc(propertyId).get();
  if (!propertySnap.exists) return { status: 404, error: 'Property not found' };

  const requester = await db.collection('users').doc(uid).get();
  const isSuperAdmin = requester.exists && requester.data().superAdmin === true;
  if (propertySnap.data().userId !== uid && !isSuperAdmin) {
    return { status: 403, error: 'Forbidden' };
  }

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
  return { status: 200, buyers };
}
