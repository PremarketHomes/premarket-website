import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAdmin } from '../../../middleware/auth';
import { createInvoiceRunFromPendingCharges } from '../../../services/invoiceRunService';

/**
 * GET /api/admin/invoicing/runs
 * List all invoice runs sorted by createdAt desc.
 */
export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const snap = await adminDb
      .collection('invoiceRuns')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const runs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({ runs });
  } catch (err) {
    console.error('Invoice runs GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 });
  }
}

/**
 * POST /api/admin/invoicing/runs
 * Create a draft run from every currently-pending property charge
 * (see billingService.js / invoiceRunService.js). Charges are recorded
 * at property-creation time, not computed from a createdAt date range
 * here — this endpoint no longer takes dateFrom/dateTo, since a charge
 * belongs to exactly one run the moment it's created, regardless of
 * when the property itself was created. Running this twice in a row
 * with nothing new charged in between simply returns `runId: null`.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await createInvoiceRunFromPendingCharges({ createdBy: auth.uid });

    if (!result) {
      return NextResponse.json({ success: true, runId: null, message: 'No pending charges to invoice' });
    }

    return NextResponse.json({
      success: true,
      runId: result.runId,
      summary: {
        totalProperties: result.totalProperties,
        totalAgencies: result.totalAgencies,
        totalAmountInc: result.totalAmountInc,
        totalAmountEx: result.totalAmountEx,
        totalGst: result.totalGst,
      },
    });
  } catch (err) {
    console.error('Invoice runs POST error:', err);
    return NextResponse.json({ error: 'Failed to create dry run' }, { status: 500 });
  }
}
