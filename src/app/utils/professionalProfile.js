/**
 * Overlays an office-managed professional profile (`officeAgents`) onto a public profile built from
 * the login-linked `users` document. Pure, no Firebase imports.
 *
 * Rules (so Hannah edits once and every display agrees):
 *  - Only fields the office has explicitly set override: fullName, phone, photoUrl.
 *  - `contactEmail` is deliberately NOT part of any public profile and is never used for login or for
 *    sensitive notifications; it exists for professional contact display inside the office workspace.
 *  - A held office-submitted phone (officeAgentContacts) is never a profile value, so it is never public.
 *  - Billing, invoices and listing-agent profiles (`agents`) do not use this and are untouched.
 */
export function overlayProfessionalProfile(publicProfile, officeProfile) {
  if (!officeProfile) return publicProfile;
  const out = { ...publicProfile };
  const name = typeof officeProfile.fullName === 'string' ? officeProfile.fullName.trim() : '';
  if (name) {
    const [first, ...rest] = name.split(/\s+/);
    out.firstName = first;
    out.lastName = rest.join(' ');
  }
  if (typeof officeProfile.phone === 'string' && officeProfile.phone.trim()) out.phone = officeProfile.phone.trim();
  if (typeof officeProfile.photoUrl === 'string' && officeProfile.photoUrl.trim()) out.avatar = officeProfile.photoUrl.trim();
  return out;
}

/**
 * Picks the ONE unambiguous profile for a user: it must belong to the user's current office and be
 * linked to that exact uid. Zero or several candidates → null (the plain users data is shown).
 */
export function pickUnambiguousProfile(candidates, { uid, officeId }) {
  const matches = (candidates || []).filter((p) => p && p.officeId === officeId && p.linkedUid === uid);
  return matches.length === 1 ? matches[0] : null;
}
