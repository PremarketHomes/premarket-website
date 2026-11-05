import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../middleware/auth';
import { requireOfficeAdmin } from '../../../services/officeService';
import { updateAgentProfile } from '../../../services/officeAgentService';

/**
 * PATCH /api/offices/{officeId}/agent-profile
 * Body: { key, fullName?, phone?, contactEmail?, photoUrl? }
 * Office-admin only. Edits the office-managed PROFESSIONAL profile only: it never changes Firebase
 * Auth (including its email), accountStatus, passwords, invitations, or activates a login.
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId } = await params;
    await requireOfficeAdmin({ officeId, uid: auth.uid });

    const body = await request.json().catch(() => null);
    if (!body || typeof body.key !== 'string') return NextResponse.json({ error: 'Agent key is required' }, { status: 400 });
    const { key, ...patch } = body;
    const result = await updateAgentProfile({ officeId, key, patch, actorUid: auth.uid });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Update office agent profile error:', err);
    return NextResponse.json({ error: err.message || 'Failed to update profile' }, { status: err.status || 500 });
  }
}
