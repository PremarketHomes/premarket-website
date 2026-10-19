import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyAdmin } from '../../../middleware/auth';

/**
 * POST /api/admin/invoicing/activate-billing
 *
 * The one and only way settings/invoicing.billingActivatedAt is ever
 * set — deliberately not part of the generic settings PUT. Billing
 * defaults OFF (see billingService.js's isPropertyBillable): no charge
 * is ever created for any property, historical or new, until this is
 * called. From that moment on, only properties created on or after
 * this exact timestamp become billable; everything created before it
 * is excluded permanently, by design, never backfilled.
 *
 * Idempotent and one-way: if billing is already activated, this is a
 * no-op that returns the existing timestamp rather than resetting it
 * — resetting it would silently make a swath of properties created
 * since the original activation look "historical" again under a later
 * date, which must never happen by an accidental double-click.
 */
export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const ref = adminDb.collection('settings').doc('invoicing');
    const existing = await ref.get();
    const existingData = existing.exists ? existing.data() : {};

    if (existingData.billingActivatedAt) {
      return NextResponse.json({
        success: true,
        alreadyActive: true,
        billingActivatedAt: existingData.billingActivatedAt,
      });
    }

    await ref.set({ billingActivatedAt: FieldValue.serverTimestamp() }, { merge: true });

    return NextResponse.json({ success: true, alreadyActive: false });
  } catch (err) {
    console.error('Activate billing error:', err);
    return NextResponse.json({ error: 'Failed to activate billing' }, { status: 500 });
  }
}
