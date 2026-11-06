import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../firebase/adminApp';
import { verifyAuth } from '../../../../middleware/auth';
import { setBsoRole } from '../../../../services/bsoService';
import { managedCampaignsEnabled } from '../../../../services/environmentGuard';

/** DELETE /api/offices/{officeId}/bsos/{uid} — office admin removes the BSO role. Campaigns are never changed. Audited. */
export async function DELETE(request, { params }) {
  try {
    if (!managedCampaignsEnabled()) return NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 });
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId, uid } = await params;
    return NextResponse.json(await setBsoRole(adminDb, { officeId, actorUid: auth.uid, targetUid: uid, grant: false }));
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('Remove BSO role error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to remove the BSO role' }, { status: err.status || 500 });
  }
}
