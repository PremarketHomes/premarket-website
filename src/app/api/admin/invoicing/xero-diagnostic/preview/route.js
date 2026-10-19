import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../../middleware/auth';
import { isXeroConnected, getOrganisation, getAccountByCode, searchContactByName } from '../../../../services/xeroService';
import { adminDb } from '../../../../../firebase/adminApp';
import { TEST_CONTACT_NAME, TEST_CONTACT_EMAIL } from '../constants';

/**
 * GET /api/admin/invoicing/xero-diagnostic/preview
 *
 * One-off diagnostic to prove the real Xero connection works end to
 * end — see create/route.js for the actual invoice-creation step this
 * is a dry run for. This route makes only READ-ONLY calls to Xero
 * (Organisation, Accounts, a contact name search) — it never creates
 * or modifies anything, in Xero or in Firestore. Nothing here touches
 * propertyCharges, invoiceRuns, or settings/invoicing.billingActivatedAt.
 *
 * Gated behind XERO_DIAGNOSTIC_ENABLED so this is inert even once
 * deployed, until that env var is explicitly set — a separate,
 * deliberate step from deploying the code itself. To remove this
 * feature after testing: unset that env var (disables both routes
 * immediately, no redeploy needed), or delete this whole
 * xero-diagnostic/ directory and its constants.js sibling along with
 * the Settings panel that calls it.
 */
export async function GET(request) {
  if (process.env.XERO_DIAGNOSTIC_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Xero diagnostic is disabled' }, { status: 404 });
  }

  const auth = await verifyAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const connected = await isXeroConnected();
    if (!connected) {
      return NextResponse.json({ connected: false, readyToCreate: false });
    }

    const settingsDoc = await adminDb.collection('settings').doc('invoicing').get();
    const accountCode = (settingsDoc.exists ? settingsDoc.data().xeroAccountCode : null) || '200';

    const [organisation, accountDetails, existingTestContact] = await Promise.all([
      getOrganisation(),
      getAccountByCode(accountCode),
      searchContactByName(TEST_CONTACT_NAME),
    ]);

    return NextResponse.json({
      connected: true,
      organisationName: organisation?.Name || null,
      accountCode,
      accountCodeValid: !!accountDetails,
      accountCodeName: accountDetails?.Name || null,
      testContact: { name: TEST_CONTACT_NAME, email: TEST_CONTACT_EMAIL },
      existingTestContactId: existingTestContact?.ContactID || null,
      readyToCreate: !!(organisation && accountDetails),
    });
  } catch (err) {
    console.error('Xero diagnostic preview error:', err);
    return NextResponse.json({ error: err.message || 'Failed to check Xero readiness' }, { status: 500 });
  }
}
