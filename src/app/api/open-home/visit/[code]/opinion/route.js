import { json, fail, readJson, adminDb } from '../../../_http';
import { pilotOpinion } from '../../../../services/openHomePilot';

export const dynamic = 'force-dynamic';

// POST (public, no login) { amount, device }: an anonymous price opinion. Deliberately reads ONLY those two fields:
// no check-in reference, name, cookie or Authorization header is accepted or looked at, and nothing is logged.
export async function POST(request, { params }) {
  try {
    const { code } = await params;
    const { amount, device } = await readJson(request);
    return json(await pilotOpinion(adminDb, { code, amount, device }), 201);
  } catch (err) {
    return fail(err);
  }
}
