import { NextResponse } from 'next/server';
import { adminDb } from '../../../../firebase/adminApp';
import { verifyAdmin } from '../../../middleware/auth';
// READ-ONLY Xero functions only. The write functions (createInvoice, sendInvoice,
// findOrCreateContact, ...) are deliberately not imported here.
import {
  isXeroConnected,
  getOrganisation,
  getAccountByCode,
  getTaxRates,
  searchContactByName,
  getContactById,
  listInvoicesByReference,
  listInvoicesForContact,
} from '../../../services/xeroService';
import { runXeroReadinessCheck } from '../../../services/xeroReadinessCheck';

/**
 * POST /api/admin/invoicing/xero-readiness   Body: { confirm: true }
 *
 * Read-only check of the connected Xero organisation before the first real
 * invoice (see services/xeroReadinessCheck.js). It creates, authorises, emails,
 * voids, deletes and modifies NOTHING in Xero. The only side effect is the
 * normal OAuth token refresh when the stored access token has expired.
 *
 * Triple-gated: the XERO_READINESS_ENABLED env var must be 'true' (off by
 * default, so deploying this code does not let anyone run it), the caller must be
 * a superAdmin, and the body must carry confirm: true. Credentials stay
 * server-side — the response never contains a token or secret.
 */
export async function POST(request) {
  if (process.env.XERO_READINESS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'The Xero readiness check is disabled' }, { status: 404 });
  }

  const auth = await verifyAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { confirm } = await request.json().catch(() => ({}));
    if (confirm !== true) {
      return NextResponse.json({ error: 'confirm: true is required to contact Xero' }, { status: 400 });
    }

    if (!(await isXeroConnected())) {
      return NextResponse.json({ connected: false, ready: false, error: 'Xero is not connected' }, { status: 200 });
    }

    const settingsDoc = await adminDb.collection('settings').doc('invoicing').get();
    const accountCode = (settingsDoc.exists ? settingsDoc.data().xeroAccountCode : null) || '200';

    const contactsSnap = await adminDb.collection('billingContacts').where('billingEntityType', '==', 'office').get();
    const officeContacts = [];
    for (const doc of contactsSnap.docs) {
      const c = doc.data();
      if (c.status !== 'confirmed') continue;
      const link = (await adminDb.collection('xeroContacts').doc(c.billingEntityKey || doc.id).get()).data();
      officeContacts.push({
        billingEntityKey: c.billingEntityKey || doc.id,
        billingName: c.billingName || '',
        abn: c.abn || '',
        email: c.email || '',
        storedContactId: link?.xeroContactId || null,
      });
    }

    const result = await runXeroReadinessCheck({
      xero: { getOrganisation, getAccountByCode, getTaxRates, searchContactByName, getContactById, listInvoicesByReference, listInvoicesForContact },
      accountCode,
      officeContacts,
    });

    return NextResponse.json({ connected: true, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('Xero readiness check error:', err);
    return NextResponse.json({ error: 'The readiness check failed' }, { status: 500 });
  }
}
