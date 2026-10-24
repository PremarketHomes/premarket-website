// The exact placeholder avatar every brand-new agent account is seeded
// with — both join/page.js's own self-signup and officeImportService.js's
// inviteNewAgent use this identical URL, so checking for it (rather than
// just "any avatar") correctly distinguishes "never uploaded one" from
// "uploaded something that happens to look similar."
export const PLACEHOLDER_AVATAR_URL = 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png?20150327203541';

export function isPlaceholderAvatar(avatar) {
  return !avatar || avatar === PLACEHOLDER_AVATAR_URL;
}

/** "Sam Wilson" -> "SW", "sam" -> "S", nothing -> "". */
export function getInitials(firstName, lastName) {
  const letters = [firstName, lastName]
    .map((n) => String(n || '').trim().charAt(0))
    .filter(Boolean)
    .join('');
  return letters.toUpperCase();
}
