import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../middleware/auth';
import { getRecipientEngagementForProperty } from '../../../services/recipientLinkService';

/**
 * The Phase 2 "safe internal verification view" as an API: per-recipient
 * attribution for one property (opens, meaningful sessions, first/last
 * viewed). Returns buyer identity (name/email), so this is superAdmin-
 * gated like the rest of the admin surface — never exposed publicly.
 */
export async function GET(req) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin.authenticated) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const propertyId = new URL(req.url).searchParams.get('propertyId');
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 });
    }

    const rows = await getRecipientEngagementForProperty(propertyId);
    return NextResponse.json({ rows });
  } catch (error) {
    console.error('Recipient engagement lookup error:', error);
    return NextResponse.json({ error: 'Failed to load recipient engagement' }, { status: 500 });
  }
}
