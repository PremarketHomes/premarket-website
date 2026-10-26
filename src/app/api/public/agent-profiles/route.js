import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { getPublicAgentProfiles, parseProfileIds } from '../../services/publicProfileService';

/**
 * GET /api/public/agent-profiles?ids=uid1,uid2
 *
 * Public, unauthenticated. Returns only the allowlisted public fields for
 * agents / listing owners (see publicProfileService.js). Replaces the public
 * pages' direct reads of `users/{uid}`, which are no longer permitted.
 */
export async function GET(request) {
  try {
    const ids = parseProfileIds(new URL(request.url).searchParams.get('ids'));
    if (ids.length === 0) return NextResponse.json({ profiles: {} });

    const profiles = await getPublicAgentProfiles(adminDb, ids);
    return NextResponse.json(
      { profiles },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    console.error('agent-profiles error:', error);
    return NextResponse.json({ error: 'Failed to load profiles' }, { status: 500 });
  }
}
