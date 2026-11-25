import { json, fail, signedInUid } from '../_http';
import { isPilotAgent } from '../../services/openHomePilot';

export const dynamic = 'force-dynamic';

// GET: is the signed-in account in the Open Home pilot? (Drives the dashboard's "Open Home" option.)
export async function GET(request) {
  try {
    const uid = await signedInUid(request);
    return json({ enabled: isPilotAgent(uid) });
  } catch (err) {
    return fail(err);
  }
}
