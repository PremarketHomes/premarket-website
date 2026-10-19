import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { saveXeroTokens } from '../../../services/xeroService';
import { OAUTH_NONCE_COOKIE } from '../route';

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

/**
 * GET /api/auth/xero/callback?code=xxx&state=xxx
 * Exchange authorization code for tokens, store in Firestore, redirect back.
 */
export async function GET(request) {
  // Clear the one-time CSRF cookie on every outcome (success, error,
  // or a mismatch) — it's single-use regardless of what happens next.
  function redirectAndClearNonce(path) {
    const res = NextResponse.redirect(new URL(path, request.url));
    res.cookies.set(OAUTH_NONCE_COOKIE, '', { path: '/api/auth/xero', maxAge: 0 });
    return res;
  }

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code) {
      return redirectAndClearNonce('/dashboard/admin/invoicing?xero=error&reason=no_code');
    }

    // Verify state contains admin info + the CSRF nonce
    let adminUid = null;
    let nonce = null;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      adminUid = decoded.adminUid;
      nonce = decoded.nonce;
    } catch {
      return redirectAndClearNonce('/dashboard/admin/invoicing?xero=error&reason=bad_state');
    }

    // CSRF check: the nonce in `state` must match the httpOnly cookie
    // set on THIS browser when the flow started. A code+state pair
    // obtained via a different session (an attacker's own Xero login,
    // replayed into an admin's browser) can never have this cookie.
    // Parsed from the raw header (rather than relying on the
    // NextRequest-specific `.cookies` API) so this is exercised the
    // same way in tests as it runs in production.
    const cookieHeader = request.headers.get('cookie') || '';
    const cookieNonce = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${OAUTH_NONCE_COOKIE}=`))
      ?.slice(OAUTH_NONCE_COOKIE.length + 1);
    if (!nonce || !cookieNonce || nonce !== cookieNonce) {
      console.error('Xero OAuth callback: state nonce did not match cookie — rejecting');
      return redirectAndClearNonce('/dashboard/admin/invoicing?xero=error&reason=csrf');
    }

    // Verify admin
    if (adminUid) {
      const adminDoc = await adminDb.collection('users').doc(adminUid).get();
      if (!adminDoc.exists || adminDoc.data().superAdmin !== true) {
        return redirectAndClearNonce('/dashboard/admin/invoicing?xero=error&reason=unauthorized');
      }
    } else {
      return redirectAndClearNonce('/dashboard/admin/invoicing?xero=error&reason=unauthorized');
    }

    // Exchange code for tokens
    const tokenRes = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.XERO_REDIRECT_URI,
        client_id: process.env.XERO_CLIENT_ID,
        client_secret: process.env.XERO_CLIENT_SECRET,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Xero token exchange failed:', err);
      return redirectAndClearNonce('/dashboard/admin/invoicing?xero=error&reason=token_exchange');
    }

    const tokens = await tokenRes.json();

    // Get tenant ID from connections endpoint
    const connectionsRes = await fetch(XERO_CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let tenantId = null;
    if (connectionsRes.ok) {
      const connections = await connectionsRes.json();
      if (connections.length > 0) {
        tenantId = connections[0].tenantId;
      }
    }

    // Store tokens
    await saveXeroTokens({ ...tokens, tenant_id: tenantId });

    return redirectAndClearNonce('/dashboard/admin/invoicing?xero=connected');
  } catch (err) {
    console.error('Xero OAuth callback error:', err);
    return redirectAndClearNonce('/dashboard/admin/invoicing?xero=error&reason=unknown');
  }
}
