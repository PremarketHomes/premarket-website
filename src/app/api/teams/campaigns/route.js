import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { listTeamManagerCampaigns } from '../../services/managedCampaignService';
import { managedCampaignsEnabled } from '../../services/environmentGuard';

/**
 * GET /api/teams/campaigns — a team manager's Dashboard: every campaign of the team they manage (server-only
 * teams/{id}.managerUids, re-checked on every request). Summaries only (no offers, opinions or buyer details).
 * 403 for anyone who is not currently a team manager.
 */
export async function GET(request) {
  try {
    if (!managedCampaignsEnabled()) return NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 });
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return NextResponse.json(await listTeamManagerCampaigns(adminDb, auth.uid), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (!err.status) console.error('Team campaigns error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to load campaigns' }, { status: err.status || 500 });
  }
}
