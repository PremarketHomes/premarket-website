import { adminDb } from '../../firebase/adminApp';
import { OfficeError, requireOfficeAdmin } from './officeService';

const MAX_PROPERTIES = 200;

/**
 * Display status for a property, mirroring the dashboard's own badges:
 * sold > archived > live (visible) > hidden.
 */
export function propertyStatus(p) {
  if (p.archivedReason === 'sold') return 'sold';
  if (p.archived === true) return 'archived';
  if (p.visibility === true) return 'live';
  return 'hidden';
}

const toIso = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : null);

/** Read-only, deliberately minimal LIST row for an office admin: no offers,
 * buyer/contact data, phone numbers, billing or agent contact details. The full
 * report (opinions, buyer interest) is opened separately through the
 * authorised, read-only property report (propertyAccessService.js). */
export function toOfficeTeamProperty(id, p) {
  return {
    id,
    address: p.formattedAddress || p.address || null,
    status: propertyStatus(p),
    listingStatus: p.listingStatus === 'on-market' ? 'on-market' : 'pre-market',
    price: p.price ?? null,
    soldPrice: p.soldPrice ?? null,
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    carSpaces: p.carSpaces ?? null,
    views: p.stats?.views || 0,
    thumbnail: Array.isArray(p.imageUrls) && p.imageUrls.length ? p.imageUrls[0] : null,
    createdAt: toIso(p.createdAt),
  };
}

/**
 * The properties (campaigns) of ONE agent, for an office administrator.
 *
 * Security: requires the caller to administer `officeId`, AND the target
 * must currently be a linked member of that SAME office (users.officeId).
 * Pending invitees are not linked, so they have no visible properties, and
 * an admin can never read another office's agents by guessing a uid.
 */
export async function listAgentPropertiesForOffice({ officeId, targetUid, actorUid }) {
  await requireOfficeAdmin({ officeId, uid: actorUid });

  const targetDoc = await adminDb.collection('users').doc(targetUid).get();
  if (!targetDoc.exists || targetDoc.data()?.officeId !== officeId) {
    throw new OfficeError('That agent is not a member of your office', 404);
  }

  const snap = await adminDb.collection('properties').where('userId', '==', targetUid).get();
  const properties = snap.docs
    .map((d) => toOfficeTeamProperty(d.id, d.data()))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, MAX_PROPERTIES);

  const counts = properties.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
  return { properties, counts, total: properties.length };
}
