import { NextResponse } from 'next/server';
import { adminDb } from '../../firebase/adminApp';
import { verifyAuth } from '../middleware/auth';
import { getOrCreateShortCodes, MAX_SHORT_LINK_BATCH } from '../services/shortLinkService';

/**
 * POST /api/short-links  { propertyIds: string[] }  ->  { codes: { [propertyId]: code | null } }
 *
 * LEGACY (premarket.homes/p/{code}). Current share screens use POST /api/prop-links. This stays so that a dashboard
 * tab opened before the prop format was deployed keeps working until it is refreshed; it can be removed later.
 *
 * Signed-in users only. Returns each campaign's short-link code, creating it the first time it is asked for (see
 * services/shortLinkService.js for why any signed-in user may do that). Returns codes only; the page builds the link
 * from its own origin. A null code means "use the full link".
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
    const codes = await getOrCreateShortCodes(adminDb, ids);
    return NextResponse.json({ codes }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('Short links error:', err?.message || err);
    return NextResponse.json({ error: 'Short links are unavailable right now' }, { status: 503 });
  }
}
