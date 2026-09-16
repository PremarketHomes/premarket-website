import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../middleware/auth';
import { resolveRecipientToken, recordRecipientEngagement } from '../../../services/recipientLinkService';
import { isLikelyScanner } from '../../../../utils/scannerDetection';

/**
 * The Phase 2 "safe preview/test method" for proving attribution works,
 * without touching anything Views-related. This is deliberately a
 * SEPARATE code path from the real /api/property-visit integration
 * below — it exercises only the new recipientEngagement logic
 * (resolveRecipientToken + recordRecipientEngagement), and never calls
 * properties.stats.*, propertyViews, or propertyViewSessions. That means
 * it's safe to run against a Vercel Preview deployment (the existing
 * VERCEL_ENV/hostname preview guards exist specifically to stop
 * production Views/session analytics being polluted from a preview
 * build — this route can never do that, by construction, so it doesn't
 * need those guards) and safe to run repeatedly while testing without
 * inflating any real property's headline view count.
 *
 * superAdmin-gated, same as the rest of this admin surface.
 *
 * Body: { token, propertyId, userAgent? (defaults to this request's own
 * User-Agent; pass a known bot UA here to test scanner handling), now?
 * (ISO string — lets a test simulate "8 minutes later" without waiting) }
 */
export async function POST(req) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin.authenticated) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const { token, propertyId, userAgent, now } = await req.json();
    if (!token || !propertyId) {
      return NextResponse.json({ error: 'token and propertyId required' }, { status: 400 });
    }

    const resolved = await resolveRecipientToken(token, propertyId);
    if (!resolved) {
      return NextResponse.json({ attributed: false, reason: 'invalid_or_revoked_or_wrong_property' });
    }

    const effectiveUserAgent = userAgent || req.headers.get('user-agent') || '';
    const scannerSuspected = isLikelyScanner(effectiveUserAgent);
    const effectiveNow = now ? new Date(now) : new Date();

    const result = await recordRecipientEngagement({
      propertyId: resolved.propertyId,
      recipientId: resolved.recipientId,
      agencyOwnerId: resolved.agencyOwnerId,
      scannerSuspected,
      now: effectiveNow,
    });

    return NextResponse.json({
      attributed: true,
      recipientId: resolved.recipientId,
      scannerSuspected: result.scannerSuspected,
      isNewSession: result.isNewSession ?? null,
    });
  } catch (error) {
    console.error('Recipient link simulate-open error:', error);
    return NextResponse.json({ error: 'Failed to simulate open' }, { status: 500 });
  }
}
