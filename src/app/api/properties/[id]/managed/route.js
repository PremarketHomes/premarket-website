import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { updateManagedProperty } from '../../../services/managedCampaignService';

/** PATCH /api/properties/{id}/managed — body { action: 'show' | 'hide' | 'archive' }. Office admin / team creator only. */
export async function PATCH(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await updateManagedProperty(adminDb, { actorUid: auth.uid, propertyId: id, action: body.action });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (!err.status) console.error('Managed campaign update error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to update campaign' }, { status: err.status || 500 });
  }
}
