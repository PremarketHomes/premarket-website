import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { recordChannelOpinion } from '../../services/channelAttribution';

/**
 * POST /api/offers/opinion-channel  { propertyId, offerId, sessionId, channel }  ->  { ok: true }
 *
 * Called by the buyer page right after it creates a NEW anonymous price opinion, when the page was opened through a
 * marketing channel's link (e.g. premarket.homes/prop4827319056s, the SMS link). Adds one to that channel's opinion
 * count for the campaign: a running total, nothing else. See services/channelAttribution.js.
 *
 * - The opinion must be a just-created anonymous web price opinion for this campaign, made in this browser tab
 *   (sessionId matches); otherwise nothing is counted. Each opinion is counted once at most.
 * - Nothing is written to the opinion, and the channel is stored only as part of the campaign's totals.
 * - Always answers { ok: true } (counted or not), so the route can't be used to learn anything about an opinion.
 * - Reads nothing back to the caller: a channel letter can't be used to see any campaign's figures.
 */
export async function POST(req) {
  // Preview deployments share the live database (see utils/previewEnvironment.js): never count from a preview build.
  if (process.env.VERCEL_ENV === 'preview') return NextResponse.json({ ok: true });

  let body = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  try {
    await recordChannelOpinion(adminDb, {
      propertyId: body?.propertyId,
      offerId: body?.offerId,
      sessionId: body?.sessionId,
      channel: body?.channel,
    });
  } catch (err) {
    // Not counting is always safe (the opinion then sits in General / Unknown). No ids are logged.
    console.error('Opinion channel count failed:', err?.message || err);
  }
  return NextResponse.json({ ok: true });
}
