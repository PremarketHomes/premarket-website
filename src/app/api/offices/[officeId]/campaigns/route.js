import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { requireOfficeAdmin } from '../../../services/officeService';
import { listOfficeCampaigns } from '../../../services/managedCampaignService';
import { managedCampaignsEnabled } from '../../../services/environmentGuard';

/**
 * GET /api/offices/{officeId}/campaigns — office admin only. Every campaign owned by a current member of
 * the office with selling agent, managing BSO, creator and links, plus the people who can manage campaigns. Summaries only:
 * no offers, price opinions or buyer details.
 */
export async function GET(request, { params }) {
  try {
    if (!managedCampaignsEnabled()) return NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 });
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId } = await params;
    await requireOfficeAdmin({ officeId, uid: auth.uid });
    return NextResponse.json(await listOfficeCampaigns(adminDb, officeId));
  } catch (err) {
    if (!err.status) console.error('Office campaigns error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to load campaigns' }, { status: err.status || 500 });
  }
}
