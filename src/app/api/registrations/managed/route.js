import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { resolveRegistrationScope, listRegistrations } from '../../services/officeRegistrationService';

/**
 * GET /api/registrations/managed — office admin: whole office. Team creator: their own team only.
 * Everyone else (agents, team members, leadership) gets 403. Registration details only; never price opinions.
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const scope = await resolveRegistrationScope(adminDb, auth.uid);
    if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ scope: scope.scope, office: scope.office, registrations: await listRegistrations(adminDb, scope) });
  } catch (err) {
    console.error('Managed registrations error:', err);
    return NextResponse.json({ error: 'Failed to load registrations' }, { status: 500 });
  }
}
