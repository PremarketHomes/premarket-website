import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../middleware/auth';
import { createRecipientLinksForProperty } from '../../../services/recipientLinkService';

/**
 * Internal admin/developer tool (Phase 2's "smallest mechanism necessary
 * to create a small test recipient set"). NOT a bulk importer/EDM
 * sender — deliberately just this. superAdmin-gated because it creates
 * buyer identity records (recipients hold name/email/mobile).
 *
 * Body: { propertyId, recipients: [{ name, email, mobile? }], isTest? }
 */
export async function POST(req) {
  try {
    const admin = await verifyAdmin(req);
    if (!admin.authenticated) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const { propertyId, recipients, isTest } = await req.json();

    if (!propertyId || typeof propertyId !== 'string') {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 });
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: 'recipients (non-empty array) required' }, { status: 400 });
    }
    if (recipients.length > 25) {
      return NextResponse.json(
        { error: 'This tool is for small test batches only (max 25). Bulk creation is a future capability.' },
        { status: 400 }
      );
    }
    for (const r of recipients) {
      if (!r || (!r.email && !r.name)) {
        return NextResponse.json({ error: 'Each recipient needs at least a name or email' }, { status: 400 });
      }
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

    const links = await createRecipientLinksForProperty({
      propertyId,
      createdBy: admin.uid,
      recipients,
      isTest: !!isTest,
      baseUrl,
    });

    return NextResponse.json({ success: true, links });
  } catch (error) {
    if (error.message === 'PROPERTY_NOT_FOUND') {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }
    console.error('Recipient link creation error:', error);
    return NextResponse.json({ error: 'Failed to create recipient links' }, { status: 500 });
  }
}
