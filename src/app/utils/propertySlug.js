// Clean property-URL slug helpers.
//
// Design goal: a human-readable, address-led URL (e.g.
// premarket.homes/59-nautilus-way-af3ollnyi121trucbbwb) that resolves to
// exactly one property, with NO new Firestore field, NO backfill/migration
// of existing properties, and NO change to the existing
// /find-property?propertyId=... route (which keeps working unchanged
// forever — this is purely an additional, additive way to reach the same
// page).
//
// How resolution works: the slug is always the address slug followed by
// the property's own Firestore document ID. Firebase/Firestore
// auto-generated document IDs are fixed at 20 characters and drawn from
// an alphabet that includes both '-' and '_', so the ID itself cannot be
// safely recovered by splitting on a delimiter — instead we always take
// the LAST 20 characters of the full slug as the document ID. This works
// regardless of how many hyphens are in the address portion, and doesn't
// require validating or even correctly guessing the address part at all:
// the ID suffix alone determines which property is served. The address
// prefix is purely cosmetic — exactly as much (or as little) "prettiness"
// as this adds, it adds zero additional discoverability, since a visitor
// still needs the exact 20-character ID to reach a property, identical to
// today's ?propertyId= requirement.
const FIRESTORE_ID_LENGTH = 20;

export function slugifyAddress(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60); // keep URLs a sane length
}

// Builds the clean slug for a property. Prefers a full street address,
// falls back to suburb-only (respecting showSuburbOnly the same way the
// property page itself does), then falls back to the bare ID if no
// address text is available at all.
export function buildPropertySlug(property, propertyId) {
  const addressSource =
    (!property?.showSuburbOnly && (property?.formattedAddress || property?.address)) ||
    property?.location?.suburb ||
    '';
  const addressPart = slugifyAddress(addressSource);
  return addressPart ? `${addressPart}-${propertyId}` : propertyId;
}

// Recovers the property ID from an incoming clean-URL slug. Returns null
// if the slug is too short to plausibly contain a real Firestore ID —
// callers should treat that as "not a property URL" (404), never as an
// error.
export function extractPropertyIdFromSlug(slug) {
  if (!slug || typeof slug !== 'string' || slug.length < FIRESTORE_ID_LENGTH) return null;
  return slug.slice(-FIRESTORE_ID_LENGTH);
}
