import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../../middleware/auth';
import { adminDb } from '../../../../../firebase/adminApp';
import { revokeInvite, LeadershipInviteError } from '../../../../services/leadershipInviteService';

/** POST /api/admin/leadership/invitations/revoke   body: { officeId, inviteId } — superAdmin only. */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId, inviteId } = await request.json();
    return NextResponse.json(await revokeInvite(adminDb, { officeId, inviteId, actorUid: auth.uid }));
  } catch (err) {
    if (err instanceof LeadershipInviteError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Leadership invite revoke error:', err);
    return NextResponse.json({ error: 'Failed to revoke the invitation' }, { status: 500 });
  }
}
