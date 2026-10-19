import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyAdmin } from '../../middleware/auth';

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
export const OAUTH_NONCE_COOKIE = 'xero_oauth_nonce';

/**
 * GET /api/auth/xero
 * Initiate Xero OAuth 2.0 flow - redirects to Xero login.
 *
 * CSRF protection: a random nonce is generated here, put in the
 * `state` param sent to Xero, AND set as an httpOnly cookie on THIS
 * browser. The callback only accepts a response whose `state` nonce
 * matches that same cookie — so a code obtained via some other
 * browser/session (the classic OAuth login-CSRF attack: an attacker
 * starts their own Xero login, then tricks an admin into hitting the
 * callback with the attacker's code+state) can never match, because
 * the attacker doesn't have the victim's httpOnly cookie.
 */
export async function GET(request) {
  const auth = await verifyAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const clientId = process.env.XERO_CLIENT_ID;
  const redirectUri = process.env.XERO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Xero OAuth not configured' }, { status: 500 });
  }

  // Xero retired the broad `accounting.transactions` scope for every
  // app created on or after 2 March 2026 — it was split into granular
  // scopes (accounting.invoices, accounting.payments,
  // accounting.banktransactions, accounting.manualjournals, etc.) and
  // the old name is now flatly rejected ("invalid_scope") for a new
  // app, which is exactly what this Premarket Xero app is. We only
  // ever create invoices (ACCREC) and read their status back — both
  // the same Invoices resource — so accounting.invoices alone (full
  // access, not .read-only, since we write) covers it; we never touch
  // Payments/BankTransactions/ManualJournals directly, so those
  // granular scopes are deliberately left out. accounting.contacts is
  // unaffected by this change and unchanged.
  const scopes = 'openid profile email accounting.invoices accounting.contacts offline_access';
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = Buffer.from(JSON.stringify({ adminUid: auth.uid, nonce })).toString('base64');

  const url = new URL(XERO_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', state);

  const res = NextResponse.json({ url: url.toString() });
  res.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // the Xero login round-trip only ever needs minutes
    path: '/api/auth/xero',
  });
  return res;
}
