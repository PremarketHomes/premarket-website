import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../middleware/auth';
import { removeAgentFromOffice } from '../../../../services/officeService';

/**
 * DELETE /api/offices/{officeId}/agents/{uid}
 * Office-admin only. Removes the agent from THIS office — never
 * touches their account, properties, offers, reports or billing (see
 * removeAgentFromOffice). Refuses to remove the office's only
 * remaining administrator.
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { officeId, uid } = await params;
    const result = await removeAgentFromOffice({ officeId, targetUid: uid, actorUid: auth.uid });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Remove office agent error:', err);
    return NextResponse.json({ error: err.message || 'Failed to remove agent' }, { status: err.status || 500 });
  }
}
