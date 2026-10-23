import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../../middleware/auth';
import { listAgentPropertiesForOffice } from '../../../../../services/officeTeamService';

/**
 * GET /api/offices/{officeId}/agents/{uid}/properties
 * Office-admin only, READ-ONLY. Returns a minimal list of one member's
 * properties. The target must be a linked member of the same office.
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { officeId, uid } = await params;
    const result = await listAgentPropertiesForOffice({ officeId, targetUid: uid, actorUid: auth.uid });
    return NextResponse.json(result);
  } catch (err) {
    console.error('List office agent properties error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load properties' }, { status: err.status || 500 });
  }
}
