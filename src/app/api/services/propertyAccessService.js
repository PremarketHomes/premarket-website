import { loadBuyerProfiles } from './publicProfileService';
import { areActiveTeamPeers } from './teamAccess';
import { redactOffersForTeam, redactLikesForTeam, redactPropertyForTeam } from './teamRedaction';

/**
 * Who may view a property's private report (opinions, buyer contact details,
 * engagement). One shared check, used by every route that exposes that data
 * so the rules can't drift apart:
 *
 *   'owner'       the listing agent (property.userId)
 *   'superAdmin'  a platform administrator
 *   'officeAdmin' an administrator of the office the listing agent CURRENTLY
 *                 belongs to. READ-ONLY: this level never authorises a write.
 *   'teamMember'  a colleague in the SAME team of the SAME active office as the
 *                 listing agent. READ-ONLY and REDACTED: the report data built
 *                 for this level (see teamRedaction.js) contains no buyer
 *                 identity or contact details and no raw offer documents, and
 *                 buyer-profiles is refused outright. Re-evaluated live from
 *                 `users.teamId`/`officeId` + the team doc, so leaving or being
 *                 removed (or either leaving the office) ends it immediately.
 *   null          anyone else
 *
 * The office link is evaluated live from `users.officeId` — never from when
 * the listing was created — so listings an agent made before joining are
 * covered, and access ends the moment the agent leaves the office. A pending
 * invitee has no `officeId` yet, so nothing is exposed. Admin status comes
 * from the server-only `officeAdminInfo.officeAdminUids` (same source as
 * requireOfficeAdmin) and must belong to the SAME office, which must be active.
 */
export async function getPropertyReportAccess(db, { uid, property }) {
  if (!uid || !property?.userId) return null;
  if (property.userId === uid) return 'owner';

  const requester = await db.collection('users').doc(uid).get();
  if (requester.exists && requester.data().superAdmin === true) return 'superAdmin';

  const owner = await db.collection('users').doc(property.userId).get();
  const officeId = owner.exists ? owner.data().officeId : null;
  if (!officeId) return null;

  const officeAdminInfo = await db.collection('officeAdminInfo').doc(officeId).get();
  if (!officeAdminInfo.exists) return null;
  const office = officeAdminInfo.data();
  if (office.status !== 'active') return null;
  if (Array.isArray(office.officeAdminUids) && office.officeAdminUids.includes(uid)) return 'officeAdmin';

  // Office admin outranks team (it stays the fuller, existing read-only level);
  // a team peer is the last, narrowest level.
  const peers = await areActiveTeamPeers(db, {
    requesterUid: uid,
    requester: requester.exists ? requester.data() : null,
    ownerUid: property.userId,
    owner: owner.data(),
  });
  return peers ? 'teamMember' : null;
}

/** Owner / superAdmin only — for anything that acts on a property (e.g. emailing a report). */
export const canManageProperty = (access) => access === 'owner' || access === 'superAdmin';

// Firestore Timestamps -> ISO strings, so the JSON the report page receives is
// understood by its existing date handling (formatDate / new Date(...)).
export function serializeForClient(value) {
  if (value == null) return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeForClient);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeForClient(v)]));
  }
  return value;
}

/**
 * Everything the report page reads for a listing the caller does not own:
 * property, offers, likes and the buyers' contact details. Returns
 * { status, error } when the caller is not entitled to it.
 */
export async function getPropertyReportData(db, { uid, propertyId }) {
  const propertySnap = await db.collection('properties').doc(propertyId).get();
  if (!propertySnap.exists) return { status: 404, error: 'Property not found' };

  const property = propertySnap.data();
  const access = await getPropertyReportAccess(db, { uid, property });
  if (!access) return { status: 403, error: 'Forbidden' };

  if (access === 'teamMember') return getRedactedTeamReport(db, { propertyId, property, access });

  const [offers, likes, buyers] = await Promise.all([
    db.collection('offers').where('propertyId', '==', propertyId).get(),
    db.collection('likes').where('propertyId', '==', propertyId).get(),
    loadBuyerProfiles(db, propertyId),
  ]);

  return {
    status: 200,
    access,
    readOnly: access === 'officeAdmin',
    property: serializeForClient({ id: propertyId, ...property }),
    offers: offers.docs.map((d) => serializeForClient({ id: d.id, ...d.data() })),
    likes: likes.docs.map((d) => serializeForClient({ id: d.id, ...d.data() })),
    buyers,
  };
}

/**
 * Team-level report: same shape the report page already consumes, rebuilt from
 * allowlists. No raw offer/like documents, no buyer identity, no `buyers` map.
 */
async function getRedactedTeamReport(db, { propertyId, property, access }) {
  const [offers, likes] = await Promise.all([
    db.collection('offers').where('propertyId', '==', propertyId).get(),
    db.collection('likes').where('propertyId', '==', propertyId).get(),
  ]);
  return {
    status: 200,
    access,
    readOnly: true,
    redacted: true,
    property: serializeForClient({ id: propertyId, ...redactPropertyForTeam(property) }),
    offers: redactOffersForTeam(offers.docs.map((d) => d.data()), serializeForClient),
    likes: redactLikesForTeam(likes.docs.map((d) => d.data()), serializeForClient),
    buyers: {},
  };
}

/**
 * Buyer details for one listing, for anyone entitled to its report
 * (owner, superAdmin, or an administrator of the agent's current office).
 */
export async function getBuyerProfilesForProperty(db, { uid, propertyId }) {
  const propertySnap = await db.collection('properties').doc(propertyId).get();
  if (!propertySnap.exists) return { status: 404, error: 'Property not found' };

  const access = await getPropertyReportAccess(db, { uid, property: propertySnap.data() });
  if (!access) return { status: 403, error: 'Forbidden' };
  // Buyer identity and contact details are never available at team level.
  if (access === 'teamMember') return { status: 403, error: 'Forbidden' };

  return { status: 200, buyers: await loadBuyerProfiles(db, propertyId) };
}
