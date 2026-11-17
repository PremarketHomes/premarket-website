import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAdmin } from '../../../middleware/auth';
import { withChargeDetails } from '../../../services/chargeDetails';
import { retroPromotionHint } from '../../../services/retroPromotion';

/**
 * GET /api/admin/invoicing/charges?status=pending
 * Lists charges for admin review — primarily the 'pending' ones, so an
 * admin can sanity-check what's about to be billed before creating a
 * run, and 'excluded'/'reversed' ones, for an audit trail of past
 * adjustments. Never exposes a way to delete a charge — only
 * /api/admin/invoicing/charges/[chargeId] (exclude/reverse) changes one,
 * and that's a status flag plus an audit note, never a removal.
 */
const toIso = (t) => {
  const d = t?.toDate ? t.toDate() : t ? new Date(t) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';

    const snap = await adminDb
      .collection('propertyCharges')
      .where('status', '==', status)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    // Full street address, selling agent and submission date from each
    // linked property record (read-only; the stored charge is untouched),
    // newest submission first.
    const charges = await withChargeDetails(
      snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      'propertyAddress',
    );
    const sortKey = (c) => c.submittedAt || toIso(c.createdAt) || '';
    charges.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

    // Pending tab: read-only "can HPHNOVEMBER still be applied?" hint for HPH
    // charges (drives the Apply button; the apply route re-checks everything).
    if (status === 'pending') {
      await Promise.all(charges.map(async (c) => {
        const hint = await retroPromotionHint(adminDb, c);
        if (hint) c.promoHint = hint;
      }));
    }

    // Excluded tab: totals per promotion code (e.g. HPHNOVEMBER) over ALL
    // excluded promo charges, not just the 200 listed. Each charge's own
    // snapshotted totalInc is what was waived; nothing is recomputed.
    let promotions = [];
    if (status === 'excluded') {
      // Audit trail for promotions an admin applied retroactively: who and when.
      const adminNames = new Map();
      await Promise.all(charges.filter((c) => c.promoCode && c.adjustment?.retroactive).map(async (c) => {
        const uid = c.adjustment.adminUid;
        if (uid && !adminNames.has(uid)) {
          adminNames.set(uid, adminDb.collection('users').doc(uid).get()
            .then((s) => { const u = s.exists ? s.data() : {}; return `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || uid; })
            .catch(() => uid));
        }
        c.promoAppliedBy = uid ? await adminNames.get(uid) : null;
        c.promoAppliedAt = toIso(c.adjustment.at);
      }));

      const all = await adminDb.collection('propertyCharges').where('status', '==', 'excluded').get();
      const byCode = new Map();
      for (const d of all.docs) {
        const c = d.data();
        if (!c.promoCode || c.testCampaign === true) continue;
        const row = byCode.get(c.promoCode) || { code: c.promoCode, count: 0, waivedInc: 0 };
        row.count += 1;
        row.waivedInc += Number(c.totalInc) || 0;
        byCode.set(c.promoCode, row);
      }
      promotions = [...byCode.values()]
        .map((r) => ({ ...r, waivedInc: Math.round(r.waivedInc * 100) / 100 }))
        .sort((a, b) => a.code.localeCompare(b.code));
    }

    return NextResponse.json({ charges, promotions });
  } catch (err) {
    console.error('List charges error:', err);
    return NextResponse.json({ error: 'Failed to fetch charges' }, { status: 500 });
  }
}
