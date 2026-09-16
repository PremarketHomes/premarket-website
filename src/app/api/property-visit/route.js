import { NextResponse } from 'next/server';
import { adminDb } from '../../firebase/adminApp';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { computeSessionUpdate } from '../../utils/sessionWindow';
import { isLikelyScanner } from '../../utils/scannerDetection';

const SESSIONS_COLLECTION = 'propertyViewSessions';

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  return value;
}

/**
 * Reads (or creates) the per-visitor session rollup for this property in
 * a transaction, so concurrent opens from the same visitor (e.g. two
 * tabs) can't corrupt the session/opens counts. This is entirely
 * separate from, and never modifies, the legacy `stats.*` counters on
 * the property document itself.
 */
async function applySessionUpdate({ propertyId, visitorId, now }) {
  const sessionRef = adminDb.collection(SESSIONS_COLLECTION).doc(`${propertyId}_${visitorId}`);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    const data = snap.exists ? snap.data() : null;
    const existing = data
      ? {
          sessionCount: data.sessionCount,
          totalOpens: data.totalOpens,
          currentSessionOpens: data.currentSessionOpens,
          currentSessionStartedAt: toDate(data.currentSessionStartedAt),
          lastActivityAt: toDate(data.lastActivityAt),
        }
      : null;

    const update = computeSessionUpdate({ existing, now });

    tx.set(
      sessionRef,
      {
        propertyId,
        visitorId,
        sessionCount: update.sessionCount,
        totalOpens: update.totalOpens,
        currentSessionOpens: update.currentSessionOpens,
        currentSessionStartedAt: Timestamp.fromDate(update.currentSessionStartedAt),
        lastActivityAt: Timestamp.fromDate(update.lastActivityAt),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return update;
  });
}

export async function POST(req) {
  try {
    // Vercel Preview deployments share the same production Firebase
    // project as premarket.homes (see utils/previewEnvironment.js). The
    // client already guards against this (isPreviewDeployment()), but
    // this is a second, independent, server-side check using Vercel's
    // own runtime env var — belt-and-braces so a preview build can never
    // pollute production view/session analytics even if the client
    // guard were ever bypassed or removed.
    if (process.env.VERCEL_ENV === 'preview') {
      return NextResponse.json({ success: true, skipped: 'preview-environment' });
    }

    const { propertyId, visitorId, isReturn } = await req.json();

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 });
    }

    const propertyRef = adminDb.collection('properties').doc(propertyId);

    // Legacy view counters — unchanged in meaning and behaviour. Every
    // open, including suspected scanner/bot opens, is counted here
    // exactly as it always has been, so existing agent-facing reporting
    // and historical campaigns are unaffected by this change.
    const updateData = {
      'stats.views': FieldValue.increment(1),
      'stats.lastViewed': FieldValue.serverTimestamp(),
    };

    if (isReturn) {
      updateData['stats.returnViews'] = FieldValue.increment(1);
    } else {
      updateData['stats.uniqueViews'] = FieldValue.increment(1);
    }

    await propertyRef.update(updateData);

    const userAgent = req.headers.get('user-agent') || '';
    const scannerSuspected = isLikelyScanner(userAgent);

    if (visitorId) {
      await adminDb.collection('propertyViews').add({
        propertyId,
        visitorId,
        isReturn: !!isReturn,
        timestamp: FieldValue.serverTimestamp(),
        // Additive fields — the fields above are untouched from before.
        scannerSuspected,
        userAgent: userAgent.slice(0, 300),
      });

      // Meaningful-session tracking is skipped entirely for
      // scanner-suspected traffic: it's still logged above (never
      // discarded), but excluded from the new session/opens counters so
      // it doesn't distort genuine buyer-engagement reporting. Visitors
      // remain fully anonymous — visitorId is the same pre-existing
      // localStorage-based identifier already used for legacy view
      // tracking; no new identity signal is introduced.
      if (!scannerSuspected) {
        await applySessionUpdate({ propertyId, visitorId, now: new Date() });
      } else {
        await adminDb
          .collection(SESSIONS_COLLECTION)
          .doc(`${propertyId}_${visitorId}`)
          .set(
            {
              propertyId,
              visitorId,
              scannerSuspectedOpens: FieldValue.increment(1),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Track view error:', error);
    return NextResponse.json({ error: 'Failed to track view' }, { status: 500 });
  }
}
