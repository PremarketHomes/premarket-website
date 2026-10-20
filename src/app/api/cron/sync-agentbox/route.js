import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyCron } from '../../middleware/auth';
import { fetchListings, mapListingToProperty, syncContacts, updateSyncStatus } from '../../services/agentboxService';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 300;

export async function GET(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Find all users with connected Agentbox integrations
    const usersSnapshot = await adminDb.collection('users')
      .where('integrations.agentbox.status', '==', 'connected')
      .where('integrations.agentbox.autoSync', '==', true)
      .get();

    if (usersSnapshot.empty) {
      return NextResponse.json({ success: true, message: 'No connected agents', agents: 0 });
    }

    const results = [];

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const creds = userDoc.data()?.integrations?.agentbox;

      if (!creds?.clientId || !creds?.apiKey) continue;

      const agentResult = { userId, listings: 0, contacts: 0, errors: [] };

      try {
        // Use lastSync for incremental sync
        const syncOptions = {};
        if (creds.lastSync) {
          const lastSyncDate = creds.lastSync.toDate ? creds.lastSync.toDate() : new Date(creds.lastSync);
          syncOptions.modifiedAfter = lastSyncDate.toISOString();
        }

        // Sync listings
        const data = await fetchListings(creds.clientId, creds.apiKey, {
          limit: 100,
          modifiedAfter: syncOptions.modifiedAfter,
        });
        const listings = data?.response?.listings || data?.listings || data?.response || [];
        const listingsArray = Array.isArray(listings) ? listings : [];

        const propsSnapshot = await adminDb.collection('properties')
          .where('userId', '==', userId)
          .where('source', '==', 'agentbox')
          .get();

        const existingByListingId = {};
        propsSnapshot.docs.forEach((doc) => {
          const propData = doc.data();
          const listingId = propData.integrations?.agentbox?.listingId;
          if (listingId) existingByListingId[listingId] = { id: doc.id, ...propData };
        });

        for (const listing of listingsArray) {
          const listingId = String(listing.id);
          const existing = existingByListingId[listingId];

          if (!existing || !existing.integrations?.agentbox?.syncEnabled) continue;

          try {
            const mapped = mapListingToProperty(listing, userId);
            await adminDb.collection('properties').doc(existing.id).update({
              formattedAddress: mapped.formattedAddress,
              address: mapped.address,
              location: mapped.location,
              price: mapped.price,
              bedrooms: mapped.bedrooms,
              bathrooms: mapped.bathrooms,
              carSpaces: mapped.carSpaces,
              squareFootage: mapped.squareFootage,
              title: mapped.title,
              description: mapped.description,
              imageUrls: mapped.imageUrls,
              features: mapped.features,
              'integrations.agentbox.lastSynced': new Date(),
              'integrations.agentbox.originalData': listing,
              updatedAt: FieldValue.serverTimestamp(),
            });
            agentResult.listings++;
          } catch (err) {
            agentResult.errors.push({ type: 'listing', id: listingId, error: err.message });
          }
        }

        // Sync contacts
        try {
          const contactResult = await syncContacts(userId, creds.clientId, creds.apiKey, syncOptions);
          agentResult.contacts = contactResult.synced;
          if (contactResult.errors.length > 0) {
            agentResult.errors.push(...contactResult.errors.map(e => ({ type: 'contact', ...e })));
          }
        } catch (err) {
          console.error(`Contact sync failed for agent ${userId}:`, err);
          agentResult.errors.push({ type: 'contacts', error: err.message });
        }

        await updateSyncStatus(userId, agentResult.errors.length === 0 ? 'success' : 'partial', agentResult.errors);
      } catch (err) {
        console.error(`Sync failed for agent ${userId}:`, err);
        agentResult.errors.push({ type: 'general', error: err.message });
        await updateSyncStatus(userId, 'error', [{ error: err.message }]);
      }

      results.push(agentResult);
    }

    return NextResponse.json({
      success: true,
      agents: results.length,
      results,
    });
  } catch (err) {
    console.error('Agentbox cron sync error:', err);
    return NextResponse.json({ error: 'Cron sync failed' }, { status: 500 });
  }
}
