import { json, fail, adminDb } from '../../_http';
import { publicVisit } from '../../../services/openHomePilot';

export const dynamic = 'force-dynamic';

// GET (public, no login): what a buyer's phone shows for this open home. No vendor details, price, ids or counts.
export async function GET(request, { params }) {
  try {
    const { code } = await params;
    return json(await publicVisit(adminDb, { code }));
  } catch (err) {
    return fail(err);
  }
}
