import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { sendEmail } from '../../services/resendService';
import { createInvoiceRunFromPendingCharges } from '../../services/invoiceRunService';
import { getDueBillingEntityKeys } from '../../services/billingService';
import { verifyCron } from '../../middleware/auth';

export const maxDuration = 120;

/**
 * GET /api/cron/invoice-dry-run
 * Runs daily. Each agency has its own rolling 30-day billing cycle
 * (see billingService.getDueBillingEntityKeys) rather than everyone
 * sharing one fixed calendar day — this checks, every day, which
 * agencies' oldest pending charge has reached 30 days old, and
 * bundles ONLY those agencies into a new draft run (see
 * invoiceRunService.js — the same aggregation the manual "Create Run"
 * admin action uses, just filtered). Every other agency's charges are
 * left untouched at 'pending' for a later day. Emails superAdmins
 * that the run is ready to review — never the agencies themselves,
 * and never auto-approved or auto-sent; that still requires an
 * explicit admin action (see runs/[runId]/route.js PATCH and
 * runs/[runId]/send/route.js).
 */
export async function GET(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const settingsDoc = await adminDb.collection('settings').doc('invoicing').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};

    if (!settings.cronEnabled) {
      return NextResponse.json({ message: 'Cron disabled', skipped: true });
    }

    const pendingSnap = await adminDb.collection('propertyCharges').where('status', '==', 'pending').get();
    const pendingCharges = pendingSnap.docs.map((d) => d.data());
    const dueEntityKeys = getDueBillingEntityKeys(pendingCharges, new Date());

    if (dueEntityKeys.length === 0) {
      return NextResponse.json({ message: 'No agency has reached its 30-day billing cycle yet', skipped: true });
    }

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'cron', onlyEntityKeys: dueEntityKeys });

    if (!result) {
      return NextResponse.json({ message: 'No pending charges to invoice', skipped: true });
    }

    // Notify superAdmins — never the agencies themselves, and this
    // creates a draft only; sending still requires a separate explicit
    // admin approval + send action.
    const adminsSnap = await adminDb.collection('users').where('superAdmin', '==', true).get();
    const todayStr = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

    for (const adminDoc of adminsSnap.docs) {
      const adminData = adminDoc.data();
      if (adminData.email) {
        await sendEmail({
          to: adminData.email,
          subject: `Invoice Run Ready for Review: ${todayStr}`,
          html: `
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Draft Invoice Run Ready</h2>
              <p>${result.totalAgencies} agenc${result.totalAgencies === 1 ? 'y' : 'ies'} reached its 30-day billing cycle and has been bundled into a new draft run.</p>
              <ul>
                <li>Properties: ${result.totalProperties}</li>
                <li>Agencies: ${result.totalAgencies}</li>
                <li>Total (inc GST): $${Math.round(result.totalAmountInc).toLocaleString()}</li>
              </ul>
              <p><a href="https://premarket.homes/dashboard/admin/invoicing">Review in Admin Dashboard</a></p>
            </body>
          `,
        });
      }
    }

    return NextResponse.json({
      success: true,
      runId: result.runId,
      totalProperties: result.totalProperties,
      totalAgencies: result.totalAgencies,
      totalAmountInc: result.totalAmountInc,
    });
  } catch (err) {
    console.error('Invoice dry run cron error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
