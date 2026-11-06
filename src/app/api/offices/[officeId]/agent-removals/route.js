import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../middleware/auth';
import { removeAgentFromDirectory } from '../../../services/officeAgentRemovalService';

/**
 * POST /api/offices/{officeId}/agent-removals   { key }
 * Office-admin only (re-checked live inside the service). Removes the agent from the office directory (reversible marker).
 * Never deletes the Auth account, campaigns, registrations, reports or billing.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId } = await params;
    let body = {};
    try { body = await request.json(); } catch { /* empty */ }
    if (!body.key || typeof body.key !== 'string') return NextResponse.json({ error: 'Agent is required' }, { status: 400 });
    return NextResponse.json(await removeAgentFromDirectory({ officeId, key: body.key, actorUid: auth.uid }));
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('Remove agent from directory error:', err);
    return NextResponse.json({ error: err.message || 'Failed to remove agent' }, { status: err.status || 500 });
  }
}
