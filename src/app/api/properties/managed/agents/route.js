import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { listAssignableAgents } from '../../../services/managedCampaignService';

/** GET /api/properties/managed/agents — the agents the caller may create campaigns for (empty for ordinary agents). */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return NextResponse.json(await listAssignableAgents(adminDb, auth.uid));
  } catch (err) {
    console.error('Assignable agents error:', err);
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 });
  }
}
