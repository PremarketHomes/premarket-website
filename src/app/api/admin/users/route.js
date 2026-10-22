import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * GET /api/admin/users
 * List all users with property counts.
 */
export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const [usersSnap, propertiesSnap] = await Promise.all([
      adminDb.collection('users').get(),
      adminDb.collection('properties').get(),
    ]);

    // Count properties per user (only active, non-archived)
    const propertyCounts = {};
    let totalViews = 0;
    let totalActiveProperties = 0;
    for (const doc of propertiesSnap.docs) {
      const data = doc.data();
      if (data.active === false || data.archived === true) continue;
      const uid = data.userId || data.uid;
      if (uid) {
        propertyCounts[uid] = (propertyCounts[uid] || 0) + 1;
      }
      totalViews += data.stats?.views || 0;
      totalActiveProperties++;
    }

    const users = usersSnap.docs.map((doc) => {
      const data = doc.data();
      const ts = data.createdAt;
      if (doc.id === usersSnap.docs[0]?.id || doc.id === usersSnap.docs[1]?.id) {
        console.log('DEBUG createdAt', doc.id, typeof ts, ts, 'toMillis?', typeof ts?.toMillis, '_seconds?', ts?._seconds, 'seconds?', ts?.seconds);
      }
      const createdAtMs = ts?.toMillis?.() ?? ts?._seconds * 1000 ?? 0;
      return {
        id: doc.id,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        email: data.email || '',
        photoURL: data.photoURL || null,
        isAgent: data.isAgent || false,
        isBuyer: data.isBuyer || false,
        pro: data.pro || false,
        superAdmin: data.superAdmin || false,
        propertyCount: propertyCounts[doc.id] || 0,
        createdAt: data.createdAt || null,
        createdAtMs,
        apiAccess: data.apiAccess || null,
        unsubscribed: data.unsubscribed || false,
      };
    });

    // Sort newest first
    users.sort((a, b) => b.createdAtMs - a.createdAtMs);

    return NextResponse.json({
      users,
      totalProperties: totalActiveProperties,
      totalViews,
    });
  } catch (err) {
    console.error('Admin users GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/users
 * Update user fields. Body: { targetUid, updates }
 */
export async function PATCH(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { targetUid, updates } = await request.json();

    if (!targetUid || !updates) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Only allow specific fields to be updated
    const allowedFields = [
      'pro',
      'superAdmin',
      'isAgent',
      'isBuyer',
      'marketReportOptIn',
      'unsubscribed',
    ];
    const safeUpdates = {};
    for (const key of allowedFields) {
      if (key in updates) {
        safeUpdates[key] = updates[key];
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Handle unsubscribed timestamp
    if ('unsubscribed' in safeUpdates) {
      if (safeUpdates.unsubscribed === true) {
        safeUpdates.unsubscribedAt = new Date();
      } else {
        safeUpdates.unsubscribedAt = FieldValue.delete();
      }
    }

    await adminDb.collection('users').doc(targetUid).update(safeUpdates);

    return NextResponse.json({ success: true, updated: safeUpdates });
  } catch (err) {
    console.error('Admin users PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
