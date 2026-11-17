import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { parseProfileIds } from '../../services/publicProfileService';
import { resolveCampaignTeamThemes } from '../../services/teamThemes';

/**
 * GET /api/public/campaign-theme?ids=propertyId1,propertyId2
 *
 * Public, unauthenticated, display only. For each campaign: the accent palette key of the team the campaign's
 * selling agent belongs to ({ key } or null; see services/teamThemes.js). Never returns a team id, member, owner
 * or any other field. Any failure answers "no theme", so a page simply keeps its normal colours.
 */
export async function GET(request) {
  try {
    const ids = parseProfileIds(new URL(request.url).searchParams.get('ids'));
    if (ids.length === 0) return NextResponse.json({ themes: {} });
    const themes = await resolveCampaignTeamThemes(adminDb, ids);
    return NextResponse.json(
      { themes },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    console.error('campaign-theme error:', error);
    return NextResponse.json({ themes: {} });
  }
}
