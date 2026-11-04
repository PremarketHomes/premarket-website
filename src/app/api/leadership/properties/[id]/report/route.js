import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../middleware/auth';
import { adminDb } from '../../../../../firebase/adminApp';
import { requireLeadership, getLeadershipPropertyReport } from '../../../../services/leadershipService';

/**
 * GET /api/leadership/properties/{id}/report
 * READ-ONLY and buyer-redacted: no buyer names, emails, phone numbers or accounts, ever.
 * Only campaigns whose listing agent currently belongs to the caller's own office.
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const scope = await requireLeadership(adminDb, auth.uid);
    const { id } = await params;
    const report = await getLeadershipPropertyReport(adminDb, scope, id);
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('Leadership report error:', err);
    return NextResponse.json({ error: err.status && err.status < 500 ? err.message : 'Failed to load report' }, { status: err.status || 500 });
  }
}
