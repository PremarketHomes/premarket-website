import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import {
  findOrCreateContact,
  createInvoice,
  sendInvoice,
  isXeroConnected,
} from '../../../../../services/xeroService';
import { markChargesInvoiced, markChargesFailed } from '../../../../../services/billingService';
import { verifyAdmin } from '../../../../../middleware/auth';

/**
 * POST /api/admin/invoicing/runs/[runId]/send
 * Send all invoices in a run to Xero.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { runId } = await params;

    if (!(await isXeroConnected())) {
      return NextResponse.json({ error: 'Xero is not connected' }, { status: 400 });
    }

    // Get the run
    const runRef = adminDb.collection('invoiceRuns').doc(runId);
    const runDoc = await runRef.get();
    if (!runDoc.exists) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const runData = runDoc.data();
    if (runData.status !== 'approved') {
      return NextResponse.json({ error: 'Run must be approved before sending' }, { status: 400 });
    }

    // Get settings for account code and invoice prefix
    const settingsDoc = await adminDb.collection('settings').doc('invoicing').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    const accountCode = settings.xeroAccountCode || '200';
    const invoicePrefix = settings.invoicePrefix || 'PM-';
    const paymentTermsDays = settings.paymentTermsDays || 14;

    // Update run status to sending
    await runRef.update({ status: 'sending', executedAt: FieldValue.serverTimestamp() });

    // Get all items for this run
    const itemsSnap = await adminDb
      .collection('invoiceRunItems')
      .where('runId', '==', runId)
      .get();

    const results = [];
    const errors = [];

    for (const itemDoc of itemsSnap.docs) {
      const item = itemDoc.data();
      const itemRef = itemDoc.ref;

      try {
        // Find or create Xero contact
        const nameParts = item.agentName?.split(' ') || [];
        const contact = await findOrCreateContact({
          name: item.agencyName,
          email: item.agentEmail,
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
        });

        if (!contact?.ContactID) {
          throw new Error(`Failed to create Xero contact for ${item.agencyName}`);
        }

        // Build line items - one per property, ex-GST unit amount
        const unitAmountExGst = item.pricePerListing / (1 + (runData.gstRate || 0.1));
        const lineItems = item.properties.map((prop) => ({
          description: `Premarket listing: ${prop.address}`,
          quantity: 1,
          unitAmount: Math.round(unitAmountExGst * 100) / 100,
        }));

        // Due date
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + paymentTermsDays);
        const dueDateStr = dueDate.toISOString().split('T')[0];

        // Period string for reference
        const periodStart = runData.periodStart?.toDate?.() || new Date(runData.periodStart);
        const periodStr = periodStart.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

        // Create invoice in Xero
        const invoice = await createInvoice({
          contactId: contact.ContactID,
          lineItems,
          reference: `${invoicePrefix}${periodStr} - ${item.agencyName}`,
          dueDate: dueDateStr,
          accountCode,
        });

        if (!invoice?.InvoiceID) {
          throw new Error(`Failed to create Xero invoice for ${item.agencyName}`);
        }

        // Send invoice email via Xero
        await sendInvoice(invoice.InvoiceID);

        // Update item with Xero details
        await itemRef.update({
          xeroContactId: contact.ContactID,
          xeroInvoiceId: invoice.InvoiceID,
          xeroInvoiceNumber: invoice.InvoiceNumber || null,
          xeroInvoiceUrl: invoice.Url || null,
          xeroStatus: invoice.Status || 'AUTHORISED',
          status: 'sent',
          lastSyncedAt: FieldValue.serverTimestamp(),
        });

        // Flip this item's charges from 'queued' to 'invoiced' — the
        // thing that actually prevents these properties from ever
        // being billed again, not a flag on the property itself.
        await markChargesInvoiced(item.properties.map((p) => p.propertyId).filter(Boolean));

        results.push({
          agencyName: item.agencyName,
          invoiceNumber: invoice.InvoiceNumber,
          status: 'sent',
        });
      } catch (err) {
        console.error(`Error sending invoice for ${item.agencyName}:`, err);
        errors.push({
          agencyName: item.agencyName,
          error: err.message,
        });

        await itemRef.update({ status: 'error', lastError: err.message });

        // Release this item's charges back to 'pending' — a failed
        // send must not leave them permanently stuck 'queued' against
        // an item that errored out; the next run will pick them up.
        await markChargesFailed(item.properties.map((p) => p.propertyId).filter(Boolean));
      }
    }

    // Update run status
    const finalStatus = errors.length === 0 ? 'sent' : errors.length === itemsSnap.size ? 'failed' : 'partial';
    await runRef.update({
      status: finalStatus,
      xeroSendResults: results,
      errors: errors,
    });

    return NextResponse.json({
      success: true,
      status: finalStatus,
      sent: results.length,
      failed: errors.length,
      results,
      errors,
    });
  } catch (err) {
    console.error('Invoice run send error:', err);
    return NextResponse.json({ error: 'Failed to send invoices' }, { status: 500 });
  }
}
