import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { createOwnPromoProperty } from '../../services/promoCampaignService';

/**
 * POST /api/properties/promo-create
 * Body: { requestId, promoCode, acceptTerms, property: {...}, agentId?, pendingPhotos? }
 * The signed-in agent creates THEIR OWN campaign with a promo code: the property, its excluded billing record and the
 * redemption are created together server-side (see promoCampaignService). The selling agent is always the caller;
 * eligibility, one-per-agent and expiry are decided here, never by the browser. Idempotent on requestId.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const result = await createOwnPromoProperty(adminDb, {
      uid: auth.uid, requestId: body.requestId, input: body.property, acceptTerms: body.acceptTerms,
      agentId: body.agentId ?? null, pendingPhotos: body.pendingPhotos, promoCode: body.promoCode,
    });
    return NextResponse.json({ success: true, ...result }, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    if (!err.status) console.error('Promo campaign create error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to create campaign', reason: err.code || null }, { status: err.status || 500 });
  }
}
