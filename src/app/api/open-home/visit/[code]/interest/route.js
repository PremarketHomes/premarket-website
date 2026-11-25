import { json, fail, readJson, adminDb } from '../../../_http';
import { pilotInterest } from '../../../../services/openHomePilot';

export const dynamic = 'force-dynamic';

// POST (public, no login) { ref, wants }: register interest on the buyer's own check-in record. Never an opinion.
export async function POST(request, { params }) {
  try {
    const { code } = await params;
    const { ref, wants } = await readJson(request);
    return json(await pilotInterest(adminDb, { code, ref, wants }));
  } catch (err) {
    return fail(err);
  }
}
