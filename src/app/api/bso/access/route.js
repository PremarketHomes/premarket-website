import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { getBsoAccess } from '../../services/bsoService';
import { managedCampaignsEnabled } from '../../services/environmentGuard';

/** GET /api/bso/access — whether the caller currently holds the BSO role (drives the "My Campaigns" navigation). */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    // The BSO workspace runs on managed campaigns: while they are switched off, nobody is offered it.
    if (!managedCampaignsEnabled()) return NextResponse.json({ bso: false });
    return NextResponse.json(await getBsoAccess(adminDb, auth.uid), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('BSO access error:', err);
    return NextResponse.json({ error: 'Failed to check access' }, { status: 500 });
  }
}
