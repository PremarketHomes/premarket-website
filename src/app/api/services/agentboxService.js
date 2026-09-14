import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';

const AGENTBOX_API_BASE = 'https://api.agentboxcrm.com.au';
const AGENTBOX_API_VERSION = '2';

/**
 * Make an authenticated request to the Agentbox API.
 * The legacy Agentbox API uses client_id + api_key query params.
 */
async function agentboxFetch(path, clientId, apiKey, params = {}) {
  const url = new URL(`${AGENTBOX_API_BASE}${path}`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('version', AGENTBOX_API_VERSION);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agentbox API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Validate Agentbox credentials by fetching offices.
 * Returns the offices list if valid, throws if invalid.
 */
export async function validateCredentials(clientId, apiKey) {
  try {
    const data = await agentboxFetch('/offices', clientId, apiKey);
    return { valid: true, offices: data?.response || data };
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('403')) {
      return { valid: false, error: 'Invalid credentials' };
    }
    throw err;
  }
}

/**
 * Fetch listings from Agentbox with optional filters.
 */
export async function fetchListings(clientId, apiKey, options = {}) {
  const params = {};
  if (options.page) params.page = options.page;
  if (options.limit) params.limit = options.limit;
  if (options.status) params['filter[status]'] = options.status;
  if (options.officeId) params['filter[officeId]'] = options.officeId;
  if (options.modifiedAfter) params.modifiedAfter = options.modifiedAfter;

  const data = await agentboxFetch('/listings', clientId, apiKey, params);
  return data;
}

/**
 * Fetch a single listing by ID.
 */
export async function fetchListingById(clientId, apiKey, listingId) {
  const data = await agentboxFetch(`/listings/${listingId}`, clientId, apiKey);
  return data;
}

/**
 * Fetch contacts from Agentbox.
 */
export async function fetchContacts(clientId, apiKey, options = {}) {
  const params = {};
  if (options.page) params.page = options.page;
  if (options.limit) params.limit = options.limit;
  if (options.modifiedAfter) params.modifiedAfter = options.modifiedAfter;

  const data = await agentboxFetch('/contacts', clientId, apiKey, params);
  return data;
}

/**
 * Fetch search requirements for a contact from Agentbox.
 */
export async function fetchSearchRequirements(clientId, apiKey, contactId) {
  const data = await agentboxFetch(`/contacts/${contactId}/search-requirements`, clientId, apiKey);
  return data?.response?.searchRequirements || data?.searchRequirements || data?.response || [];
}

/**
 * Map an Agentbox contact + search requirements to an agentboxContacts document.
 */
export function mapContactToDocument(contact, agentUserId, searchRequirements = []) {
  const mappedRequirements = (Array.isArray(searchRequirements) ? searchRequirements : []).map(req => ({
    propertyType: req.propertyType || req.type || null,
    bedroomsMin: parseInt(req.bedroomsMin || req.bedrooms?.min) || null,
    bedroomsMax: parseInt(req.bedroomsMax || req.bedrooms?.max) || null,
    priceMin: parseFloat(req.priceMin || req.price?.min) || null,
    priceMax: parseFloat(req.priceMax || req.price?.max) || null,
    suburbs: req.suburbs || req.locations || [],
    state: req.state || null,
  }));

  const contactType = (contact.type || contact.contactType || '').toLowerCase();

  return {
    agentUserId,
    agentboxContactId: String(contact.id),
    firstName: contact.firstName || contact.first_name || '',
    lastName: contact.lastName || contact.last_name || '',
    email: contact.email || contact.emailAddress || '',
    phone: contact.phone || contact.mobile || contact.phoneNumber || '',
    address: {
      street: contact.streetAddress || contact.address?.street || '',
      suburb: contact.suburb || contact.address?.suburb || '',
      state: contact.state || contact.address?.state || '',
      postcode: contact.postcode || contact.address?.postcode || '',
    },
    type: contactType || 'buyer',
    searchRequirements: mappedRequirements,
    source: 'agentbox',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastSynced: new Date(),
  };
}

/**
 * Sync all contacts for a connected agent.
 * Fetches contacts with pagination, fetches search requirements, upserts into agentboxContacts.
 */
export async function syncContacts(userId, clientId, apiKey, options = {}) {
  let page = 1;
  const limit = 100;
  let allContacts = [];
  let hasMore = true;

  // Paginate through all contacts
  while (hasMore) {
    const fetchOpts = { page, limit };
    if (options.modifiedAfter) fetchOpts.modifiedAfter = options.modifiedAfter;

    const data = await fetchContacts(clientId, apiKey, fetchOpts);
    const contacts = data?.response?.contacts || data?.contacts || data?.response || [];
    const contactsArray = Array.isArray(contacts) ? contacts : [];

    allContacts = allContacts.concat(contactsArray);

    // Check if there are more pages
    const totalPages = data?.response?.totalPages || data?.totalPages || 1;
    hasMore = page < totalPages && contactsArray.length === limit;
    page++;
  }

  let synced = 0;
  const errors = [];

  for (const contact of allContacts) {
    try {
      // Fetch search requirements for this contact
      let searchReqs = [];
      try {
        searchReqs = await fetchSearchRequirements(clientId, apiKey, contact.id);
      } catch {
        // Some contacts may not have search requirements - that's fine
      }

      const docData = mapContactToDocument(contact, userId, searchReqs);
      const docId = `${userId}_${contact.id}`;

      // Check if document exists to preserve createdAt
      const existingDoc = await adminDb.collection('agentboxContacts').doc(docId).get();
      if (existingDoc.exists) {
        delete docData.createdAt;
      }

      await adminDb.collection('agentboxContacts').doc(docId).set(docData, { merge: true });
      synced++;
    } catch (err) {
      console.error(`Error syncing contact ${contact.id}:`, err);
      errors.push({ contactId: contact.id, error: err.message });
    }
  }

  return { synced, total: allContacts.length, errors };
}

/**
 * Delete all synced contacts for an agent.
 */
export async function deleteContactsForAgent(userId) {
  const snapshot = await adminDb.collection('agentboxContacts')
    .where('agentUserId', '==', userId)
    .get();

  if (snapshot.empty) return 0;

  const batchSize = 500;
  const docs = snapshot.docs;
  let deleted = 0;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = adminDb.batch();
    const chunk = docs.slice(i, i + batchSize);
    chunk.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += chunk.length;
  }

  return deleted;
}

/**
 * Fetch staff members from Agentbox.
 */
export async function fetchStaff(clientId, apiKey) {
  const data = await agentboxFetch('/staff', clientId, apiKey);
  return data;
}

/**
 * Fetch property types lookup from Agentbox.
 */
export async function fetchPropertyTypes(clientId, apiKey) {
  const data = await agentboxFetch('/property-types', clientId, apiKey);
  return data;
}

/**
 * Map an Agentbox listing to a Premarket property document.
 */
export function mapListingToProperty(listing, userId) {
  // Map Agentbox property type to Premarket enum (1-5)
  const typeMap = {
    'house': 1,
    'apartment': 2,
    'villa': 3,
    'townhouse': 4,
    'acreage': 5,
    'unit': 2,
    'flat': 2,
    'terrace': 4,
    'duplex': 4,
    'land': 5,
    'rural': 5,
  };

  const abType = (listing.type || listing.propertyType || '').toLowerCase();
  const propertyType = typeMap[abType] || 1;

  // Parse price - Agentbox may return display price as string
  let price = listing.price || listing.displayPrice || listing.searchPrice || '';
  if (typeof price === 'string') {
    price = price.replace(/[^0-9.]/g, '');
  }
  price = parseFloat(price) || 0;

  // Build address fields
  const suburb = listing.suburb || listing.address?.suburb || '';
  const state = listing.state || listing.address?.state || '';
  const postcode = listing.postcode || listing.address?.postcode || '';
  const street = listing.streetAddress || listing.address?.street ||
    [listing.unitNumber, listing.streetNumber, listing.streetName].filter(Boolean).join(' ');
  const formattedAddress = [street, suburb, state, postcode].filter(Boolean).join(', ');

  // Extract features
  const features = [];
  if (listing.pool) features.push('Pool');
  if (listing.airConditioning) features.push('Air Conditioning');
  if (listing.garage || listing.carSpaces > 0) features.push('Garage');

  return {
    // Core fields
    formattedAddress,
    address: [suburb, state].filter(Boolean).join(', '),
    location: {
      suburb,
      state,
      postcode,
      latitude: listing.latitude || listing.address?.latitude || null,
      longitude: listing.longitude || listing.address?.longitude || null,
    },
    propertyType,
    price: price || null,
    bedrooms: parseInt(listing.bedrooms) || null,
    bathrooms: parseInt(listing.bathrooms) || null,
    carSpaces: parseInt(listing.carSpaces || listing.garages || listing.parking) || null,
    squareFootage: parseFloat(listing.landArea || listing.landSize) || null,
    title: listing.headline || listing.heading || listing.title || formattedAddress,
    description: listing.description || listing.body || '',
    imageUrls: (listing.images || listing.photos || []).map(img =>
      typeof img === 'string' ? img : (img.url || img.original || img.large || img.medium || '')
    ).filter(Boolean),
    features,

    // Ownership & status
    userId,
    agent: true,
    agentManaged: true,
    active: true,
    visibility: false, // Start as draft - agent explicitly enables
    acceptingOffers: false,
    offPlan: false,
    isEager: 1,
    wantsPremiumListing: false,

    // Integration reference
    source: 'agentbox',
    integrations: {
      agentbox: {
        listingId: String(listing.id),
        lastSynced: new Date(),
        syncEnabled: true,
        originalData: listing,
      },
    },

    // Metadata
    priceHistory: [],
    showPriceRange: false,
    stats: { views: 0 },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

// Credentials live in the server-only `integrationCredentials` collection
// (allow read, write: if false in firestore.rules) — never on the `users`
// document, which is publicly readable and was being fetched in full by
// ordinary public property-page loads (see security audit, Finding 3).
const CREDENTIALS_COLLECTION = 'integrationCredentials';

/**
 * Store Agentbox integration credentials for a user. Also clears any
 * legacy copy left on the (publicly-readable) users document, so any
 * agent who (re)connects is immediately fully migrated off the exposed
 * location.
 */
export async function storeCredentials(userId, clientId, apiKey, offices) {
  await adminDb.collection(CREDENTIALS_COLLECTION).doc(userId).set({
    agentbox: {
      clientId,
      apiKey,
      status: 'connected',
      connectedAt: FieldValue.serverTimestamp(),
      lastSync: null,
      lastSyncStatus: null,
      autoSync: true,
      offices: offices || [],
    },
  }, { merge: true });

  await clearLegacyUsersField(userId, 'agentbox');
}

/**
 * Remove Agentbox integration credentials for a user.
 */
export async function removeCredentials(userId) {
  await adminDb.collection(CREDENTIALS_COLLECTION).doc(userId).set({
    agentbox: {
      status: 'disconnected',
      clientId: null,
      apiKey: null,
      disconnectedAt: FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  await clearLegacyUsersField(userId, 'agentbox');
}

/**
 * Get stored credentials for a user. Reads the secure collection first;
 * if nothing's there yet (not migrated off the legacy location), falls
 * back to the old `users/{uid}.integrations.agentbox` field so existing
 * connected agents keep working without interruption until migrated.
 * This fallback read is server-side (Admin SDK) only — it does not
 * reintroduce any client/public exposure.
 */
export async function getCredentials(userId) {
  const credDoc = await adminDb.collection(CREDENTIALS_COLLECTION).doc(userId).get();
  const fromSecureLocation = credDoc.exists ? credDoc.data()?.agentbox : null;
  if (fromSecureLocation) return fromSecureLocation;

  const userDoc = await adminDb.collection('users').doc(userId).get();
  if (!userDoc.exists) return null;
  return userDoc.data()?.integrations?.agentbox || null;
}

/**
 * Update sync status for a user.
 */
export async function updateSyncStatus(userId, status, errors = []) {
  await adminDb.collection(CREDENTIALS_COLLECTION).doc(userId).set({
    agentbox: {
      lastSync: FieldValue.serverTimestamp(),
      lastSyncStatus: status,
      ...(errors.length > 0 ? { syncErrors: errors } : {}),
    },
  }, { merge: true });
}

/** Removes any legacy credential copy left on the public users document. */
async function clearLegacyUsersField(userId, key) {
  try {
    const userDoc = await adminDb.collection('users').doc(userId).get();
    if (userDoc.exists && userDoc.data()?.integrations?.[key] !== undefined) {
      await adminDb.collection('users').doc(userId).update({
        [`integrations.${key}`]: FieldValue.delete(),
      });
    }
  } catch (err) {
    // Non-fatal — the secure copy is already written; legacy cleanup can
    // be retried by the migration script if this ever fails.
    console.error(`Failed to clear legacy integrations.${key} for ${userId}:`, err);
  }
}
