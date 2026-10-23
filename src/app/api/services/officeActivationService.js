import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../firebase/adminApp';
import { BASE_URL } from './emailTemplates';
import { OfficeError } from './officeService';

/**
 * Long-lived activation links for brand-new office agents.
 *
 * Firebase password-setup links expire after about an hour and the Admin
 * SDK cannot change that — far too short for a 50-agent rollout where
 * people open their email days later. So the email links to a Premarket
 * URL carrying a random token (valid 14 days). Only when the agent clicks
 * it do we mint a FRESH Firebase link and send them straight to it, so the
 * short Firebase expiry never matters. Password setup itself is still done
 * by Firebase's own secure flow; no password ever passes through here.
 *
 * Only a SHA-256 hash of the token is stored, so the database never holds a
 * usable link. A link works only while the account is still unactivated.
 */
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_USES = 25;
const COLLECTION = 'officeActivations';

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export async function createActivationLink({ uid, email, officeId }) {
  // A newly issued link replaces any earlier one for the same account.
  const old = await adminDb.collection(COLLECTION).where('uid', '==', uid).get();
  await Promise.all(old.docs.map((d) => adminDb.collection(COLLECTION).doc(d.id).update({ revoked: true })));

  const token = crypto.randomBytes(32).toString('base64url');
  await adminDb.collection(COLLECTION).doc(hashToken(token)).set({
    uid,
    email,
    officeId: officeId || null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAtMs: Date.now() + TOKEN_TTL_MS,
    uses: 0,
    revoked: false,
  });
  return `${BASE_URL}/activate?t=${token}`;
}

/**
 * Public (the token is the credential). Returns { url } — a fresh Firebase
 * password-setup link — or { alreadyActive: true }. Throws OfficeError with a
 * safe, generic message otherwise.
 */
export async function redeemActivationToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw new OfficeError('This activation link is not valid', 404);
  }
  const ref = adminDb.collection(COLLECTION).doc(hashToken(token));
  const doc = await ref.get();
  if (!doc.exists) throw new OfficeError('This activation link is not valid', 404);
  const data = doc.data();

  if (data.revoked) throw new OfficeError('This activation link has been replaced by a newer one', 410);
  if (Date.now() > data.expiresAtMs) throw new OfficeError('This activation link has expired', 410);
  if ((data.uses || 0) >= MAX_USES) throw new OfficeError('This activation link has been used too many times', 429);

  const userDoc = await adminDb.collection('users').doc(data.uid).get();
  if (!userDoc.exists) throw new OfficeError('This activation link is not valid', 404);
  const user = userDoc.data();
  if (user.accountStatus === 'active') return { alreadyActive: true };
  if (user.accountStatus !== 'invited') throw new OfficeError('This activation link is not valid', 404);

  // Never mint a link for an account that has been removed/disabled.
  const authUser = await getAuth().getUser(data.uid);
  if (authUser.disabled) throw new OfficeError('This activation link is not valid', 404);

  await ref.update({ uses: (data.uses || 0) + 1, lastUsedAt: FieldValue.serverTimestamp() });
  const url = await getAuth().generatePasswordResetLink(authUser.email, { url: `${BASE_URL}/login?activated=1` });
  return { url };
}
