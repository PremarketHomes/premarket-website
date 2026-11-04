import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { getRetailCampaignPricing } from '../../services/campaignPricingService';

/**
 * GET /api/agents/campaign-pricing
 *
 * Display-only. Tells the signed-in agent's upload page whether their
 * office shows a retail campaign price, and if so the price and the
 * matching terms text. Never returns wholesale or margin figures, and
 * has no effect on billing.
 */
export async function GET(request) {
  const auth = await verifyAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const result = await getRetailCampaignPricing(auth.uid);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('campaign-pricing error:', err);
    return NextResponse.json({ error: 'Unable to confirm pricing' }, { status: 500 });
  }
}
