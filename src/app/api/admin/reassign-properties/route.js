import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { sendPropertyReadyOnce } from '../../services/notificationService';

const MAX_PROPERTIES_PER_REQUEST = 200;
// Notifications are for deliberate individual assignments, not migrations: a
// request touching more properties than this cannot ask for emails at all.
const MAX_NOTIFIED_PER_REQUEST = 25;

export const maxDuration = 120;

export async function POST(request) {
  const auth = await verifyAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const { targetUserId } = body;
    // Notification is opt-in: bulk reassignment for cleanup or migration must never
    // email anyone unless the admin explicitly asks for it.
    const notify = body.notify === true;

    if (!Array.isArray(body.propertyIds) || body.propertyIds.length === 0) {
      return NextResponse.json({ error: 'propertyIds must be a non-empty array' }, { status: 400 });
    }
    if (!targetUserId || typeof targetUserId !== 'string') {
      return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 });
    }
    const propertyIds = [...new Set(body.propertyIds.filter((id) => typeof id === 'string' && id))];
    if (propertyIds.length === 0) {
      return NextResponse.json({ error: 'propertyIds must be a non-empty array' }, { status: 400 });
    }
    if (propertyIds.length > MAX_PROPERTIES_PER_REQUEST) {
      return NextResponse.json({ error: `Maximum ${MAX_PROPERTIES_PER_REQUEST} properties per request` }, { status: 400 });
    }

    if (notify && propertyIds.length > MAX_NOTIFIED_PER_REQUEST) {
      return NextResponse.json(
        { error: `Notification emails are limited to ${MAX_NOTIFIED_PER_REQUEST} properties per request. Reassign in bulk without notifying.` },
        { status: 400 },
      );
    }

    const targetUserDoc = await adminDb.collection('users').doc(targetUserId).get();
    if (!targetUserDoc.exists) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    }

    // One transaction per property. Moving a property to a DIFFERENT owner is an
    // assignment event and bumps `ownership.seq` — the identity the notification
    // is de-duplicated on. Re-submitting the same request (a double click, a retry)
    // finds the property already owned by the target: no change, no new event, so
    // no second email. Reassigning it again later (to anyone, including back to a
    // previous owner) is a new event with a new seq and its own notification.
    const changed = [];
    const unchanged = [];
    const missing = [];
    for (const propertyId of propertyIds) {
      const ref = adminDb.collection('properties').doc(propertyId);
      const result = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: 'missing' };
        const property = snap.data();
        if (property.userId === targetUserId) return { status: 'unchanged', seq: Number(property.ownership?.seq) || 0 };
        const seq = (Number(property.ownership?.seq) || 0) + 1;
        tx.update(ref, {
          userId: targetUserId,
          agentId: null,
          agentName: null,
          agentAvatar: null,
          ownership: { userId: targetUserId, seq, by: auth.uid, at: FieldValue.serverTimestamp() },
        });
        return { status: 'changed', seq };
      });
      if (result.status === 'changed') changed.push({ propertyId, seq: result.seq });
      else if (result.status === 'unchanged') unchanged.push({ propertyId, seq: result.seq });
      else missing.push(propertyId);
    }

    // Email failures never fail the reassignment itself (it has already happened).
    let notified = 0;
    const notificationSkips = [];
    if (notify) {
      for (const { propertyId, seq } of changed) {
        const outcome = await sendPropertyReadyOnce({ propertyId, recipientUid: targetUserId, seq });
        if (outcome.sent) notified++;
        else notificationSkips.push({ propertyId, reason: outcome.reason });
      }
      // Repeating a request is how an admin retries a notification that failed
      // (e.g. Resend was down). Properties already owned by the target are NOT a new
      // event, so they only ever retry an event that already exists and has not
      // been sent; they can never create a first-time email.
      for (const { propertyId, seq } of unchanged) {
        if (!seq) continue;
        const outcome = await sendPropertyReadyOnce({ propertyId, recipientUid: targetUserId, seq, retryOnly: true });
        if (outcome.sent) notified++;
      }
    }

    return NextResponse.json({
      success: true,
      count: changed.length + unchanged.length,
      changed: changed.length,
      unchanged: unchanged.length,
      missing: missing.length,
      notified,
      notificationSkips,
    });
  } catch (err) {
    console.error('Reassign properties error:', err);
    return NextResponse.json({ error: 'Failed to reassign properties' }, { status: 500 });
  }
}
