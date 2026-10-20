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

    // allSettled, not all: these three hit different Xero scopes
    // (Organisation/Accounts need accounting.settings.read, the
    // contact search needs accounting.contacts). If only one of them
    // is missing its scope, `all` would reject on that one call and
    // hide whether the other two actually work — this reports each
    // independently so a scope/token/tenant problem is visible for
    // exactly the call it affects, not guessed at from one error.
    const [organisationResult, accountResult, contactResult] = await Promise.allSettled([
      getOrganisation(),
      getAccountByCode(accountCode),
      searchContactByName(TEST_CONTACT_NAME),
    ]);

    const organisation = organisationResult.status === 'fulfilled' ? organisationResult.value : null;
    const accountDetails = accountResult.status === 'fulfilled' ? accountResult.value : null;
    const existingTestContact = contactResult.status === 'fulfilled' ? contactResult.value : null;

    return NextResponse.json({
      connected: true,
      organisationName: organisation?.Name || null,
      organisationError: organisationResult.status === 'rejected' ? organisationResult.reason?.message : null,
      accountCode,
      accountCodeValid: !!accountDetails,
      accountCodeName: accountDetails?.Name || null,
      accountCodeError: accountResult.status === 'rejected' ? accountResult.reason?.message : null,
      testContact: { name: TEST_CONTACT_NAME, email: TEST_CONTACT_EMAIL },
      existingTestContactId: existingTestContact?.ContactID || null,
      contactSearchError: contactResult.status === 'rejected' ? contactResult.reason?.message : null,
      readyToCreate: !!(organisation && accountDetails) && contactResult.status === 'fulfilled',
    });
  } catch (err) {
    console.error('Xero diagnostic preview error:', err);
    return NextResponse.json({ error: err.message || 'Failed to check Xero readiness' }, { status: 500 });
  }
}
