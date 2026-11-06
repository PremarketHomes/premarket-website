import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { resolveRegistrationScope, listRegistrations } from '../../services/officeRegistrationService';
import { officeRegistrationsEnabled } from '../../services/environmentGuard';

/**
 * GET /api/registrations/managed — office admins only: the whole office. There is no team or BSO scope (the former
 * team-creator scope was retired with the Team Admin role). Everyone else (agents, BSOs, team members, leadership) gets 403.
 * Registration details only; never price opinions.
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    // The whole overview is OFF until OFFICE_REGISTRATIONS_ENABLED=1 (no new buyer-data surface at launch).
    if (!officeRegistrationsEnabled()) return NextResponse.json({ error: 'The registrations overview is not switched on yet.' }, { status: 403 });
    const scope = await resolveRegistrationScope(adminDb, auth.uid);
    if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ scope: scope.scope, office: scope.office, registrations: await listRegistrations(adminDb, scope) });
  } catch (err) {
    console.error('Managed registrations error:', err);
    return NextResponse.json({ error: 'Failed to load registrations' }, { status: 500 });
  }
}
