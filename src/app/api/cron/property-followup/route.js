import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyCron } from '../../middleware/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { sendPropertyFollowUpEmail } from '../../services/resendService';

export const maxDuration = 300;

/**
 * Daily cron: sends 14-day and 30-day follow-up emails for active properties.
 * Asks agents if the property has been sold and links to the sold entry page.
 */
export async function GET(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const now = new Date();
    const results = { sent14: 0, sent30: 0, errors: 0 };

    // Find properties created ~14 days ago (13-14 day window)
    const day14Start = new Date(now);
    day14Start.setDate(day14Start.getDate() - 14);
    day14Start.setHours(0, 0, 0, 0);
    const day14End = new Date(day14Start);
    day14End.setHours(23, 59, 59, 999);

    // Find properties created ~30 days ago (29-30 day window)
    const day30Start = new Date(now);
    day30Start.setDate(day30Start.getDate() - 30);
    day30Start.setHours(0, 0, 0, 0);
    const day30End = new Date(day30Start);
    day30End.setHours(23, 59, 59, 999);

    // Query both windows
    const [snap14, snap30] = await Promise.all([
      adminDb.collection('properties')
        .where('active', '==', true)
        .where('archived', '!=', true)
        .where('createdAt', '>=', Timestamp.fromDate(day14Start))
        .where('createdAt', '<=', Timestamp.fromDate(day14End))
        .get(),
      adminDb.collection('properties')
        .where('active', '==', true)
        .where('archived', '!=', true)
        .where('createdAt', '>=', Timestamp.fromDate(day30Start))
        .where('createdAt', '<=', Timestamp.fromDate(day30End))
        .get(),
    ]);

    // Process 14-day follow-ups
    for (const doc of snap14.docs) {
      const data = doc.data();
      if (data.followUp14Sent) continue; // Already sent
      if (data.soldPrice || data.soldAt) continue; // Already sold

      const agentId = data.userId || data.uid;
      if (!agentId) continue;

      try {
        const userDoc = await adminDb.collection('users').doc(agentId).get();
        if (!userDoc.exists) continue;
        const user = userDoc.data();
        if (user.unsubscribed) continue;

        await sendPropertyFollowUpEmail(
          user.email,
          user.firstName,
          data.address || data.formattedAddress || 'your property',
          doc.id,
          14
        );
        await doc.ref.update({ followUp14Sent: true });
        results.sent14++;
      } catch (err) {
        console.error(`14-day follow-up error for ${doc.id}:`, err);
        results.errors++;
      }
    }

    // Process 30-day follow-ups
    for (const doc of snap30.docs) {
      const data = doc.data();
      if (data.followUp30Sent) continue;
      if (data.soldPrice || data.soldAt) continue;

      const agentId = data.userId || data.uid;
      if (!agentId) continue;

      try {
        const userDoc = await adminDb.collection('users').doc(agentId).get();
        if (!userDoc.exists) continue;
        const user = userDoc.data();
        if (user.unsubscribed) continue;

        await sendPropertyFollowUpEmail(
          user.email,
          user.firstName,
          data.address || data.formattedAddress || 'your property',
          doc.id,
          30
        );
        await doc.ref.update({ followUp30Sent: true });
        results.sent30++;
      } catch (err) {
        console.error(`30-day follow-up error for ${doc.id}:`, err);
        results.errors++;
      }
    }

    return NextResponse.json({ success: true, ...results });
  } catch (err) {
    console.error('Property follow-up cron error:', err);
    return NextResponse.json({ error: 'Follow-up cron failed', details: err.message }, { status: 500 });
  }
}
