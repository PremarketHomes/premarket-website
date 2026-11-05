import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { createManagedProperty } from '../../services/managedCampaignService';

/**
 * POST /api/properties/managed
 * Body: { ownerUid, requestId, acceptTerms, property: {...} }
 * An office admin (any agent of their office) or a team creator (agents in their own team) creates a
 * campaign FOR the assigned agent. The agent owns it; the admin is recorded as creator. The actor's
 * authority is checked server-side against live office/team membership. Idempotent on requestId.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const result = await createManagedProperty(adminDb, {
      actorUid: auth.uid, ownerUid: body.ownerUid, requestId: body.requestId,
      input: body.property, acceptTerms: body.acceptTerms,
    });
    return NextResponse.json({ success: true, ...result }, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    if (!err.status) console.error('Managed campaign create error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to create campaign' }, { status: err.status || 500 });
  }
}
