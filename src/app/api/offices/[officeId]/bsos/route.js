import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAuth } from '../../../middleware/auth';
import { listOfficeBsos, setBsoRole } from '../../../services/bsoService';
import { managedCampaignsEnabled } from '../../../services/environmentGuard';

const off = () => NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 });
const fail = (err, what) => {
  if (!err.status || err.status >= 500) console.error(`${what}:`, err);
  return NextResponse.json({ error: err.status ? err.message : what }, { status: err.status || 500 });
};

/** GET /api/offices/{officeId}/bsos — the office's BSOs. Office admin only (re-checked live in the service). */
export async function GET(request, { params }) {
  try {
    if (!managedCampaignsEnabled()) return off();
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId } = await params;
    return NextResponse.json(await listOfficeBsos(adminDb, { officeId, actorUid: auth.uid }));
  } catch (err) { return fail(err, 'Failed to load BSOs'); }
}

/** POST /api/offices/{officeId}/bsos — body { uid }. Office admin gives a member of the office the BSO role. Audited. */
export async function POST(request, { params }) {
  try {
    if (!managedCampaignsEnabled()) return off();
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await setBsoRole(adminDb, { officeId, actorUid: auth.uid, targetUid: body.uid, grant: true }));
  } catch (err) { return fail(err, 'Failed to assign the BSO role'); }
}
