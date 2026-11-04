import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../middleware/auth';
import { adminDb } from '../../../../firebase/adminApp';
import { requireLeadership, getLeadershipAgentProfile } from '../../../services/leadershipService';

/**
 * GET /api/leadership/agents/{uid}
 * READ-ONLY coaching profile for ONE agent. The office comes from the caller's own leadership
 * membership; an agent outside that office (or a pending invitee, or an unknown id) is a 404.
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const scope = await requireLeadership(adminDb, auth.uid);
    const { uid } = await params;
    const profile = await getLeadershipAgentProfile(adminDb, scope, uid);
    return NextResponse.json(profile, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('Leadership agent profile error:', err);
    return NextResponse.json({ error: err.status && err.status < 500 ? err.message : 'Failed to load agent profile' }, { status: err.status || 500 });
  }
}
