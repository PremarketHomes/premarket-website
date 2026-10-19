import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAdmin } from '../../../middleware/auth';

const DEFAULT_SETTINGS = {
  pricePerListing: 200,
  gstRate: 0, // Premarket Group Pty Ltd is not GST registered
  paymentTermsDays: 14,
  invoicePrefix: 'PM-',
  xeroAccountCode: '200',
  cronDay: 1,
  cronEnabled: false,
  excludeAgentIds: [],
  marketReportRecipients: [],
  // null = billing has never been activated (the default — see
  // billingService.js's isPropertyBillable). Deliberately NOT in PUT's
  // allowedFields below — this can only be set by the dedicated
  // POST /api/admin/invoicing/activate-billing action, never by
  // editing it like any other setting, so it's never backdated or
  // accidentally reset by a routine settings save.
  billingActivatedAt: null,
};

export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const [settingsDoc, xeroDoc] = await Promise.all([
      adminDb.collection('settings').doc('invoicing').get(),
      adminDb.collection('settings').doc('xeroTokens').get(),
    ]);
    const settings = settingsDoc.exists ? { ...DEFAULT_SETTINGS, ...settingsDoc.data() } : DEFAULT_SETTINGS;

    // Include xero connection status
    settings.xeroConnected = !!(xeroDoc.exists && xeroDoc.data()?.refresh_token);

    return NextResponse.json({ settings });
  } catch (err) {
    console.error('Invoicing settings GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { settings } = await request.json();

    const allowedFields = [
      'pricePerListing', 'gstRate', 'paymentTermsDays', 'invoicePrefix',
      'xeroAccountCode', 'cronDay', 'cronEnabled', 'excludeAgentIds',
      'marketReportRecipients',
    ];

    const safeSettings = {};
    for (const key of allowedFields) {
      if (key in settings) {
        safeSettings[key] = settings[key];
      }
    }

    await adminDb.collection('settings').doc('invoicing').set(safeSettings, { merge: true });

    return NextResponse.json({ success: true, settings: safeSettings });
  } catch (err) {
    console.error('Invoicing settings PUT error:', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
