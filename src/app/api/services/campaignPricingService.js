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
 */

import { adminDb } from '../../firebase/adminApp';

const BASE_TERMS_DOC = 'addPropertyTermsAgent';

// Words that must never appear in what an office-retail agent is shown.
const FORBIDDEN_IN_RETAIL_TEXT = [/\$\s?200\b/, /\$\s?149\b/, /GST/i, /invoice/i];

function retailPaymentSection(price) {
  return [
    '6. Payment Terms',
    `Campaign Fee: The Premarket campaign fee is $${price} AUD per campaign.`,
    "Vendor Paid: The campaign fee is payable by the vendor (Seller) through the agent's agency.",
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
export function buildRetailTerms(baseBody, price) {
  const normalised = String(baseBody || '').replace(/\\n/g, '\n');
  const sectionPattern = /^6\. Payment Terms\n[\s\S]*?(?=^7\. )/m;
  if (!sectionPattern.test(normalised)) {
    throw new Error('Payment Terms section not found in base terms');
  }
  const text = normalised.replace(sectionPattern, retailPaymentSection(price));
  for (const pattern of FORBIDDEN_IN_RETAIL_TEXT) {
    if (pattern.test(text)) throw new Error('Retail terms contain disallowed wording');
  }
  return text;
}

/**
 * Returns { retail: false } for agents with no office, or an office
 * with no retail price (they keep the standard flow unchanged), or
 * { retail: true, price, terms } for an active office with one.
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

  const baseDoc = await adminDb.collection('settings').doc(BASE_TERMS_DOC).get();
  const terms = buildRetailTerms(baseDoc.exists ? baseDoc.data().body : '', price);
  return { retail: true, price, terms };
}
