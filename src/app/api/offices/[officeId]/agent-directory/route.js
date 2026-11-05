import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../middleware/auth';
import { requireOfficeAdmin } from '../../../services/officeService';
import { buildOfficeAgentDirectory } from '../../../services/officeAgentService';

/**
 * GET /api/offices/{officeId}/agent-directory
 * Office-admin only, scoped to {officeId}. READ-ONLY merge of users, pending invitations, staged
 * imports, officeAgents profiles and teams. Never returns property, offer, report or billing data.
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId } = await params;
    await requireOfficeAdmin({ officeId, uid: auth.uid });
    return NextResponse.json(await buildOfficeAgentDirectory(officeId));
  } catch (err) {
    console.error('Office agent directory error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load agents' }, { status: err.status || 500 });
  }
}
