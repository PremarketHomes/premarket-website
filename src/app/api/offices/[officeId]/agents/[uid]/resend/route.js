import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../../middleware/auth';
import { requireOfficeAdmin } from '../../../../../services/officeService';
import { resendInvitation } from '../../../../../services/officeImportService';

/**
 * POST /api/offices/{officeId}/agents/{uid}/resend
 * Office-admin only. Resends whichever invitation currently applies —
 * never creates a second Firebase Auth user or a duplicate invite
 * record (see resendInvitation).
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { officeId, uid } = await params;
    await requireOfficeAdmin({ officeId, uid: auth.uid });

    const result = await resendInvitation({ officeId, targetUid: uid });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Resend office invitation error:', err);
    return NextResponse.json({ error: err.message || 'Failed to resend invitation' }, { status: err.status || 500 });
  }
}
