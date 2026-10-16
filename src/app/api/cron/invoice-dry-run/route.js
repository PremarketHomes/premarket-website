import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { sendEmail } from '../../services/resendService';
import { createInvoiceRunFromPendingCharges } from '../../services/invoiceRunService';

export const maxDuration = 120;

/**
 * GET /api/cron/invoice-dry-run
 * Runs daily. On the configured cronDay, bundles every pending property
 * charge into a new draft run (see invoiceRunService.js — the same
 * aggregation the manual "Create Run" admin action uses) and emails
 * superAdmins that it's ready to review. Creates a run even if there's
 * nothing pending is skipped (the shared function returns null) rather
 * than creating an empty one.
 */
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const settingsDoc = await adminDb.collection('settings').doc('invoicing').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};

    if (!settings.cronEnabled) {
      return NextResponse.json({ message: 'Cron disabled', skipped: true });
    }

    const today = new Date();
    const cronDay = settings.cronDay || 1;

    if (today.getDate() !== cronDay) {
      return NextResponse.json({ message: `Not cron day (today=${today.getDate()}, configured=${cronDay})`, skipped: true });
    }

    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'cron' });

    if (!result) {
      return NextResponse.json({ message: 'No pending charges to invoice', skipped: true });
    }

    // Notify superAdmins
    const adminsSnap = await adminDb.collection('users').where('superAdmin', '==', true).get();
    const periodStr = today.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

    for (const adminDoc of adminsSnap.docs) {
      const adminData = adminDoc.data();
      if (adminData.email) {
        await sendEmail({
          to: adminData.email,
          subject: `Invoice Dry Run Ready: ${periodStr}`,
          html: `
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Monthly Invoice Dry Run</h2>
              <p>A new invoice dry run has been created, bundling every property charge recorded since the last run.</p>
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
