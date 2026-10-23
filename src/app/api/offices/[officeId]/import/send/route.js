import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../middleware/auth';
import { requireOfficeAdmin } from '../../../../services/officeService';
import { sendStagedChunk } from '../../../../services/officeImportService';

/**
 * POST /api/offices/{officeId}/import/send   Body: { mode?: 'new' | 'retry' }
 * Office-admin only. Sends ONE short chunk of staged invitations (the page calls this repeatedly
 * until `remaining` is 0, so 50+ agents never hit a request timeout). 'retry' touches only rows that
 * failed — successful invitations are never resent. Rows are claimed atomically, so overlapping calls
 * cannot send the same agent twice.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { officeId } = await params;
    await requireOfficeAdmin({ officeId, uid: auth.uid });
    const body = await request.json().catch(() => ({}));
    const mode = body.mode === 'retry' ? 'retry' : 'new';
    const result = await sendStagedChunk({ officeId, actorUid: auth.uid, mode });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Import send error:', err);
    return NextResponse.json({ error: err.message || 'Failed to send invitations' }, { status: err.status || 500 });
  }
}
