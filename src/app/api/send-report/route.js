import { NextResponse } from 'next/server';
import { adminDb } from '../../firebase/adminApp';
import { verifyAuth } from '../middleware/auth';
import { getPropertyReportAccess, canManageProperty, teamManagerReportRecipients } from '../services/propertyAccessService';
import { gatherReport } from '../services/reportService';

export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { email, propertyId, name } = await request.json();
    if (!email || !propertyId) {
      return NextResponse.json({ error: 'Missing email or propertyId' }, { status: 400 });
    }

    // Emailing a report acts on the listing, so it is limited to the listing
    // agent or a superAdmin. An office administrator has read-only access and
    // any other signed-in user is refused — previously any login could send
    // any property's report to any address.
    const propertySnap = await adminDb.collection('properties').doc(propertyId).get();
    if (!propertySnap.exists) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }
    const access = await getPropertyReportAccess(adminDb, { uid: auth.uid, property: propertySnap.data() });
    if (!canManageProperty(access)) {
      // A team manager may email the report only to the campaign's selling agent or to themself (account emails on
      // file, checked here on the server), never to a typed address.
      if (access !== 'teamManager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const allowed = await teamManagerReportRecipients(adminDb, { uid: auth.uid, property: propertySnap.data() });
      if (!allowed.some((r) => r.email.toLowerCase() === String(email).trim().toLowerCase())) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await gatherReport(email, propertyId, name);
    return NextResponse.json({ success: true, message: 'Report sent successfully' });
  } catch (err) {
    console.error('Error sending report:', err?.message, err?.stack);
    return NextResponse.json({ error: 'Failed to send report' }, { status: 500 });
  }
}
