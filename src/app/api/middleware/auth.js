import { getAuth } from 'firebase-admin/auth';
import { adminDb } from '../../firebase/adminApp';
import { isBlockedPreviewWrite, PREVIEW_READ_ONLY_MESSAGE } from '../services/environmentGuard';

/**
 * Verify Firebase ID token from Authorization header.
 * Returns { authenticated: true, uid, email } or { authenticated: false, error, status }.
 */
export async function verifyAuth(request) {
  // A preview deployment that points at the LIVE backend must not change live data through the workspace routes.
  try {
    if (isBlockedPreviewWrite({ method: request.method, pathname: new URL(request.url).pathname })) {
      return { authenticated: false, error: PREVIEW_READ_ONLY_MESSAGE, status: 403 };
    }
  } catch { /* an unparseable URL falls through to the normal checks */ }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Missing or invalid Authorization header', status: 401 };
  }

  const token = authHeader.slice(7);
  if (!token) {
    return { authenticated: false, error: 'Missing token', status: 401 };
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    return { authenticated: true, uid: decoded.uid, email: decoded.email || null };
  } catch (err) {
    const message = err.code === 'auth/id-token-expired'
      ? 'Token expired'
      : 'Invalid token';
    return { authenticated: false, error: message, status: 401 };
  }
}

/**
 * Verify the request is from a superAdmin.
 * Returns { authenticated: true, uid, email } or { authenticated: false, error, status }.
 */
export async function verifyAdmin(request) {
  const auth = await verifyAuth(request);
  if (!auth.authenticated) return auth;

  const doc = await adminDb.collection('users').doc(auth.uid).get();
  if (!doc.exists || doc.data().superAdmin !== true) {
    return { authenticated: false, error: 'Forbidden', status: 403 };
  }

  return auth;
}

/**
 * Verify cron secret from Authorization header.
 * Returns { authenticated: true } or { authenticated: false, error, status }.
 */
export function verifyCron(request) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return { authenticated: false, error: 'Unauthorized', status: 401 };
  }

  return { authenticated: true };
}
