import { NextResponse } from 'next/server';
import { officeRegistrationsEnabled, managedCampaignsEnabled } from '../services/environmentGuard';

/** GET /api/features — which gated screens are switched on in this deployment. Non-secret flags only. */
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ officeRegistrations: officeRegistrationsEnabled(), managedCampaigns: managedCampaignsEnabled() }, { headers: { 'cache-control': 'no-store' } });
}
