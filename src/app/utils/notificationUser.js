/**
 * The only user fields ever copied into a `notifications` document. Full user
 * documents used to be embedded there, which duplicated credentials, push
 * tokens and billing ids into every notification.
 */
export const NOTIFICATION_USER_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'companyName',
  'avatar',
  'logoUrl',
];

export const pickNotificationUser = (data, uid) => {
  const out = uid ? { uid } : {};
  for (const f of NOTIFICATION_USER_FIELDS) if (data?.[f] !== undefined) out[f] = data[f];
  return out;
};
