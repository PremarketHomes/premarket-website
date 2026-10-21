import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyAuth } from '../../middleware/auth';

/**
 * POST /api/users/acknowledge-announcement
 * Body: { announcementId }
 *
 * Records that the AUTHENTICATED caller — never a uid passed in the
 * body — has seen and dismissed a dashboard announcement. Writes via
 * the Admin SDK directly to the caller's own users/{uid} document, so
 * this needs no Firestore rules change at all: client reads of
 * users/{userId} are already public (unrelated to this), and this is
 * the only way the field is ever written, server-side, ownership
 * already enforced by auth.uid.
 *
 * Stored as acknowledgedAnnouncements.<announcementId> via dot-path
 * update (not a plain `set` with `{merge:true}` on the parent map,
 * which would overwrite every OTHER announcement's ack) — each
 * announcement's id is its own independent key, so acknowledging a
 * future announcement can never erase this one, or vice versa. The
 * allowlist below is deliberate: an unrecognised id is rejected
 * rather than silently written, so a typo or a stale client build
 * can't create unbounded junk keys on a user document.
 */
const VALID_ANNOUNCEMENT_IDS = new Set(['billing-announcement-v1']);

export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { announcementId } = await request.json();
    if (!announcementId || !VALID_ANNOUNCEMENT_IDS.has(announcementId)) {
      return NextResponse.json({ error: 'Unknown announcementId' }, { status: 400 });
    }

    await adminDb.collection('users').doc(auth.uid).update({
      [`acknowledgedAnnouncements.${announcementId}`]: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, announcementId });
  } catch (err) {
    console.error('Acknowledge announcement error:', err);
    return NextResponse.json({ error: 'Failed to acknowledge announcement' }, { status: 500 });
  }
}
