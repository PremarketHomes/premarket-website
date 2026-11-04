import { NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { verifyAdmin } from '../../../middleware/auth';
import { adminDb } from '../../../../firebase/adminApp';
import { revokeLeadership, LeadershipInviteError } from '../../../services/leadershipInviteService';

/**
 * POST /api/admin/leadership/revoke   body: { officeId, uid, disableAccount? } — superAdmin only.
 * Removes one person's leadership access to one office. Takes effect on their very next request.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId, uid, disableAccount } = await request.json();
    const result = await revokeLeadership(adminDb, getAuth(), { officeId, uid, disableAccount: disableAccount === true, actorUid: auth.uid });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LeadershipInviteError) return NextResponse.json({ error: err.message, ...(err.extra || {}) }, { status: err.status });
    console.error('Leadership revoke error:', err);
    return NextResponse.json({ error: 'Failed to revoke access' }, { status: 500 });
  }
}
