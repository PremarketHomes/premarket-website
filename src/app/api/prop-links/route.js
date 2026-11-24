import { NextResponse } from 'next/server';
import { adminDb } from '../../firebase/adminApp';
import { verifyAuth } from '../middleware/auth';
import { getOrCreatePropNumbers, MAX_SHORT_LINK_BATCH } from '../services/shortLinkService';

/**
 * POST /api/prop-links  { propertyIds: string[] }  ->  { numbers: { [propertyId]: '4827319056' | null } }
 *
 * Signed-in users only. Returns each campaign's prop number (premarket.homes/prop{number}), creating it the first time
 * it is asked for (see services/shortLinkService.js for why any signed-in user may do that). Returns numbers only; the
 * page builds the link from its own origin. A null number means the link could not be had for that campaign (it does
 * not exist, or creating failed): the share screen says so and offers a retry. It never substitutes the full link.
 */
export async function POST(request) {
  const auth = await verifyAuth(request);
  if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.propertyIds) ? body.propertyIds : null;
  if (!ids) return NextResponse.json({ error: 'propertyIds must be a list' }, { status: 400 });
  if (ids.length > MAX_SHORT_LINK_BATCH) {
    return NextResponse.json({ error: `At most ${MAX_SHORT_LINK_BATCH} campaigns per request` }, { status: 400 });
  }

  try {
    const numbers = await getOrCreatePropNumbers(adminDb, ids);
    return NextResponse.json({ numbers }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('Prop links error:', err?.message || err);
    return NextResponse.json({ error: 'Campaign links are unavailable right now' }, { status: 503 });
  }
}
