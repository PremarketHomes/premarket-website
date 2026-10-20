import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { DEFAULT_PRICE_PER_LISTING, DEFAULT_GST_RATE } from '../../services/billingService';

const DEFAULT_PAYMENT_TERMS_DAYS = 14;

/**
 * GET /api/public/pricing-info
 *
 * Deliberately narrow, public, read-only projection of
 * settings/invoicing — returns ONLY the three figures a pricing
 * disclosure needs to display (pricePerListing, gstRate,
 * paymentTermsDays). settings/invoicing itself stays denied to direct
 * client reads (see firestore.rules) — it also holds
 * cronEnabled/billingActivatedAt/excludeAgentIds/xeroAccountCode,
 * none of which belong in a public response. This route reads the
 * real document server-side via the Admin SDK and hands back only
 * the three safe fields, so the dashboard/add submission page can
 * show the real configured price instead of text that could drift
 * out of sync with it.
 *
 * No auth required — same pattern as this app's other /api/public/*
 * routes (e.g. ticker-data). Defaults mirror billingService.js's own
 * (DEFAULT_PRICE_PER_LISTING, DEFAULT_GST_RATE) and the 14-day
 * default used everywhere else payment terms are read
 * (e.g. runs/[runId]/send/route.js) — never a separately-invented
 * default that could disagree with the real billing path.
 */
export async function GET() {
  try {
    const doc = await adminDb.collection('settings').doc('invoicing').get();
    const data = doc.exists ? doc.data() : {};

    return NextResponse.json({
      pricePerListing: data.pricePerListing || DEFAULT_PRICE_PER_LISTING,
      gstRate: typeof data.gstRate === 'number' ? data.gstRate : DEFAULT_GST_RATE,
      paymentTermsDays: data.paymentTermsDays || DEFAULT_PAYMENT_TERMS_DAYS,
    });
  } catch (err) {
    console.error('Public pricing-info error:', err);
    // Fail safe, not closed — a disclosure showing the known real
    // defaults is better than a broken submission page.
    return NextResponse.json({
      pricePerListing: DEFAULT_PRICE_PER_LISTING,
      gstRate: DEFAULT_GST_RATE,
      paymentTermsDays: DEFAULT_PAYMENT_TERMS_DAYS,
    });
  }
}
