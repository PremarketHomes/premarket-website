import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { validateApiKey } from '../middleware';
import { adminDb } from '../../../firebase/adminApp';

/**
 * POST /api/v1/engagement-ping
 *
 * Formerly /api/v1/track-engagement (still present as a thin alias —
 * see that file). Renamed for the same reason /api/track-view became
 * /api/property-visit: ad blockers and privacy extensions (uBlock,
 * Brave Shields, Safari ITP) silently drop requests whose path contains
 * "track", which was causing buyer-engagement data — including the
 * price-opinion funnel signals below — to go uncounted for exactly the
 * privacy-conscious visitors whose anonymity this product depends on.
 *
 * Receives engagement events from the client, writes to the
 * propertyEngagement collection. Deduplicates by sessionId + propertyId.
 *
 * Body: { propertyId, userId?, viewDurationMs, scrollDepthPercent,
 *   photosViewed, shared, opinionStarted, submitAttempted,
 *   opinionCompleted, sessionId, platform? }
 *
 * opinionStarted / submitAttempted / opinionCompleted are three
 * distinct funnel stages, not one flag: opinionStarted now fires on the
 * buyer's first genuine slider interaction (previously it fired at
 * submit time, which made it indistinguishable from opinionCompleted —
 * see PropertyPageClient.js). submitAttempted fires the moment a save
 * is attempted, before the Firestore write resolves. opinionCompleted
 * fires only once that write actually succeeds. Together they let
 * "touched the slider and left" / "tried to submit but it failed" /
 * "genuinely completed" be told apart — the single most important
 * distinction missing from this funnel before this field existed.
 */
export async function POST(request) {
  // Engagement tracking accepts both authenticated (API key) and unauthenticated
  // requests. Public property pages don't have an API key but still need tracking.
  const auth = await validateApiKey(request).catch(() => ({ valid: false }));
  // Don't reject - engagement is non-sensitive analytics data

  try {
    const body = await request.json();
    const { propertyId, sessionId } = body;

    if (!propertyId || !sessionId) {
      return NextResponse.json({ error: 'propertyId and sessionId required' }, { status: 400 });
    }

    // Input validation
    if (typeof propertyId !== 'string' || propertyId.length > 128) {
      return NextResponse.json({ error: 'propertyId must be a string (max 128 chars)' }, { status: 400 });
    }
    if (typeof sessionId !== 'string' || sessionId.length > 256) {
      return NextResponse.json({ error: 'sessionId must be a string (max 256 chars)' }, { status: 400 });
    }

    // Sanitize numerics
    const viewDurationMs = Math.max(0, Math.min(Number(body.viewDurationMs) || 0, 3600000));
    const scrollDepthPercent = Math.max(0, Math.min(Number(body.scrollDepthPercent) || 0, 100));
    const photosViewed = Math.max(0, Math.min(Math.floor(Number(body.photosViewed) || 0), 500));

    // Sanitize booleans
    const shared = body.shared === true;
    const opinionStarted = body.opinionStarted === true;
    const submitAttempted = body.submitAttempted === true;
    const opinionCompleted = body.opinionCompleted === true;

    // Validate platform
    const validPlatforms = ['web', 'mobile'];
    const platform = validPlatforms.includes(body.platform) ? body.platform : 'unknown';

    // Deduplicate: check if this session already tracked for this property
    const existing = await adminDb
      .collection('propertyEngagement')
      .where('propertyId', '==', propertyId)
      .where('sessionId', '==', sessionId)
      .limit(1)
      .get();

    if (!existing.empty) {
      // Update existing record (merge new data)
      const docRef = existing.docs[0].ref;
      const prev = existing.docs[0].data();
      await docRef.update({
        viewDurationMs: Math.max(prev.viewDurationMs || 0, viewDurationMs),
        scrollDepthPercent: Math.max(prev.scrollDepthPercent || 0, scrollDepthPercent),
        photosViewed: Math.max(prev.photosViewed || 0, photosViewed),
        shared: prev.shared || shared,
        opinionStarted: prev.opinionStarted || opinionStarted,
        submitAttempted: prev.submitAttempted || submitAttempted,
        opinionCompleted: prev.opinionCompleted || opinionCompleted,
        ...(platform !== 'unknown' && !prev.platform ? { platform } : {}),
        updatedAt: new Date(),
      });
      return NextResponse.json({ status: 'updated', id: docRef.id });
    }

    // Create new engagement record
    const { FieldValue } = await import('firebase-admin/firestore');
    const docRef = await adminDb.collection('propertyEngagement').add({
      propertyId,
      userId: typeof body.userId === 'string' ? body.userId.slice(0, 128) : null,
      viewDurationMs,
      scrollDepthPercent,
      photosViewed,
      shared,
      opinionStarted,
      submitAttempted,
      opinionCompleted,
      sessionId,
      platform,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ status: 'created', id: docRef.id });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'engagement-ping' } });
    console.error('Engagement ping error:', err);
    return NextResponse.json({ error: 'Failed to track engagement' }, { status: 500 });
  }
}
