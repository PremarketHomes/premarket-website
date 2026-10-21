import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { adminDb } from '../../../../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import {
  findOrCreateContact,
  createInvoice,
  sendInvoice,
  isXeroConnected,
  findInvoiceByReference,
} from '../../../../../services/xeroService';
import { markChargesInvoiced, markChargesFailed, resolveBillingContact } from '../../../../../services/billingService';
import { verifyAdmin } from '../../../../../middleware/auth';

/**
 * Deterministic, not random — the same invoiceRunItem always produces
 * the same key, forever (derived from its own Firestore doc ID, which
 * never changes). Attached to the one real createInvoice call below
 * as Xero's documented Idempotency-Key header: if a request carrying
 * this exact key already succeeded — including a prior attempt whose
 * HTTP response this process never received (a timeout, a dropped
 * connection) — Xero hands back that SAME invoice instead of creating
 * a second one. This is what makes it safe to simply retry invoice
 * creation for an item that has no stored xeroInvoiceId yet, without
 * first having to prove whether an earlier attempt actually reached
 * Xero or not.
 */
function stableInvoiceIdempotencyKey(itemId) {
  return createHash('sha256').update(`premarket-invoice-run-item:${itemId}`).digest('hex');
}

/**
 * The exact name used to find-or-create this item's Xero contact —
 * deliberately NOT always item.agencyName. findOrCreateContact
 * matches purely by name, so two DIFFERENT independent agents (no
 * company, billingEntityType 'independent') who happen to share the
 * same personal name would otherwise collide onto one Xero contact,
 * even though Premarket's own billingEntityKey correctly keeps them
 * separate — their invoices would then sit under one shared Xero
 * record, mixing two unrelated people's history.
 *
 * Fixed by appending a short, stable suffix derived from the
 * billingEntityKey itself (already unique by construction, e.g.
 * agent:<uid>) ONLY for independent agents — the one case this
 * collision is actually possible. Company-based (billingEntityType
 * 'agency') contacts are untouched: two agents genuinely sharing a
 * company name are SUPPOSED to consolidate under one contact, so a
 * disambiguating suffix there would be wrong, not a fix.
 *
 * This only changes what the XERO contact is named — it never
 * changes item.agencyName itself, so nothing in Premarket's own
 * admin dashboard display changes.
 */
function buildXeroContactName(item) {
  if (item.billingEntityType !== 'independent') return item.agencyName;
  const suffix = String(item.billingEntityKey || '').replace(/^agent:/, '').slice(0, 8);
  return suffix ? `${item.agencyName} (${suffix})` : item.agencyName;
}

/**
 * POST /api/admin/invoicing/runs/[runId]/send
 * Send all invoices in a run to Xero.
 *
 * Invoice CREATION and EMAIL DELIVERY are deliberately two separate
 * steps with two separate failure handlers, not one try/catch around
 * both (see the loop below). Creation succeeding is what makes a
 * charge genuinely "invoiced" — a real Xero invoice now exists for
 * it — so charges are marked invoiced, and the item's xeroInvoiceId
 * is persisted, immediately after creation succeeds, before the email
 * step is even attempted. A later, separate email failure can then
 * never cause those same charges to be released back to 'pending':
 * doing so would let a future run create a SECOND real Xero invoice
 * for properties that already have one, merely because the first
 * invoice's email happened to fail. Only a genuine creation failure
 * (no real invoice exists yet) still releases charges — that case is
 * exactly as safe to retry as it always was.
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

    const runRef = adminDb.collection('invoiceRuns').doc(runId);

    // Atomically claim this run for sending — the one thing standing
    // between a double-click (or two admins acting on the same run at
    // once) and two concurrent executions of the loop below both
    // reading status: 'approved' and both proceeding. A plain
    // read-then-write (the previous version of this route) has a race
    // here; a transaction's own read is what Firestore actually
    // guards against a concurrent conflicting write, not just a
    // convention this code follows.
    let runData;
    try {
      runData = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(runRef);
        if (!snap.exists) {
          throw Object.assign(new Error('Run not found'), { status: 404 });
        }
        const data = snap.data();
        if (data.status !== 'approved') {
          throw Object.assign(new Error('Run must be approved before sending'), { status: 400 });
        }
        tx.update(runRef, { status: 'sending', executedAt: FieldValue.serverTimestamp() });
        return data;
      });
    } catch (err) {
      if (err.status) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    // Get settings for account code and invoice prefix
    const settingsDoc = await adminDb.collection('settings').doc('invoicing').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    const accountCode = settings.xeroAccountCode || '200';
    const invoicePrefix = settings.invoicePrefix || 'PM-';
    const paymentTermsDays = settings.paymentTermsDays || 14;

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

      // ── Step 1: ensure the Xero invoice exists (idempotent) ──
      let invoice;
      try {
        if (item.xeroInvoiceId) {
          // Already created in a prior attempt for this exact item
          // (e.g. this run's send was retried after a partial
          // failure) — reuse it, never call createInvoice again.
          invoice = { InvoiceID: item.xeroInvoiceId, InvoiceNumber: item.xeroInvoiceNumber, Status: item.xeroStatus };
        } else {
          // Agency items must have a billing contact that is confirmed
          // RIGHT NOW — re-resolved live, here, never trusted from
          // item.agentName/agentEmail (stamped at run-creation time by
          // invoiceRunService.js, purely for admin preview, and
          // possibly stale by the time this run is actually sent — a
          // contact could have been confirmed, or even changed, in the
          // time between).
          let contactName = item.agentName;
          let contactEmail = item.agentEmail;
          let xeroContactName = buildXeroContactName(item);

          if (item.billingEntityType !== 'independent') {
            const confirmed = await resolveBillingContact(item.billingEntityKey);
            if (!confirmed) {
              errors.push({
                agencyName: item.agencyName,
                error: 'Billing details required — no confirmed billing contact for this agency',
                stage: 'contact',
              });
              await itemRef.update({ status: 'contact_required', lastError: 'Billing details required' });
              await markChargesFailed(item.properties.map((p) => p.propertyId).filter(Boolean));
              continue;
            }
            contactName = confirmed.name;
            contactEmail = confirmed.email;
            xeroContactName = confirmed.billingName || xeroContactName;
          } else {
            // Independent agents have no separate agency to confirm —
            // their own profile email/name is always a safe, correct
            // fallback, so this never blocks sending. But they may
            // have confirmed a DIFFERENT billing email directly (e.g.
            // an accounts/bookkeeper address given at signup — see
            // confirmIndependentBillingContact) — prefer that live,
            // confirmed value when one exists, instead of silently
            // always using their login email.
            const confirmedOwn = await resolveBillingContact(item.billingEntityKey);
            if (confirmedOwn) {
              contactName = confirmedOwn.name || contactName;
              contactEmail = confirmedOwn.email || contactEmail;
              xeroContactName = confirmedOwn.billingName || xeroContactName;
            }
          }

          const nameParts = contactName?.split(' ') || [];
          const contact = await findOrCreateContact({
            name: xeroContactName,
            email: contactEmail,
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' ') || '',
          });

          if (!contact?.ContactID) {
            throw new Error(`Failed to create Xero contact for ${item.agencyName}`);
          }

          // Build line items — one per property, using THAT property's
          // own already ex-GST subtotalEx and already-computed gstAmount
          // (both snapshotted onto the charge at charge-creation time,
          // see billingService.js). Deliberately never derives a single
          // run-wide unit amount or tax rate from the item or the run —
          // neither carries a pricePerListing/gstRate field at all
          // (an item consolidates possibly-differently-priced charges),
          // so each property's own numbers are the only source of truth,
          // same principle runs/[runId]/route.js's removeProperties
          // already follows when recalculating a run's totals.
          const lineItems = item.properties.map((prop) => ({
            description: `Premarket listing: ${prop.address}`,
            quantity: 1,
            unitAmount: prop.subtotalEx,
            taxType: prop.gstAmount > 0 ? 'OUTPUT' : 'NONE',
          }));

          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + paymentTermsDays);
          const dueDateStr = dueDate.toISOString().split('T')[0];

          const periodStart = runData.periodStart?.toDate?.() || new Date(runData.periodStart);
          const periodStr = periodStart.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
          // Same disambiguated name as the Xero contact above — two
          // different independent agents sharing a personal name
          // would otherwise also produce an IDENTICAL reference
          // string for the same period, which could make the
          // pre-flight reconciliation check below match the wrong
          // person's invoice, not just the wrong contact.
          const reference = `${invoicePrefix}${periodStr} - ${xeroContactName}`;

          // Pre-flight reconciliation — never assume a reference or an
          // idempotency key alone is enough. This specifically guards
          // the case a prior attempt's request actually reached Xero
          // and succeeded, but this process never received that
          // response (a timeout, a dropped connection) and so never
          // got the chance to store xeroInvoiceId at all. Checked
          // BEFORE calling createInvoice, not instead of the
          // Idempotency-Key below — the two are complementary (see
          // findInvoiceByReference's own comment for why neither one
          // alone closes every race).
          const existing = await findInvoiceByReference(reference);
          if (existing?.InvoiceID) {
            invoice = existing;
          } else {
            invoice = await createInvoice({
              contactId: contact.ContactID,
              lineItems,
              reference,
              dueDate: dueDateStr,
              accountCode,
              idempotencyKey: stableInvoiceIdempotencyKey(itemDoc.id),
            });
          }

          if (!invoice?.InvoiceID) {
            throw new Error(`Failed to create Xero invoice for ${item.agencyName}`);
          }

          // Record the real invoice immediately, and flip these
          // charges to invoiced NOW — a real, authorised Xero invoice
          // exists for them from this exact point on, regardless of
          // whether the email below succeeds.
          await itemRef.update({
            xeroContactId: contact.ContactID,
            xeroInvoiceId: invoice.InvoiceID,
            xeroInvoiceNumber: invoice.InvoiceNumber || null,
            xeroInvoiceUrl: invoice.Url || null,
            xeroStatus: invoice.Status || 'AUTHORISED',
            status: 'invoice_created',
            lastSyncedAt: FieldValue.serverTimestamp(),
          });
          await markChargesInvoiced(item.properties.map((p) => p.propertyId).filter(Boolean));
        }
      } catch (err) {
        // Only a genuine creation failure reaches here — no real Xero
        // invoice exists for these charges, so releasing them back to
        // 'pending' for a future run to retry is exactly as safe as
        // it always was.
        console.error(`Error creating invoice for ${item.agencyName}:`, err);
        errors.push({ agencyName: item.agencyName, error: err.message, stage: 'create' });
        await itemRef.update({ status: 'error', lastError: err.message });
        await markChargesFailed(item.properties.map((p) => p.propertyId).filter(Boolean));
        continue;
      }

      // ── Step 2: attempt to email the (now definitely existing) invoice ──
      try {
        await sendInvoice(invoice.InvoiceID);
        await itemRef.update({
          status: 'sent',
          emailSentAt: FieldValue.serverTimestamp(),
          lastEmailError: null,
        });
        results.push({ agencyName: item.agencyName, invoiceNumber: invoice.InvoiceNumber, status: 'sent' });
      } catch (emailErr) {
        // The invoice already exists in Xero and these charges are
        // already 'invoiced' — a failed email is a delivery problem
        // to retry (see runs/[runId]/route.js's retrySend action),
        // never a reason to create a second invoice for the same
        // properties.
        console.error(`Error emailing invoice for ${item.agencyName}:`, emailErr);
        errors.push({ agencyName: item.agencyName, error: emailErr.message, stage: 'email' });
        await itemRef.update({
          status: 'email_failed',
          lastEmailError: emailErr.message,
          emailAttempts: (item.emailAttempts || 0) + 1,
        });
      }
    }

    // Update run status. 'partial' covers both an email-only failure
    // and a creation failure — either way, at least one item needs an
    // admin's attention before the run can be considered fully done.
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
