/**
 * Path (no host) to one buyer registration inside the agent's property report.
 *
 * Both ids are opaque Firestore document ids — no buyer details are placed in
 * the link, so it is safe to email. Opening it still requires the agent to be
 * signed in, and the report only loads for the listing agent, a superAdmin or
 * an administrator of the agent's current office (read-only).
 */
export function buildRegistrationPath(propertyId, offerId) {
  const base = `/dashboard/property/${encodeURIComponent(propertyId)}`;
  return offerId ? `${base}?registration=${encodeURIComponent(offerId)}` : base;
}
