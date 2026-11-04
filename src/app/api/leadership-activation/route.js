import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { adminDb } from '../../firebase/adminApp';
import { inspectLeadershipInvite, redeemNewAccountInvite, LeadershipInviteError } from '../services/leadershipInviteService';
import { BASE_URL } from '../services/emailTemplates';

/**
 * POST /api/leadership-activation   (public — the secret token in the emailed link is the credential)
 *   { token }                    -> read-only check when the page loads: { firstName, email, officeName, mode }
 *   { token, intent:'continue' } -> NEW accounts only, when they submit: creates the login and grants access,
 *                                    returns { oobCode } so the browser can set the password with Firebase directly.
 * The office is whatever the invitation was issued for; nothing in the request can change it.
 */
export async function POST(request) {
  try {
    const { token, intent } = await request.json();
    const body = intent === 'continue'
      ? await redeemNewAccountInvite(adminDb, getAuth(), token, { baseUrl: BASE_URL })
      : await inspectLeadershipInvite(adminDb, token);
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof LeadershipInviteError) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: { 'Cache-Control': 'no-store' } });
    }
    console.error('Leadership activation error:', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
