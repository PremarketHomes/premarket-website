import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAdmin } from '../../../middleware/auth';

/**
 * GET /api/admin/invoicing/charges?status=pending
 * Lists charges for admin review — primarily the 'pending' ones, so an
 * admin can sanity-check what's about to be billed before creating a
 * run, and 'excluded'/'reversed' ones, for an audit trail of past
 * adjustments. Never exposes a way to delete a charge — only
 * /api/admin/invoicing/charges/[chargeId] (exclude/reverse) changes one,
 * and that's a status flag plus an audit note, never a removal.
 */
export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';

    const snap = await adminDb
      .collection('propertyCharges')
      .where('status', '==', status)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const charges = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ charges });
  } catch (err) {
    console.error('List charges error:', err);
    return NextResponse.json({ error: 'Failed to fetch charges' }, { status: 500 });
  }
}
