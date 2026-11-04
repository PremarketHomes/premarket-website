import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { requireLeadership } from '../../services/leadershipService';

/**
 * GET /api/leadership/access
 * Whether the authenticated caller is a leader of an active office. Used only to show or hide
 * the sidebar link, so a non-leader gets a plain `{ leader: false }` rather than an error.
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    try {
      const scope = await requireLeadership(adminDb, auth.uid);
      return NextResponse.json({ leader: true, officeName: scope.officeName }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      if (err.status === 403) return NextResponse.json({ leader: false }, { headers: { 'Cache-Control': 'no-store' } });
      throw err;
    }
  } catch (err) {
    console.error('Leadership access error:', err);
    return NextResponse.json({ error: 'Failed to check access' }, { status: err.status || 500 });
  }
}
