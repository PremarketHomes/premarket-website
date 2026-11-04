import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { acceptExistingAccountInvite, LeadershipInviteError } from '../../services/leadershipInviteService';

/**
 * POST /api/leadership-activation/accept   { token } — the invitee, signed in as themselves.
 * For an EXISTING Premarket account only. Adds their uid to the invited office's leadershipUids and
 * touches nothing else about the account. The signed-in email must match the invitation.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { token } = await request.json();
    const result = await acceptExistingAccountInvite(adminDb, token, { uid: auth.uid, email: auth.email });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof LeadershipInviteError) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: { 'Cache-Control': 'no-store' } });
    }
    console.error('Leadership accept error:', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
