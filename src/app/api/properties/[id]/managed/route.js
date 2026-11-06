import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { updateManagedProperty, getCampaignRole } from '../../../services/managedCampaignService';
import { managedCampaignsEnabled } from '../../../services/environmentGuard';

/** GET /api/properties/{id}/managed — the caller's role on this campaign ('owner' | 'officeAdmin' | 'bso'); 404 if none. */
export async function GET(request, { params }) {
  try {
    if (!managedCampaignsEnabled()) return NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 });
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { id } = await params;
    return NextResponse.json(await getCampaignRole(adminDb, { actorUid: auth.uid, propertyId: id }), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (!err.status) console.error('Managed campaign role error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to load campaign' }, { status: err.status || 500 });
  }
}

/** PATCH /api/properties/{id}/managed — body { action: 'show' | 'hide' | 'archive' }. Owner, office admin or the managing BSO. */
export async function PATCH(request, { params }) {
  try {
    if (!managedCampaignsEnabled()) return NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 });
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
