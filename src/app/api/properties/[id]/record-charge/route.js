import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { recordPropertyCharge } from '../../../services/billingService';

/**
 * POST /api/properties/[id]/record-charge
 *
 * Called once by dashboard/add/page.js, right after it creates a new
 * property via the client Firestore SDK — that flow writes directly
 * to Firestore from the browser rather than through a server route, so
 * this is the one place it reaches the server to record the charge.
 *
 * Deliberately best-effort from the caller's point of view: if this
 * call never happens (a network blip right after creation, the tab
 * closing before it fires), the property is NOT left unbilled forever
 * — the monthly invoice-run engine sweeps for any property missing a
 * charge before every run (see invoiceRunService.js) and records it
 * then, using this exact same underlying function. This route is the
 * fast path, not the only path.
 *
 * Only the agent who owns the property (or a superAdmin) may trigger
 * this for it — otherwise any authenticated user could record a charge
 * against an arbitrary property.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: propertyId } = await params;

    const propertyDoc = await adminDb.collection('properties').doc(propertyId).get();
    if (!propertyDoc.exists) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const property = propertyDoc.data();
    const ownerUid = property.userId || property.uid;

    if (ownerUid !== auth.uid) {
      const requesterDoc = await adminDb.collection('users').doc(auth.uid).get();
      const isSuperAdmin = requesterDoc.exists && requesterDoc.data()?.superAdmin === true;
      if (!isSuperAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const result = await recordPropertyCharge({ id: propertyDoc.id, ...property });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Record property charge error:', err);
    return NextResponse.json({ error: 'Failed to record charge' }, { status: 500 });
  }
}
