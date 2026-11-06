import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { managedCampaignsEnabled } from '../../../services/environmentGuard';

/** Shared wrapper for the managed-campaign write routes: feature flag, sign-in, JSON body, error shape. */
export function managedWrite(handler, failure) {
  return async function route(request, { params }) {
    try {
      if (!managedCampaignsEnabled()) return NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 });
      const auth = await verifyAuth(request);
      if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
      const { id } = await params;
      const body = await request.json().catch(() => ({}));
      return NextResponse.json({ success: true, ...(await handler(adminDb, { actorUid: auth.uid, propertyId: id, body })) });
    } catch (err) {
      if (!err.status) console.error(`${failure}:`, err);
      return NextResponse.json({ error: err.status ? err.message : failure }, { status: err.status || 500 });
    }
  };
}
