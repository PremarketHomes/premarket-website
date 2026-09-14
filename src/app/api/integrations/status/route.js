import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { getCredentials as getRexCredentials } from '../../services/rexService';
import { getCredentials as getAgentboxCredentials } from '../../services/agentboxService';

/**
 * Returns the calling agent's own Rex/Agentbox connection status.
 * Deliberately strips credential values (clientId/apiKey/clientSecret/
 * accessToken) from the response — the dashboard only ever needs to know
 * whether it's connected and when it last synced, never the secret
 * itself, even for the legitimate owner. This replaces the old pattern
 * of the dashboard reading the raw `users/{uid}.integrations` field
 * directly (see security audit, Finding 3).
 */
function toSafeStatus(creds) {
  if (!creds) return null;
  const { status, mode, connectedAt, lastSync, lastSyncStatus, autoSync, offices, syncErrors } = creds;
  return { status, mode, connectedAt, lastSync, lastSyncStatus, autoSync, offices, syncErrors };
}

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const [rex, agentbox] = await Promise.all([
      getRexCredentials(auth.uid),
      getAgentboxCredentials(auth.uid),
    ]);

    return NextResponse.json({
      rex: toSafeStatus(rex),
      agentbox: toSafeStatus(agentbox),
    });
  } catch (err) {
    console.error('Integration status error:', err);
    return NextResponse.json({ error: 'Failed to load integration status' }, { status: 500 });
  }
}
