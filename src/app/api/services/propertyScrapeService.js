import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../firebase/adminApp';
import { generatePropertyTitleAndDescription } from './openAiService';
import { recordPropertyCharge } from './billingService';

const PROPERTY_TYPE_LABELS = ['House', 'Apartment', 'Villa', 'Townhouse', 'Acreage'];

function propertyTypeLabel(type) {
  if (typeof type === 'number' && PROPERTY_TYPE_LABELS[type]) return PROPERTY_TYPE_LABELS[type];
  if (typeof type === 'string' && type.trim()) return type;
  return 'House';
}

function isRealEstateUrl(raw) {
  try {
    const u = new URL(raw);
    return /(^|\.)realestate\.com\.au$/.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Scrape a realestate.com.au URL by calling the existing Firebase HTTP
 * function at CHECK_PROPERTY_URL. Returns the raw property schema from
 * Puppeteer (address, bedrooms, imageUrls, price, etc).
 */
export async function scrapeRealEstateUrl(url) {
  if (!isRealEstateUrl(url)) {
    throw new Error('Only realestate.com.au URLs are supported');
  }
  const endpoint = process.env.CHECK_PROPERTY_URL;
  if (!endpoint) {
    throw new Error('CHECK_PROPERTY_URL is not configured');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: url }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`check-property failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Create a new Firestore property document for `user` from the scraped
 * realestate.com.au data. Fills listing copy via OpenAI and applies the
 * project's default flags for an SMS-created premarket listing.
 *
 * Returns { propertyId, title, publicUrl, editUrl, imageCount }.
 */
export async function createPropertyFromScrape(user, scraped) {
  if (!user?.uid) throw new Error('createPropertyFromScrape: user.uid required');
  if (!scraped || typeof scraped !== 'object') throw new Error('scraped data missing');

  const typeLabel = propertyTypeLabel(scraped.propertyType);
  const agentName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null;

  // Generate title + description via shared OpenAI helper.
  // Failure here is non-fatal — we still create the listing with blank copy.
  let title = '';
  let description = '';
  try {
    const gen = await generatePropertyTitleAndDescription({
      propertyType: typeLabel,
      address: scraped.address || scraped.formattedAddress || '',
      bedrooms: scraped.bedrooms || '',
      bathrooms: scraped.bathrooms || '',
      squareFeatures: scraped.squareFootage || '',
      features: scraped.features || [],
      price: scraped.price || '',
    });
    title = gen.title || '';
    description = gen.description || '';
  } catch (err) {
    console.error('generatePropertyTitleAndDescription failed:', err);
  }

  const propertyData = {
    // Scraped fields (allow override by defaults below)
    ...scraped,

    // Identity / ownership
    userId: user.uid,
    agentId: user.agentId || null,
    agentName,
    agentAvatar: user.avatar || user.photoURL || null,

    // Lifecycle / visibility — SMS-created listings start as premarket drafts
    listingStatus: 'premarket',
    isEager: 1, // Serious default
    active: true,
    visibility: false, // private until agent publishes from the dashboard
    acceptingOffers: false,

    // Flags
    agent: true,
    agentManaged: true,
    vendorUploaded: false,

    // Generated copy
    title,
    description,

    // Stats + timestamps
    stats: { views: 0 },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),

    // Provenance so we can trace SMS-created listings later
    source: 'sms',
  };

  const ref = await adminDb.collection('properties').add(propertyData);

  // Billable the moment it exists — its private buyer link (publicUrl
  // below) is live from this same instant, regardless of the
  // visibility:false default above (that only controls the separate
  // public /listings page, not this property's own direct link).
  await recordPropertyCharge({ id: ref.id, ...propertyData });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://premarket.homes';
  const publicUrl = `${baseUrl}/find-property?propertyId=${ref.id}`;
  const editUrl = `${baseUrl}/dashboard/edit/${ref.id}`;

  return {
    propertyId: ref.id,
    title: title || scraped.address || 'New premarket listing',
    publicUrl,
    editUrl,
    imageCount: Array.isArray(scraped.imageUrls) ? scraped.imageUrls.length : 0,
  };
}
