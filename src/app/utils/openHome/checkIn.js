import { normalizeE164 } from '../phone';

// Shared by the Open Home concept demo and the live pilot (client and server), so both validate identically.

/** Same email rule as the iPad kiosk's registration form. */
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validates the open-home check-in form. Pure, so the same rules can run on a future server route.
 * Returns { ok, errors: { fullName?, mobile?, email? }, value: { fullName, mobile, email } } where `mobile` is E.164
 * (Australian mobiles typed as 04xx xxx xxx are accepted, as everywhere else in Premarket).
 */
export function validateCheckIn({ fullName = '', mobile = '', email = '' } = {}) {
  const errors = {};
  const name = String(fullName).replace(/\s+/g, ' ').trim();
  const letters = (name.match(/\p{L}/gu) || []).length;
  if (!name) errors.fullName = 'Please enter your name.';
  else if (letters < 2 || name.length > 80) errors.fullName = 'Please enter your full name.';

  const mobileE164 = normalizeE164(mobile);
  if (!String(mobile).trim()) errors.mobile = 'Please enter your mobile number.';
  else if (!mobileE164) errors.mobile = 'That number doesn’t look right. Try 0412 345 678.';

  const mail = String(email).trim().toLowerCase();
  if (!mail) errors.email = 'Please enter your email address.';
  else if (!EMAIL_OK.test(mail) || mail.length > 120) errors.email = 'That email doesn’t look right.';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { fullName: name, mobile: mobileE164, email: mail },
  };
}

export const firstNameOf = (fullName) => String(fullName || '').trim().split(/\s+/)[0] || '';
