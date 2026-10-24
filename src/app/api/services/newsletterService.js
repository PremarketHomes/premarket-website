import { adminDb } from '../../firebase/adminApp';
import { sendEmail } from './resendService';
import { wrapEmail, greeting, p, signature, BASE_URL } from './emailTemplates';
import { Timestamp } from 'firebase-admin/firestore';
import { formatPriceShort } from '../../utils/formatters';

export async function fetchBuyersWithPreferences() {
  const usersSnapshot = await adminDb
    .collection('users')
    .where('buyer', '==', true)
    .where('buyerPreferences.notifyNewProperties', '==', true)
    .get();

  const buyers = [];
  usersSnapshot.forEach((doc) => {
    const data = doc.data();
    if (data.unsubscribed === true) return;
    buyers.push({
      id: doc.id,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      preferences: {
        locations: data.buyerPreferences?.locations || [],
        propertyType: data.buyerPreferences?.propertyType || null,
        minBedrooms: data.buyerPreferences?.minBedrooms || null,
        minBudget: data.buyerPreferences?.minBudget || null,
        maxBudget: data.buyerPreferences?.maxBudget || null,
      },
    });
  });
  return buyers;
}

export async function fetchNewestProperties(limit = 10) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const propertiesSnapshot = await adminDb
    .collection('properties')
    .where('active', '==', true)
    .where('visibility', '==', true)
    .where('created', '>=', Timestamp.fromDate(oneWeekAgo))
    .orderBy('created', 'desc')
    .limit(limit)
    .get();

  return propertiesSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title || 'Untitled Property',
      address: data.address || '',
      suburb: data.location?.suburb || '',
      showSuburbOnly: data.showSuburbOnly || false,
      bedrooms: data.bedrooms || null,
      bathrooms: data.bathrooms || null,
      carSpaces: data.carSpaces || null,
      price: data.price || null,
      imageUrl: data.imageUrls?.[0] || null,
      created: data.created?.toDate() || new Date(),
    };
  });
}

function formatPrice(price) {
  const result = formatPriceShort(price);
  return result === '--' ? 'Price on Application' : result;
}

function getDisplayAddress(property) {
  if (property.showSuburbOnly) {
    return property.address?.split(',')[1]?.trim() || property.suburb || 'Australia';
  }
  return property.address || property.suburb || 'Australia';
}

export function matchPropertiesToBuyer(buyer, properties) {
  const { preferences } = buyer;
  return properties.filter((property) => {
    if (preferences.locations?.length > 0) {
      const propertySuburb = property.suburb?.toLowerCase();
      const matchesLocation = preferences.locations.some((loc) =>
        propertySuburb?.includes(loc.toLowerCase())
      );
      if (!matchesLocation) return false;
    }
    if (preferences.minBedrooms && property.bedrooms) {
      if (property.bedrooms < preferences.minBedrooms) return false;
    }
    const propertyPrice = parsePrice(property.price);
    if (propertyPrice) {
      if (preferences.minBudget && propertyPrice < preferences.minBudget) return false;
      if (preferences.maxBudget && propertyPrice > preferences.maxBudget) return false;
    }
    return true;
  });
}

function propertyCardHTML(property) {
  const specs = [
    property.bedrooms ? `${property.bedrooms} Bed` : '',
    property.bathrooms ? `${property.bathrooms} Bath` : '',
    property.carSpaces ? `${property.carSpaces} Car` : '',
  ].filter(Boolean).join(' &bull; ');

  const timeAgo = property.created
    ? `${Math.max(1, Math.floor((Date.now() - property.created.getTime()) / (1000 * 60 * 60 * 24)))}d ago`
    : '';

  return `
  <tr><td style="padding:0 0 16px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td>${property.imageUrl
        ? `<img src="${property.imageUrl}" alt="${property.title}" width="100%" height="200" style="display:block; object-fit:cover;" />`
        : `<div style="width:100%; height:200px; background:#e2e8f0;"></div>`
      }</td></tr>
      <tr><td style="padding:18px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td>
            <h3 style="margin:0 0 6px 0; font-size:17px; font-weight:700; color:#1a1a2e;">
              <a href="${BASE_URL}/find-property?propertyId=${property.id}" style="color:#1a1a2e; text-decoration:none;">${property.title}</a>
            </h3>
          </td></tr>
          <tr><td style="padding:2px 0;">
            <p style="margin:0; font-size:13px; color:#6b7280;">${getDisplayAddress(property)}${timeAgo ? ` &bull; <span style="color:#f97316; font-weight:600;">${timeAgo}</span>` : ''}</p>
          </td></tr>
          ${specs ? `<tr><td style="padding:6px 0 0 0;"><p style="margin:0; font-size:12px; color:#9ca3af; letter-spacing:0.5px;">${specs}</p></td></tr>` : ''}
          <tr><td style="padding-top:12px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td><span style="font-size:18px; font-weight:800; color:#f97316;">${formatPrice(property.price)}</span></td>
                <td align="right"><a href="${BASE_URL}/find-property?propertyId=${property.id}" style="display:inline-block; padding:8px 18px; background-color:#1a1a2e; color:#ffffff; text-decoration:none; border-radius:8px; font-size:12px; font-weight:600;">View</a></td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>`;
}

export function generateNewsletterHTML(buyer, properties) {
  const propertyCount = properties.length;

  const bodyHTML = `
    ${greeting(buyer.firstName)}
    ${p(`Your exclusive weekly preview of <strong>${propertyCount} new pre-market propert${propertyCount === 1 ? 'y' : 'ies'}</strong> is here. <span style="color:#f97316; font-weight:600;">You're seeing them first!</span>`)}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
      <tr><td style="padding-bottom:16px;">
        <h2 style="margin:0; font-size:20px; font-weight:700; color:#1a1a2e;">Latest Listings</h2>
        <p style="margin:4px 0 0 0; font-size:13px; color:#6b7280;">Newest first — just added this week</p>
      </td></tr>
      ${properties.map((prop) => propertyCardHTML(prop)).join('')}
    </table>

    ${signature()}
  `;

  return wrapEmail({
    previewText: `${propertyCount} new pre-market propert${propertyCount === 1 ? 'y' : 'ies'} this week`,
    bodyHTML,
    recipientEmail: buyer.email,
    reason: "You're receiving this because you signed up for property alerts on Premarket.",
  });
}

async function sendNewsletterEmail(buyer, properties) {
  const html = generateNewsletterHTML(buyer, properties);
  return sendEmail({
    to: buyer.email,
    subject: `${properties.length} New Pre-Market Propert${properties.length === 1 ? 'y' : 'ies'} This Week`,
    html,
  });
}

export async function sendWeeklyBuyerNewsletters() {
  const [buyers, newestProperties] = await Promise.all([
    fetchBuyersWithPreferences(),
    fetchNewestProperties(10),
  ]);

  if (newestProperties.length === 0) {
    return { sent: 0, skipped: buyers.length, errors: 0 };
  }

  const results = { sent: 0, skipped: 0, errors: 0 };

  for (const buyer of buyers) {
    try {
      const matched = matchPropertiesToBuyer(buyer, newestProperties);
      // Show matched properties if any, otherwise show all newest
      const buyerProperties = matched.length > 0 ? matched : newestProperties;

      if (buyerProperties.length === 0) {
        results.skipped++;
        continue;
      }

      await sendNewsletterEmail(buyer, buyerProperties);
      results.sent++;
    } catch (error) {
      console.error(`Failed to send newsletter to ${buyer.email}:`, error);
      results.errors++;
    }
  }

  return results;
}
