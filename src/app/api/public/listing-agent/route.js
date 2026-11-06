import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { getAssignedAgentProfile } from '../../services/publicProfileService';

/**
 * GET /api/public/listing-agent?propertyId=...
 *
 * Public, unauthenticated. For a listing assigned to a roster agent, returns that agent's allowlisted
 * public office-directory profile (name, photo, phone) when it matches exactly one agent in the owner's
 * office, else { agent: null }. Never returns the listing owner/creator's details.
 */
export async function GET(request) {
  try {
    const propertyId = new URL(request.url).searchParams.get('propertyId') || '';
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(propertyId)) return NextResponse.json({ agent: null });
    const agent = await getAssignedAgentProfile(adminDb, propertyId);
    return NextResponse.json({ agent }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch (error) {
    console.error('listing-agent error:', error);
    return NextResponse.json({ agent: null });
  }
}
