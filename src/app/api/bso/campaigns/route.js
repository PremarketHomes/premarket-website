import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { listBsoCampaigns } from '../../services/managedCampaignService';
import { managedCampaignsEnabled } from '../../services/environmentGuard';

/**
 * GET /api/bso/campaigns — the calling BSO's own portfolio: campaigns they are assigned to manage plus campaigns they own.
 * Filtered on the server; summaries only (no offers, opinions or buyer details). 403 for anyone who is not a BSO.
 */
export async function GET(request) {
  try {
    if (!managedCampaignsEnabled()) return NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 });
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return NextResponse.json(await listBsoCampaigns(adminDb, auth.uid), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (!err.status) console.error('BSO campaigns error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to load campaigns' }, { status: err.status || 500 });
  }
}
