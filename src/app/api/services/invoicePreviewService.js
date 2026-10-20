// Non-persisting invoice preview — demonstrates what an agency's real
// consolidated invoice will look like after a 30-day billing cycle,
// using an agent's actual historical properties, WITHOUT recording a
// propertyCharges document, creating an invoiceRuns/invoiceRunItems
// document, or calling any Xero API. This file must never import
// recordPropertyCharge, createPropertyAndChargeAtomically,
// ensureChargesForProperties, reconcileMissingCharges,
// createInvoiceRunFromPendingCharges, or xeroService — every function
// here is read + pure computation only, by design, so this preview
// can never become a second, accidental real-billing path.
//
// Reuses the exact same billing-entity resolution and amount
// computation the real system uses (billingService.js), so the
// preview's numbers are provably the same ones a real invoice would
// show — never a separately-maintained copy that could drift.

import { adminDb } from '../../firebase/adminApp';
import {
  getInvoicingSettings,
  resolveAgencyBrand,
  resolveBillingEntity,
  resolveBillingOverride,
  resolveBillingContact,
  computeChargeAmounts,
} from './billingService';
import { wrapEmail, infoBox, p, greeting, signature } from './emailTemplates';

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Builds a preview of the consolidated invoice an agent's billing
 * entity would receive, from their real current properties. Read-only:
 * three Firestore reads (user doc, two property queries) plus the
 * same read-only billing-entity resolution the real system uses.
 * Nothing is written. Returns propertyCount: 0 if the agent has no
 * properties — callers decide what that means (the route below
 * treats it as "nothing to preview").
 */
export async function buildAgencyInvoicePreview({ agentUserId }) {
  const agentDoc = await adminDb.collection('users').doc(agentUserId).get();
  if (!agentDoc.exists) {
    throw new Error('Agent account not found');
  }
  const agent = agentDoc.data();

  const [byUserId, byUid] = await Promise.all([
    adminDb.collection('properties').where('userId', '==', agentUserId).get(),
    adminDb.collection('properties').where('uid', '==', agentUserId).get(),
  ]);
  const seen = new Map();
  for (const doc of [...byUserId.docs, ...byUid.docs]) {
    seen.set(doc.id, doc.data());
  }

  const agentName = `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || 'Unknown agent';

  if (seen.size === 0) {
    return {
      agentUserId,
      agentName,
      agencyName: agent.companyName || agentName,
      billingContact: { name: agentName, email: agent.email || '' },
      properties: [],
      propertyCount: 0,
      subtotalEx: 0,
      gstAmount: 0,
      totalInc: 0,
      isTestPreview: true,
      generatedAt: new Date().toISOString(),
    };
  }

  const settings = await getInvoicingSettings();
  const override = await resolveBillingOverride(agentUserId);
  const matchedBrand = override ? null : await resolveAgencyBrand(agent);
  const entity = override || resolveBillingEntity({
    agentUserId,
    companyName: agent.companyName,
    firstName: agent.firstName,
    lastName: agent.lastName,
    matchedBrand,
  });

  const billingContact = (await resolveBillingContact(entity.billingEntityKey))
    || { name: agentName, email: agent.email || '' };

  const properties = [...seen.entries()]
    .map(([id, data]) => {
      const amounts = computeChargeAmounts(settings.pricePerListing, settings.gstRate);
      return {
        propertyId: id,
        address: data.formattedAddress || data.address || 'Unknown address',
        createdAt: data.createdAt || null,
        ...amounts,
      };
    })
    .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));

  const subtotalEx = round2(properties.reduce((sum, p) => sum + p.subtotalEx, 0));
  const gstAmount = round2(properties.reduce((sum, p) => sum + p.gstAmount, 0));
  const totalInc = round2(properties.reduce((sum, p) => sum + p.totalInc, 0));

  return {
    agentUserId,
    agentName,
    agencyName: entity.billingEntityName,
    billingEntityKey: entity.billingEntityKey,
    billingContact,
    properties,
    propertyCount: properties.length,
    pricePerListing: settings.pricePerListing,
    gstRate: settings.gstRate,
    paymentTermsDays: settings.paymentTermsDays,
    invoicePrefix: settings.invoicePrefix,
    subtotalEx,
    gstAmount,
    totalInc,
    isTestPreview: true,
    generatedAt: new Date().toISOString(),
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the preview as an email a human can review before anything
 * is ever sent. Deliberately has no payment button, no "Pay Now" CTA,
 * and no Xero online-invoice link — a test preview must never look
 * payable. The billing-enquiries line always points at
 * accounts@premarket.homes, independent of whatever address this
 * email is eventually sent from (see resendService.js — sending is a
 * separate, later step this function has no part in).
 */
export function buildTestInvoicePreviewEmail(preview) {
  const { agencyName, billingContact, properties, subtotalEx, gstAmount, totalInc, gstRate } = preview;
  const recipientEmail = billingContact?.email || '';

  const rows = properties.map((item, i) => `
    <tr>
      <td style="padding:10px 0; border-bottom:1px solid #e2e8f0; font-size:14px; color:#1a1a2e;">${i + 1}. ${escapeHtml(item.address)}</td>
      <td style="padding:10px 0; border-bottom:1px solid #e2e8f0; font-size:14px; color:#1a1a2e; text-align:right; white-space:nowrap;">$${item.totalInc.toFixed(2)}</td>
    </tr>
  `).join('');

  const bodyHTML = `
    <div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:12px; padding:16px 20px; margin:0 0 24px 0; text-align:center;">
      <p style="margin:0; font-size:15px; font-weight:800; color:#92400e; letter-spacing:0.3px;">TEST ONLY — NO PAYMENT REQUIRED</p>
      <p style="margin:6px 0 0 0; font-size:13px; color:#92400e;">This is a one-off system test of Premarket's invoicing feature. No action is necessary.</p>
    </div>
    ${greeting(billingContact?.name)}
    ${p(`This is a preview of the consolidated invoice <strong>${escapeHtml(agencyName)}</strong> will receive after a real 30-day billing cycle, built from your actual current Premarket listings.`)}
    ${infoBox(`
      <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
        <tr><td colspan="2" style="padding:0 0 10px 0; font-size:13px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Itemised Charges</td></tr>
        ${rows}
        <tr><td style="padding:14px 0 0 0; font-size:14px; color:#64748b;">Subtotal (ex GST)</td><td style="padding:14px 0 0 0; text-align:right; font-size:14px; color:#64748b;">$${subtotalEx.toFixed(2)}</td></tr>
        <tr><td style="padding:4px 0; font-size:14px; color:#64748b;">GST (${Math.round(gstRate * 100)}%)</td><td style="padding:4px 0; text-align:right; font-size:14px; color:#64748b;">$${gstAmount.toFixed(2)}</td></tr>
        <tr><td style="padding:10px 0 0 0; font-size:17px; font-weight:800; color:#1a1a2e; border-top:2px solid #1a1a2e;">Total</td><td style="padding:10px 0 0 0; text-align:right; font-size:17px; font-weight:800; color:#1a1a2e; border-top:2px solid #1a1a2e;">$${totalInc.toFixed(2)}</td></tr>
      </table>
    `)}
    ${p('No payment is required and no action is necessary — this is a test of our invoicing system only, not a real invoice.')}
    ${p(`Billing enquiries: For any questions regarding your invoice or payment, please contact <a href="mailto:accounts@premarket.homes" style="color:#0f3460; font-weight:600;">accounts@premarket.homes</a>.`)}
    ${signature()}
  `;

  return {
    subject: `[TEST] Premarket invoicing preview — ${agencyName}`,
    html: wrapEmail({
      previewText: 'TEST ONLY — a preview of your Premarket invoice. No payment required, no action necessary.',
      bodyHTML,
      recipientEmail,
      reason: "You're receiving this as part of a one-off system test of Premarket's invoicing feature.",
      // A financial document should show the actual billing entity
      // (confirmed this session as Premarket Group Pty Ltd), not the
      // consumer-facing "Premarket Australia" marketing brand every
      // other email correctly keeps using.
      orgLabel: 'Premarket Group Pty Ltd',
    }),
  };
}
