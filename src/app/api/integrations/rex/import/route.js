import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../api/middleware/auth';
import { getCredentials, fetchListingById, mapRexListingToProperty } from '../../../../api/services/rexService';
import { DEMO_LISTINGS } from '../../../../api/services/rexDemoData';
import { adminDb } from '../../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { createPropertyAndChargeAtomically } from '../../../../api/services/billingService';

export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const uid = auth.uid;

    const { listingIds } = await request.json();

    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return NextResponse.json({ error: 'Missing listingIds' }, { status: 400 });
    }

    if (listingIds.length > 20) {
      return NextResponse.json({ error: 'Maximum 20 listings per import' }, { status: 400 });
    }

    // Get stored credentials
    const creds = await getCredentials(uid);
    if (!creds || creds.status !== 'connected') {
      return NextResponse.json({ error: 'Not connected to Rex' }, { status: 400 });
    }

    const isDemo = creds.mode === 'demo';

    // Index demo listings by id for quick lookup
    const demoListingsMap = {};
    if (isDemo) {
      for (const dl of DEMO_LISTINGS) {
        demoListingsMap[String(dl.id)] = dl;
      }
    }

    // Check which listings are already imported
    const existingSnapshot = await adminDb.collection('properties')
      .where('userId', '==', uid)
      .where('source', '==', 'rex')
      .get();

    const existingListingIds = new Set();
    existingSnapshot.docs.forEach((doc) => {
      const listingId = doc.data().integrations?.rex?.listingId;
      if (listingId) existingListingIds.add(listingId);
    });

    const results = [];
    const errors = [];

    for (const listingId of listingIds) {
      try {
        // Skip already imported
        if (existingListingIds.has(String(listingId))) {
          results.push({ listingId, status: 'skipped', reason: 'Already imported' });
          continue;
        }

        let listing;

        if (isDemo) {
          listing = demoListingsMap[String(listingId)];
        } else {
          const listingData = await fetchListingById(creds.accessToken, listingId);
          listing = listingData?.result || listingData?.response || listingData;
        }

        if (!listing) {
          errors.push({ listingId, error: 'Listing not found' });
          continue;
        }

        // Map to Premarket property
        const propertyData = mapRexListingToProperty(listing, uid);

        // Creates the property and its charge in one transaction — no
        // gap where the property exists but never got charged. Demo-
        // mode imports are sample data, not a real listing, so they
        // skip the charge entirely (still created normally).
        const { propertyId } = await createPropertyAndChargeAtomically(propertyData, { skipCharge: isDemo });

        // Create draft backup
        await adminDb.collection('draftProperties').doc(propertyId).set({
          ...propertyData,
          override: true,
          createdAt: FieldValue.serverTimestamp(),
        });

        results.push({
          listingId,
          status: 'imported',
          propertyId,
        });
      } catch (err) {
        console.error(`Error importing Rex listing ${listingId}:`, err);
        errors.push({ listingId, error: err.message });
      }
    }

    // Update sync status
    await adminDb.collection('users').doc(uid).update({
      'integrations.rex.lastSync': FieldValue.serverTimestamp(),
      'integrations.rex.lastSyncStatus': errors.length === 0 ? 'success' : 'partial',
    });

    return NextResponse.json({
      success: true,
      imported: results.filter(r => r.status === 'imported').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: errors.length,
      results,
      errorDetails: errors,
    });
  } catch (err) {
    console.error('Rex import error:', err);
    return NextResponse.json({ error: 'Failed to import listings' }, { status: 500 });
  }
}
