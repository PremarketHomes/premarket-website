import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../firebase/adminApp';
import { verifyAuth } from '../../../../middleware/auth';
import { resendCampaignLink } from '../../../../services/managedCampaignService';
import { managedCampaignsEnabled } from '../../../../services/environmentGuard';

/** POST /api/properties/{id}/campaign-link/resend — owner, office admin or team creator (live). Rate-limited. */
export async function POST(request, { params }) {
  try {
    if (!managedCampaignsEnabled()) return NextResponse.json({ error: 'Managed campaigns are not switched on yet.' }, { status: 403 });
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { id } = await params;
    return NextResponse.json({ success: true, ...(await resendCampaignLink(adminDb, { actorUid: auth.uid, propertyId: id })) });
  } catch (err) {
    if (!err.status) console.error('Resend campaign link error:', err);
    return NextResponse.json({ error: err.status ? err.message : 'Failed to resend' }, { status: err.status || 500 });
  }
}
