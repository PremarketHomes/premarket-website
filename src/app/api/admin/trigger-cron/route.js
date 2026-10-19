import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../middleware/auth';

/**
 * Call a cron handler directly with a fake authenticated request.
 * No HTTP round-trip needed — runs in the same process.
 */
async function callHandler(handler, method = 'GET') {
  const fakeRequest = new Request('http://localhost/trigger', {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
  });

  const fn = method === 'POST' ? handler.POST : handler.GET;
  if (!fn) throw new Error(`Handler does not support ${method}`);
  return fn(fakeRequest);
}

// Static imports for all cron handlers
import * as computeScores from '../../cron/compute-scores/route.js';
import * as computeTrends from '../../cron/compute-trends/route.js';
import * as cleanupStale from '../../cron/cleanup-stale/route.js';
import * as syncAgentbox from '../../cron/sync-agentbox/route.js';
import * as compressImages from '../../cron/compress-images/route.js';
import * as invoiceDryRun from '../../cron/invoice-dry-run/route.js';
import * as reconcilePropertyCharges from '../../cron/reconcile-property-charges/route.js';
import * as syncXeroInvoices from '../../cron/sync-xero-invoices/route.js';
import * as propertyFollowup from '../../cron/property-followup/route.js';
import * as marketReport from '../../cron/market-report/route.js';
import * as computeContacts from '../../cron/compute-contacts/route.js';
import * as newsletterSend from '../../newsletter/send/route.js';

const JOBS = {
  'compute-scores':    { handler: computeScores },
  'compute-trends':    { handler: computeTrends },
  'cleanup-stale':     { handler: cleanupStale },
  'sync-agentbox':     { handler: syncAgentbox },
  'compress-images':   { handler: compressImages },
  'invoice-dry-run':   { handler: invoiceDryRun },
  'reconcile-property-charges': { handler: reconcilePropertyCharges },
  'sync-xero-invoices': { handler: syncXeroInvoices },
  'property-followup': { handler: propertyFollowup },
  'market-report':     { handler: marketReport },
  'compute-contacts':  { handler: computeContacts },
  'newsletter':        { handler: newsletterSend, method: 'POST' },
};

/**
 * POST /api/admin/trigger-cron
 * Runs cron job handlers directly (in-process) for superAdmins.
 * Body: { jobKey }
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { jobKey } = await request.json();

    const job = JOBS[jobKey];
    if (!job) {
      return NextResponse.json({ error: 'Unknown job' }, { status: 400 });
    }

    const res = await callHandler(job.handler, job.method || 'GET');
    const data = await res.json().catch(() => ({}));

    return NextResponse.json({
      success: res.ok,
      status: res.status,
      jobKey,
      result: data,
    });
  } catch (err) {
    console.error('Trigger cron error:', err);
    return NextResponse.json({ error: 'Failed to trigger job', details: err.message }, { status: 500 });
  }
}
