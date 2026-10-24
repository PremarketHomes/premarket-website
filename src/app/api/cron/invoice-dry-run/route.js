import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { sendEmail } from '../../services/resendService';
import { wrapEmail, eyebrow, heading, p, infoBox, ctaButton } from '../../services/emailTemplates';
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
          html: wrapEmail({
            previewText: `${result.totalAgencies} agenc${result.totalAgencies === 1 ? 'y' : 'ies'} ready for invoicing review`,
            orgLabel: 'Premarket Group Pty Ltd',
            recipientEmail: adminData.email,
            reason: 'Internal notification for Premarket administrators.',
            showUnsubscribe: false,
            bodyHTML: `
              ${eyebrow('Invoicing')}
              ${heading('Draft invoice run ready')}
              ${p(`${result.totalAgencies} agenc${result.totalAgencies === 1 ? 'y' : 'ies'} reached its 30-day billing cycle and has been bundled into a new draft run.`)}
              ${infoBox(`
                <p style="margin:0 0 6px 0; font-size:14px; color:#475569;">Properties: <strong style="color:#0f172a;">${result.totalProperties}</strong></p>
                <p style="margin:0 0 6px 0; font-size:14px; color:#475569;">Agencies: <strong style="color:#0f172a;">${result.totalAgencies}</strong></p>
                <p style="margin:0; font-size:14px; color:#475569;">Total (inc GST): <strong style="color:#0f172a;">$${Math.round(result.totalAmountInc).toLocaleString()}</strong></p>
              `)}
              ${ctaButton('Review in admin dashboard', 'https://premarket.homes/dashboard/admin/invoicing')}
            `,
          }),
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
