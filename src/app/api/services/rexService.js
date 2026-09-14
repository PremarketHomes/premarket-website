import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';

// Rex uses OAuth2 Client Credentials (Bearer token)
// Placeholder base URL — update when real Rex API docs are available
const REX_API_BASE = 'https://api.rexsoftware.com/v1/rex';

/**
 * Make an authenticated request to the Rex API.
 * Rex uses Bearer token auth (OAuth2 Client Credentials flow).
 */
async function rexFetch(path, token, params = {}) {
  const url = new URL(`${REX_API_BASE}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Rex API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Exchange Rex client credentials for a Bearer token.
 * Placeholder implementation — swap when real Rex OAuth docs arrive.
 */
export async function getAccessToken(clientId, clientSecret) {
  // Placeholder: In production, this would POST to Rex's OAuth token endpoint
  // e.g. POST https://api.rexsoftware.com/oauth/token
  // with grant_type=client_credentials, client_id, client_secret
  const response = await fetch(`${REX_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Rex auth failed (${response.status})`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
  };
}

/**
 * Validate Rex credentials by attempting to fetch offices/account info.
 * Returns offices list if valid, throws if invalid.
 */
export async function validateCredentials(clientId, clientSecret) {
  try {
    const { accessToken } = await getAccessToken(clientId, clientSecret);
    const data = await rexFetch('/account-users', accessToken);
    return { valid: true, accessToken, offices: data?.result || data?.response || [] };
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('403')) {
      return { valid: false, error: 'Invalid credentials' };
    }
    throw err;
  }
}

/**
 * Fetch listings from Rex with optional filters.
 */
export async function fetchListings(token, options = {}) {
  const params = {};
  if (options.page) params.page = options.page;
  if (options.limit) params.limit = options.limit;
  if (options.status) params.status = options.status;
  if (options.officeId) params.office_id = options.officeId;

  const data = await rexFetch('/listings', token, params);
  return data;
}

/**
 * Fetch a single listing by ID.
 */
export async function fetchListingById(token, listingId) {
  const data = await rexFetch(`/listings/${listingId}`, token);
  return data;
}

/**
 * Fetch contacts from Rex.
 */
export async function fetchContacts(token, options = {}) {
  const params = {};
  if (options.page) params.page = options.page;
  if (options.limit) params.limit = options.limit;

  const data = await rexFetch('/contacts', token, params);
  return data;
}

/**
 * Map a Rex contact to a rexContacts document.
 */
export function mapContactToDocument(contact, agentUserId) {
  const contactType = (contact.type || contact.contact_type || '').toLowerCase();

  return {
    agentUserId,
    rexContactId: String(contact.id),
    firstName: contact.first_name || contact.firstName || '',
    lastName: contact.last_name || contact.lastName || '',
    email: contact.email || contact.email_address || '',
    phone: contact.phone || contact.mobile || contact.phone_number || '',
    address: {
      street: contact.address?.street || contact.street_address || '',
      suburb: contact.address?.suburb || contact.suburb || '',
      state: contact.address?.state || contact.state || '',
      postcode: contact.address?.postcode || contact.postcode || '',
    },
    type: contactType || 'buyer',
    source: 'rex',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastSynced: new Date(),
  };
}

/**
 * Sync all contacts for a connected Rex agent.
 */
export async function syncContacts(userId, token, options = {}) {
  let page = 1;
  const limit = 100;
  let allContacts = [];
  let hasMore = true;

  while (hasMore) {
    const data = await fetchContacts(token, { page, limit });
    const contacts = data?.result?.rows || data?.result || data?.response?.contacts || data?.contacts || [];
    const contactsArray = Array.isArray(contacts) ? contacts : [];

    allContacts = allContacts.concat(contactsArray);

    const totalPages = data?.result?.total_pages || data?.totalPages || 1;
    hasMore = page < totalPages && contactsArray.length === limit;
    page++;
  }

  let synced = 0;
  const errors = [];

  for (const contact of allContacts) {
    try {
      const docData = mapContactToDocument(contact, userId);
      const docId = `${userId}_rex_${contact.id}`;

      const existingDoc = await adminDb.collection('rexContacts').doc(docId).get();
      if (existingDoc.exists) {
        delete docData.createdAt;
      }

      await adminDb.collection('rexContacts').doc(docId).set(docData, { merge: true });
      synced++;
    } catch (err) {
      console.error(`Error syncing Rex contact ${contact.id}:`, err);
      errors.push({ contactId: contact.id, error: err.message });
    }
  }

  return { synced, total: allContacts.length, errors };
}

/**
 * Delete all synced Rex contacts for an agent.
 */
export async function deleteContactsForAgent(userId) {
  const snapshot = await adminDb.collection('rexContacts')
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
 * Map a Rex listing to a Premarket property document.
 */
export function mapRexListingToProperty(listing, userId) {
  // Map Rex property category to Premarket enum (1-5)
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

  const rexType = (listing.property_category || listing.type || '').toLowerCase();
  // Strip 'residential_sale' etc. — use property_category for type mapping
  const cleanType = rexType.replace('residential_', '').replace('commercial_', '');
  const propertyType = typeMap[cleanType] || 1;

  // Parse price
  let price = listing.price_match || listing.price_advertise_as || '';
  if (typeof price === 'string') {
    price = price.replace(/[^0-9.]/g, '');
  }
  price = parseFloat(price) || 0;

  // Build address from Rex property object
  const prop = listing.property || {};
  const suburb = prop.adr_suburb_or_town || '';
  const state = prop.adr_state_or_region || '';
  const postcode = prop.adr_postcode || '';
  const street = [prop.adr_unit_number, prop.adr_street_number, prop.adr_street_name]
    .filter(Boolean).join(' ');
  const formattedAddress = [street, suburb, state, postcode].filter(Boolean).join(', ');

  // Extract features
  const features = [];
  const featureList = listing.features || [];
  if (Array.isArray(featureList)) {
    features.push(...featureList.map(f => typeof f === 'string' ? f : f.name || '').filter(Boolean));
  }

  return {
    formattedAddress,
    address: [suburb, state].filter(Boolean).join(', '),
    location: {
      suburb,
      state,
      postcode,
      latitude: prop.adr_latitude || null,
      longitude: prop.adr_longitude || null,
    },
    propertyType,
    price: price || null,
    bedrooms: parseInt(listing.attr_bedrooms) || null,
    bathrooms: parseInt(listing.attr_bathrooms) || null,
    carSpaces: parseInt(listing.attr_garages || listing.attr_carspaces) || null,
    squareFootage: parseFloat(listing.attr_land_area) || null,
    title: listing.headline || listing.heading || formattedAddress,
    description: listing.description || '',
    imageUrls: (listing.images || listing.photos || []).map(img =>
      typeof img === 'string' ? img : (img.uri || img.url || img.original || img.large || '')
    ).filter(Boolean),
    features,

    userId,
    agent: true,
    agentManaged: true,
    active: true,
    visibility: false,
    acceptingOffers: false,
    offPlan: false,
    isEager: 1,
    wantsPremiumListing: false,

    source: 'rex',
    integrations: {
      rex: {
        listingId: String(listing.id),
        lastSynced: new Date(),
        syncEnabled: true,
        originalData: listing,
      },
    },

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
 * Store Rex integration credentials for a user. Also clears any legacy
 * copy left on the (publicly-readable) users document, so any agent who
 * (re)connects is immediately fully migrated off the exposed location.
 */
export async function storeCredentials(userId, clientId, clientSecret, meta = {}) {
  await adminDb.collection(CREDENTIALS_COLLECTION).doc(userId).set({
    rex: {
      clientId,
      clientSecret,
      accessToken: meta.accessToken || null,
      tokenExpiry: meta.tokenExpiry || null,
      status: 'connected',
      mode: meta.mode || 'real',
      connectedAt: FieldValue.serverTimestamp(),
      lastSync: null,
      lastSyncStatus: null,
      autoSync: true,
      offices: meta.offices || [],
    },
  }, { merge: true });

  await clearLegacyUsersField(userId, 'rex');
}

/**
 * Remove Rex integration credentials for a user.
 */
export async function removeCredentials(userId) {
  await adminDb.collection(CREDENTIALS_COLLECTION).doc(userId).set({
    rex: {
      status: 'disconnected',
      clientId: null,
      clientSecret: null,
      accessToken: null,
      tokenExpiry: null,
      disconnectedAt: FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  await clearLegacyUsersField(userId, 'rex');
}

/**
 * Get stored Rex credentials for a user. Reads the secure collection
 * first; if nothing's there yet (not migrated off the legacy location),
 * falls back to the old `users/{uid}.integrations.rex` field so existing
 * connected agents keep working without interruption until migrated.
 * This fallback read is server-side (Admin SDK) only — it does not
 * reintroduce any client/public exposure.
 */
export async function getCredentials(userId) {
  const credDoc = await adminDb.collection(CREDENTIALS_COLLECTION).doc(userId).get();
  const fromSecureLocation = credDoc.exists ? credDoc.data()?.rex : null;
  if (fromSecureLocation) return fromSecureLocation;

  const userDoc = await adminDb.collection('users').doc(userId).get();
  if (!userDoc.exists) return null;
  return userDoc.data()?.integrations?.rex || null;
}

/**
 * Update Rex sync status for a user.
 */
export async function updateSyncStatus(userId, status, errors = []) {
  await adminDb.collection(CREDENTIALS_COLLECTION).doc(userId).set({
    rex: {
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
