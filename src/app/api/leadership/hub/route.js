import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { requireLeadership, getLeadershipHub } from '../../services/leadershipService';

/**
 * GET /api/leadership/hub
 * READ-ONLY. The office scope comes from the caller's own uid (never from the request), and the
 * caller must be in that office's `leadershipUids`. No other HTTP method is exported.
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const scope = await requireLeadership(adminDb, auth.uid);
    const hub = await getLeadershipHub(adminDb, scope);
    return NextResponse.json(hub, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('Leadership hub error:', err);
    return NextResponse.json({ error: err.status && err.status < 500 ? err.message : 'Failed to load Leadership Hub' }, { status: err.status || 500 });
  }
}
