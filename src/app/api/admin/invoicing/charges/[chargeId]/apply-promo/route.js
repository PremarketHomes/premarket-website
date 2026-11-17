import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../../firebase/adminApp';
import { verifyAdmin } from '../../../../../middleware/auth';
import { PromoError } from '../../../../../services/promotions';
import { applyRetroPromotion, RETRO_PROMO_CODE } from '../../../../../services/retroPromotion';

/**
 * POST /api/admin/invoicing/charges/[chargeId]/apply-promo
 * Body: { code: 'HPHNOVEMBER' }
 *
 * Admin-only. Retroactively applies a promotion to a PENDING charge whose agent forgot the code: atomically creates the
 * agent's one redemption and moves this same charge to 'excluded' (labelled with the code, amount unchanged = waived),
 * with an audit record of who applied it and when. Refused for charges in a draft run (remove them first), charges
 * already sent to Xero, non-HPH campaigns, campaigns created after the cutoff, and agents who already redeemed.
 * See services/retroPromotion.js.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { chargeId } = await params;
    const body = await request.json().catch(() => ({}));
    if ((body?.code || RETRO_PROMO_CODE) !== RETRO_PROMO_CODE) {
      return NextResponse.json({ error: 'Unknown promotion.' }, { status: 400 });
    }
    const result = await applyRetroPromotion(adminDb, { chargeId, code: RETRO_PROMO_CODE, adminUid: auth.uid });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof PromoError) {
      return NextResponse.json({ error: err.message, reason: err.reason }, { status: err.status || 409 });
    }
    console.error('Apply promotion error:', err);
    return NextResponse.json({ error: 'Failed to apply the promotion' }, { status: 500 });
  }
}
