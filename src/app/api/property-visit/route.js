import { NextResponse } from 'next/server';
import { adminDb } from '../../firebase/adminApp';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { computeSessionUpdate } from '../../utils/sessionWindow';
import { isLikelyScanner } from '../../utils/scannerDetection';
import { resolveRecipientToken, recordRecipientEngagement } from '../services/recipientLinkService';

const SESSIONS_COLLECTION = 'propertyViewSessions';
const RECIPIENT_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — see Phase 2 report "identity persistence"

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  return value;
}

function recipientCookieName(propertyId) {
  return `pm_rl_${String(propertyId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
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

    const { propertyId, visitorId, isReturn, recipientToken } = await req.json();

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 });
    }

    const now = new Date();

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
        await applySessionUpdate({ propertyId, visitorId, now });
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

    // Phase 2 — recipient-attributed engagement. Fully additive and
    // independent of everything above: it never touches stats.views,
    // propertyViews, or propertyViewSessions, and a missing/invalid
    // token never affects the response. A token can arrive two ways —
    // explicitly (a fresh click of a personalised link, ?rlt=... in the
    // URL, sent by the client below) or implicitly (a first-party cookie
    // this route itself set on an earlier valid resolution) — so a
    // return visit keeps attributing without the link needing to be
    // re-clicked. See the Phase 2 report's "identity persistence"
    // section for exactly why and for how long.
    const cookies = parseCookieHeader(req.headers.get('cookie'));
    const cookieName = recipientCookieName(propertyId);
    const tokenToResolve = recipientToken || cookies[cookieName] || null;

    let setRecipientCookie = null;
    let clearRecipientCookie = false;

    if (tokenToResolve) {
      const resolved = await resolveRecipientToken(tokenToResolve, propertyId);
      if (resolved) {
        await recordRecipientEngagement({
          propertyId: resolved.propertyId,
          recipientId: resolved.recipientId,
          agencyOwnerId: resolved.agencyOwnerId,
          scannerSuspected,
          now,
        });
        setRecipientCookie = tokenToResolve;
      } else if (cookies[cookieName]) {
        // The cookie itself held a token that's no longer valid (e.g.
        // revoked) — clear it rather than retrying on every future visit.
        clearRecipientCookie = true;
      }
    }

    // Secure cookies are silently dropped by browsers on plain http:// —
    // only relevant for `npm run dev` on localhost; both production and
    // every Vercel preview are always served over https, so this stays
    // true everywhere that matters.
    const useSecureCookie = process.env.NODE_ENV === 'production';

    const response = NextResponse.json({ success: true });
    if (setRecipientCookie) {
      response.cookies.set(cookieName, setRecipientCookie, {
        httpOnly: true,
        secure: useSecureCookie,
        sameSite: 'lax',
        path: '/',
        maxAge: RECIPIENT_COOKIE_MAX_AGE_SECONDS,
      });
    } else if (clearRecipientCookie) {
      response.cookies.set(cookieName, '', { httpOnly: true, secure: useSecureCookie, sameSite: 'lax', path: '/', maxAge: 0 });
    }
    return response;
  } catch (error) {
    console.error('Track view error:', error);
    return NextResponse.json({ error: 'Failed to track view' }, { status: 500 });
  }
}
