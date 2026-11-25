import { json, fail, readJson, adminDb } from '../../../_http';
import { pilotCheckIn } from '../../../../services/openHomePilot';

export const dynamic = 'force-dynamic';

// POST (public, no login) { fullName, mobile, email, updatesOptIn }: check in. Returns a reference the buyer's phone
// keeps for "Register my interest". Identity side only.
export async function POST(request, { params }) {
  try {
    const { code } = await params;
    const body = await readJson(request);
    return json(await pilotCheckIn(adminDb, { code, body }), 201);
  } catch (err) {
    return fail(err);
  }
}
