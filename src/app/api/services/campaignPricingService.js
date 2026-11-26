/**
 * Office RETAIL campaign pricing — display and terms only.
 *
 * Some offices (currently Harcourts Property Hub) are charged the
 * wholesale price by Premarket (settings/invoicing.pricePerListing,
 * used by billingService) but show their own agents and vendors a
 * different retail price. That retail price lives on the server-only
 * `officeAdminInfo/{officeId}.retailCampaignPrice` field. Nothing in
 * the billing path reads it, and this module never reads
 * settings/invoicing — so the wholesale figure can't reach, or be
 * changed by, anything here.
 *
 * Who pays the retail fee is stated per office by the optional
 * `officeAdminInfo/{officeId}.retailCampaignPayer` field (also
 * display and terms only; it never changes who Premarket bills,
 * which is always the agency):
 *   absent / 'vendor'   the vendor, through the agency (the original
 *                       wording, unchanged for any office that doesn't
 *                       set the field)
 *   'agent_or_vendor'   either the agent or the vendor, through the
 *                       agency, and the price is stated as the total
 *                       (Harcourts Property Hub, $199, approved Nov 2026)
 * Any other value fails closed (no figure is shown rather than a
 * possibly wrong one).
 */

import { adminDb } from '../../firebase/adminApp';

const BASE_TERMS_DOC = 'addPropertyTermsAgent';

// Words that must never appear in what an office-retail agent is shown.
const FORBIDDEN_IN_RETAIL_TEXT = [/\$\s?200\b/, /\$\s?149\b/, /GST/i, /invoice/i];

export const RETAIL_PAYER_VENDOR = 'vendor';
export const RETAIL_PAYER_AGENT_OR_VENDOR = 'agent_or_vendor';
const RETAIL_PAYERS = [RETAIL_PAYER_VENDOR, RETAIL_PAYER_AGENT_OR_VENDOR];

/** The office's stated payer: 'vendor' when unset; throws on an unknown value (fail closed). */
export function retailPayerOf(office) {
  const payer = office?.retailCampaignPayer;
  if (payer === undefined || payer === null) return RETAIL_PAYER_VENDOR;
  if (!RETAIL_PAYERS.includes(payer)) throw new Error('Unknown retailCampaignPayer');
  return payer;
}

function retailPaymentSection(price, payer = RETAIL_PAYER_VENDOR) {
  const either = payer === RETAIL_PAYER_AGENT_OR_VENDOR;
  return [
    '6. Payment Terms',
    either
      ? `Campaign Fee: The Premarket campaign fee is $${price} AUD in total per campaign.`
      : `Campaign Fee: The Premarket campaign fee is $${price} AUD per campaign.`,
    either
      ? "Agent or Vendor Paid: The campaign fee is payable by either the agent or the vendor (Seller), through the agent's agency."
      : "Vendor Paid: The campaign fee is payable by the vendor (Seller) through the agent's agency.",
    'Charge Trigger: The campaign fee applies upon successful submission of the property and remains payable if the listing is subsequently withdrawn, archived or changes status.',
    '',
    '',
  ].join('\n');
}

/**
 * Swap section 6 (Payment Terms) of the standard agent terms for the
 * retail wording. Throws rather than returning partially-replaced
 * text, so a changed terms layout disables submission instead of
 * showing the wrong figure.
 */
export function buildRetailTerms(baseBody, price, payer = RETAIL_PAYER_VENDOR) {
  const normalised = String(baseBody || '').replace(/\\n/g, '\n');
  const sectionPattern = /^6\. Payment Terms\n[\s\S]*?(?=^7\. )/m;
  if (!sectionPattern.test(normalised)) {
    throw new Error('Payment Terms section not found in base terms');
  }
  const text = normalised.replace(sectionPattern, retailPaymentSection(price, payer));
  for (const pattern of FORBIDDEN_IN_RETAIL_TEXT) {
    if (pattern.test(text)) throw new Error('Retail terms contain disallowed wording');
  }
  return text;
}

/**
 * Returns { retail: false } for agents with no office, or an office
 * with no retail price (they keep the standard flow unchanged), or
 * { retail: true, price, payer, terms } for an active office with one.
 */
export async function getRetailCampaignPricing(uid) {
  const userDoc = await adminDb.collection('users').doc(uid).get();
  const officeId = userDoc.exists ? userDoc.data().officeId : null;
  if (!officeId) return { retail: false };

  const officeDoc = await adminDb.collection('officeAdminInfo').doc(officeId).get();
  if (!officeDoc.exists) return { retail: false };
  const office = officeDoc.data();
  const price = office.retailCampaignPrice;
  if (office.status !== 'active' || !Number.isInteger(price) || price <= 0) {
    return { retail: false };
  }

  const payer = retailPayerOf(office);
  const baseDoc = await adminDb.collection('settings').doc(BASE_TERMS_DOC).get();
  const terms = buildRetailTerms(baseDoc.exists ? baseDoc.data().body : '', price, payer);
  return { retail: true, price, payer, terms };
}
