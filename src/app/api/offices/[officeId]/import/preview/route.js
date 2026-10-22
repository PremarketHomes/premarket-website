import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../middleware/auth';
import { requireOfficeAdmin } from '../../../../services/officeService';
import { parseCsv, classifyImportRows, createImportBatch } from '../../../../services/officeImportService';

/**
 * POST /api/offices/{officeId}/import/preview
 * Body: { csvText }
 * Office-admin only. Parses and validates the CSV server-side (never
 * trusts client-side parsing for something that will create real
 * accounts), classifies every row, and persists the result as an
 * officeImports batch — writes NOTHING to users/Auth. The returned
 * importId is what /import/commit then actually acts on.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { officeId } = await params;
    await requireOfficeAdmin({ officeId, uid: auth.uid });

    const { csvText } = await request.json();
    if (!csvText || typeof csvText !== 'string') {
      return NextResponse.json({ error: 'csvText is required' }, { status: 400 });
    }

    const rawRows = parseCsv(csvText);
    if (rawRows.length === 0) {
      return NextResponse.json({ error: 'No rows found in CSV' }, { status: 400 });
    }

    const { rows, summary } = await classifyImportRows({ officeId, rawRows });
    const importId = await createImportBatch({ officeId, uploadedBy: auth.uid, rows });

    return NextResponse.json({ importId, rows, summary });
  } catch (err) {
    console.error('Import preview error:', err);
    return NextResponse.json({ error: err.message || 'Failed to preview import' }, { status: err.status || 500 });
  }
}
