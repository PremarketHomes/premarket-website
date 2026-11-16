import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { PromoError, PROMO_MESSAGES, checkPromotionForAgent } from '../../services/promotions';
import { loadUser, resolveCreatorRole } from '../../services/managedCampaignService';

/**
 * POST /api/promo/check   Body: { code, ownerUid? }
 * Validates a promo code for the campaign's SELLING AGENT: the caller themself, or (for an office admin / BSO) an agent
 * of their own office, checked with the same authority as campaign creation. Read-only: it reserves nothing. Business
 * outcomes come back as 200 { ok, reason?, message } so the page can show them inline.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await request.json().catch(() => null);
    if (!body || typeof body.code !== 'string') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const ownerUid = typeof body.ownerUid === 'string' && body.ownerUid && body.ownerUid !== auth.uid ? body.ownerUid : auth.uid;
    if (ownerUid !== auth.uid) {
      const owner = await loadUser(adminDb, ownerUid);
      const role = owner ? await resolveCreatorRole(adminDb, { actorUid: auth.uid, owner }) : null;
      if (!role) return NextResponse.json({ error: 'Agent not found' }, { status: 404 }); // never confirm agents outside your office
    }
    try {
      const { promo, owner } = await checkPromotionForAgent(adminDb, { code: body.code, ownerUid });
      const agentName = `${owner.firstName || ''} ${owner.lastName || ''}`.trim() || null;
      return NextResponse.json({ ok: true, code: promo.code, message: PROMO_MESSAGES.applied(promo.code), agentName });
    } catch (e) {
      if (e instanceof PromoError) return NextResponse.json({ ok: false, reason: e.reason, message: e.message });
      throw e;
    }
  } catch (err) {
    console.error('Promo check error:', err);
    return NextResponse.json({ error: 'Could not check the promo code' }, { status: 500 });
  }
}
