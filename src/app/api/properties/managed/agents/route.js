import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { listAssignableAgents } from '../../../services/managedCampaignService';
import { managedCampaignsEnabled } from '../../../services/environmentGuard';

/** GET /api/properties/managed/agents — the agents the caller may create campaigns for (empty for ordinary agents). */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    // Launch scope: with managed campaigns off, nobody is offered an agent selector.
    if (!managedCampaignsEnabled()) return NextResponse.json({ role: null, agents: [] });
    return NextResponse.json(await listAssignableAgents(adminDb, auth.uid));
  } catch (err) {
    console.error('Assignable agents error:', err);
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }
}
