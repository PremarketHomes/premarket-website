import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../middleware/auth';
import { requireOfficeAdmin } from '../../../../services/officeService';
import { commitImportBatch } from '../../../../services/officeImportService';

/**
 * POST /api/offices/{officeId}/import/commit
 * Body: { importId }
 * Office-admin only. Acts on exactly the row set the admin already
 * reviewed in /import/preview — never re-parses client input at this
 * step. Safe to call again for the same importId: already-resolved
 * rows are left untouched, only failed/unprocessed ones are retried
 * (see commitImportBatch).
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { officeId } = await params;
    await requireOfficeAdmin({ officeId, uid: auth.uid });

    const { importId } = await request.json();
    if (!importId) {
      return NextResponse.json({ error: 'importId is required' }, { status: 400 });
    }

    const result = await commitImportBatch({ importId, officeId, actorUid: auth.uid });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Import commit error:', err);
    return NextResponse.json({ error: err.message || 'Failed to commit import' }, { status: err.status || 500 });
  }
}
