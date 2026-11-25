import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { countsAsOpinion } from '../../../utils/opinionRecords';

const MAX_IDS = 300;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * POST /api/offers/opinion-counts  { propertyIds: string[] }  ->  { total, counts: { [propertyId]: number } }
 *
 * The agent dashboard's "buyer opinions" total. It used to read every raw `offers` document for the agent's listings
 * straight into the browser just to count them, and older documents can hold a buyer's details next to their price.
 * Now the browser gets numbers only. Counts only the caller's OWN listings (exactly what the old browser query could
 * read); any other id is ignored. Same counting rule as every report (utils/opinionRecords.countsAsOpinion).
 */
export async function POST(request) {
  const auth = await verifyAuth(request);
  if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const requested = Array.isArray(body?.propertyIds) ? body.propertyIds : null;
  if (!requested) return NextResponse.json({ error: 'propertyIds must be a list' }, { status: 400 });
  const ids = [...new Set(requested.filter((id) => typeof id === 'string' && ID_RE.test(id)))].slice(0, MAX_IDS);

  try {
    const own = [];
    for (let i = 0; i < ids.length; i += 100) {
      const snaps = await adminDb.getAll(...ids.slice(i, i + 100).map((id) => adminDb.collection('properties').doc(id)));
      for (const s of snaps) if (s.exists && s.data().userId === auth.uid) own.push(s.id);
    }
    const counts = Object.fromEntries(own.map((id) => [id, 0]));
    for (let i = 0; i < own.length; i += 30) {
      const snap = await adminDb.collection('offers').where('propertyId', 'in', own.slice(i, i + 30)).get();
      for (const d of snap.docs) {
        const o = d.data();
        if (countsAsOpinion(o) && counts[o.propertyId] !== undefined) counts[o.propertyId] += 1;
      }
    }
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    return NextResponse.json({ total, counts }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('opinion counts error:', err?.message || err);
    return NextResponse.json({ error: 'Failed to load opinion counts' }, { status: 500 });
  }
}
