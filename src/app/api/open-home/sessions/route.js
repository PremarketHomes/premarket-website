import { json, fail, signedInUid, readJson, adminDb } from '../_http';
import { listPilotSessions, startPilotSession } from '../../services/openHomePilot';

export const dynamic = 'force-dynamic';

// GET: the pilot agent's recent open homes. POST { propertyId, mode: 'live' | 'test' }: start one (or return the one
// already running on that campaign).
export async function GET(request) {
  try {
    const uid = await signedInUid(request);
    return json({ sessions: await listPilotSessions(adminDb, { uid }) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request) {
  try {
    const uid = await signedInUid(request);
    const body = await readJson(request);
    return json({ session: await startPilotSession(adminDb, { uid, propertyId: body.propertyId, mode: body.mode }) }, 201);
  } catch (err) {
    return fail(err);
  }
}
