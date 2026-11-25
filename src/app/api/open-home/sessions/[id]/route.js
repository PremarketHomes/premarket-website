import { json, fail, signedInUid, adminDb } from '../../_http';
import { deleteTestSession, pilotSessionReport } from '../../../services/openHomePilot';

export const dynamic = 'force-dynamic';

// GET: one open home for its agent: attendance register + anonymous opinion aggregate (never individual opinions).
// DELETE: remove a TEST open home and everything collected in it.
export async function GET(request, { params }) {
  try {
    const uid = await signedInUid(request);
    const { id } = await params;
    return json(await pilotSessionReport(adminDb, { uid, sessionId: id }));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    const uid = await signedInUid(request);
    const { id } = await params;
    return json(await deleteTestSession(adminDb, { uid, sessionId: id }));
  } catch (err) {
    return fail(err);
  }
}
