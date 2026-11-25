import { json, fail, signedInUid, adminDb } from '../../../_http';
import { endPilotSession } from '../../../../services/openHomePilot';

export const dynamic = 'force-dynamic';

// POST: end an open home (check-in and opinions close; the summary becomes available).
export async function POST(request, { params }) {
  try {
    const uid = await signedInUid(request);
    const { id } = await params;
    return json(await endPilotSession(adminDb, { uid, sessionId: id }));
  } catch (err) {
    return fail(err);
  }
}
