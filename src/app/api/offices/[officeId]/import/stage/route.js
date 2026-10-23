import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../middleware/auth';
import { requireOfficeAdmin } from '../../../../services/officeService';
import { stageImportBatch } from '../../../../services/officeImportService';

/**
 * POST /api/offices/{officeId}/import/stage   Body: { importId }
 * Office-admin only. Stages a validated import: no accounts are created and NO emails are sent.
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
    if (!importId) return NextResponse.json({ error: 'importId is required' }, { status: 400 });
    const result = await stageImportBatch({ importId, officeId });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Import stage error:', err);
    return NextResponse.json({ error: err.message || 'Request failed' }, { status: err.status || 500 });
  }
}
