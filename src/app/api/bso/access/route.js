import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { getBsoAccess } from '../../services/bsoService';
import { managedTeamOf } from '../../services/teamAccess';
import { managedCampaignsEnabled } from '../../services/environmentGuard';

/** GET /api/bso/access — whether the caller currently holds the BSO role (drives the BSO Dashboard). */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    // The BSO workspace runs on managed campaigns: while they are switched off, nobody is offered it.
    if (!managedCampaignsEnabled()) return NextResponse.json({ bso: false });
    const access = await getBsoAccess(adminDb, auth.uid);
    // Not a BSO: say whether they manage a team (drives the team manager Dashboard). Display only; every team route re-checks.
    if (!access.bso) {
      const userSnap = await adminDb.collection('users').doc(auth.uid).get();
      if (await managedTeamOf(adminDb, { actorUid: auth.uid, actor: userSnap.exists ? userSnap.data() : null })) access.teamManager = true;
    }
    return NextResponse.json(access, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('BSO access error:', err);
    return NextResponse.json({ error: 'Failed to check access' }, { status: 500 });
  }
}
