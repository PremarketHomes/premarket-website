import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { createManagedProperty } from '../../services/managedCampaignService';
import { managedCampaignsEnabled } from '../../services/environmentGuard';

/**
 * POST /api/properties/managed
 * Body: { ownerUid, requestId, acceptTerms, managerUid?, property: {...} }
 * An office admin or a BSO creates a campaign FOR the selling agent (any agent of their office, including one who has
 * never logged in). The selling agent owns it; the creator is recorded separately; the managing user is the creating BSO,
 * or for an office admin themself or the BSO they choose (`managerUid`). Authority is checked server-side against live
 * office membership and the BSO role (never team membership). Idempotent on requestId.
 */
export async function POST(request) {
  try {
    if (!managedCampaignsEnabled()) return NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 }); // launch scope: off until the smoke test and terms decision are done
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const result = await createManagedProperty(adminDb, {
      actorUid: auth.uid, ownerUid: body.ownerUid, requestId: body.requestId,
      input: body.property, acceptTerms: body.acceptTerms, managerUid: body.managerUid ?? null,
    });
    return NextResponse.json({ success: true, ...result }, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    if (!err.status) console.error('Managed campaign create error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to create campaign' }, { status: err.status || 500 });
  }
}
