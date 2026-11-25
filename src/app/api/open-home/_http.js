import { NextResponse } from 'next/server';
import { verifyAuth } from '../middleware/auth';
import { OpenHomeError } from '../services/openHomePilot';

// Shared plumbing for the Open Home pilot routes (see api/services/openHomePilot.js).
export { adminDb } from '../../firebase/adminApp';

export const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

/** Known errors become their message and status. Anything else is logged by NAME only (never a request body). */
export function fail(err) {
  if (err instanceof OpenHomeError) {
    return json({ error: err.message, code: err.code, ...(err.errors ? { errors: err.errors } : {}) }, err.status);
  }
  console.error('[open-home] unexpected error:', err?.code || err?.name || 'error');
  return json({ error: 'Something went wrong. Please try again.' }, 500);
}

/** JSON bodies only: a cross-site form can't post here without a CORS preflight (which this API never answers). */
export async function readJson(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    throw new OpenHomeError('Unsupported request.', 415, 'content-type');
  }
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    throw new OpenHomeError('Unsupported request.', 400, 'bad-json');
  }
}

/** The signed-in agent's uid (Firebase ID token), or a 401. Pilot membership is checked by the service. */
export async function signedInUid(request) {
  const auth = await verifyAuth(request);
  if (!auth.authenticated) throw new OpenHomeError(auth.error || 'Please sign in.', auth.status || 401, 'auth');
  return auth.uid;
}
