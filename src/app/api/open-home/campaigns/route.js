import { json, fail, signedInUid, adminDb } from '../_http';
import { listPilotCampaigns } from '../../services/openHomePilot';

export const dynamic = 'force-dynamic';

// GET: the pilot agent's own current campaigns (to start an open home on).
export async function GET(request) {
  try {
    const uid = await signedInUid(request);
    return json({ campaigns: await listPilotCampaigns(adminDb, { uid }) });
  } catch (err) {
    return fail(err);
  }
}
