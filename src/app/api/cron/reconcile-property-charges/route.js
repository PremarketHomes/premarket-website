import { NextResponse } from 'next/server';
import { reconcileMissingCharges } from '../../services/billingService';

export const maxDuration = 60;

/**
 * GET /api/cron/reconcile-property-charges
 *
 * The fast half of the "property created but charge recording failed"
 * recovery story. The slow half (invoiceRunService.js's own call to the
 * same reconcileMissingCharges) runs once before each monthly invoice
 * run, which is a correctness guarantee but not a fast one — a gap
 * left by, say, a closed browser tab right after dashboard/add's
 * client-side property creation could otherwise sit unbilled for
 * close to a month before anyone finds out. This runs far more often
 * (see vercel.json) specifically to shrink that window to about an
 * hour, independent of the billing cycle.
 *
 * Always safe to run — reconcileMissingCharges only ever creates a
 * charge for a property that genuinely doesn't have one yet
 * (idempotent by construction, see billingService.js), so running this
 * every hour, or triggering it manually, can never create a duplicate.
 */
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await reconcileMissingCharges();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Reconcile property charges cron error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
