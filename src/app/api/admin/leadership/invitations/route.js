import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { verifyAdmin } from '../../../middleware/auth';
import { adminDb } from '../../../../firebase/adminApp';
import { createLeadershipInvite, LeadershipInviteError } from '../../../services/leadershipInviteService';
import { sendLeadershipInviteEmail } from '../../../services/resendService';
import { BASE_URL } from '../../../services/emailTemplates';

/**
 * POST /api/admin/leadership/invitations   body: { officeId, email, firstName, lastName, approveExisting? }
 * superAdmin only. Invites ONE person to lead ONE office. The token goes only into the email — it is
 * never returned, so an administrator cannot hand the link around or read it back later.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { officeId, email, firstName, lastName, approveExisting } = await request.json();
    const invite = await createLeadershipInvite(adminDb, getAuth(), {
      officeId, email, firstName, lastName, approveExisting: approveExisting === true, actorUid: auth.uid,
    });

    let emailSent = true;
    try {
      await sendLeadershipInviteEmail(invite.email, invite.firstName, invite.officeName,
        `${BASE_URL}/leadership-invite?t=${invite.token}`, { existing: invite.mode === 'existing' });
    } catch (err) {
      emailSent = false;
      console.error('Leadership invite email failed:', err?.message);
    }
    return NextResponse.json({ inviteId: invite.inviteId, mode: invite.mode, emailSent }, { status: 201 });
  } catch (err) {
    if (err instanceof LeadershipInviteError) {
      return NextResponse.json({ error: err.message, ...(err.extra || {}) }, { status: err.status });
    }
    console.error('Leadership invite error:', err);
    return NextResponse.json({ error: 'Failed to create the invitation' }, { status: 500 });
  }
}
