import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';

// ═══════════════════════════════════════════════════════════════════════════
// XERO API: Token management
// ═══════════════════════════════════════════════════════════════════════════

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';

export async function getXeroTokens() {
  const doc = await adminDb.collection('settings').doc('xeroTokens').get();
  if (!doc.exists) return null;
  return doc.data();
}

export async function saveXeroTokens(tokens) {
  await adminDb.collection('settings').doc('xeroTokens').set({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 1800) * 1000,
    tenant_id: tokens.tenant_id || tokens.tenantId || null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function refreshXeroTokens() {
  const tokens = await getXeroTokens();
  if (!tokens?.refresh_token) throw new Error('No Xero refresh token available');

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: process.env.XERO_CLIENT_ID,
      client_secret: process.env.XERO_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Xero token refresh failed: ${err}`);
  }

  const newTokens = await res.json();
  await saveXeroTokens({ ...newTokens, tenant_id: tokens.tenant_id });
  return newTokens;
}

export async function isXeroConnected() {
  const tokens = await getXeroTokens();
  if (!tokens?.access_token) return false;
  if (!tokens.expires_at) return false;
  // Connected if we have tokens (even if expired, we can refresh)
  return !!tokens.refresh_token;
}

const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

/**
 * The previous "Disconnect" button only rewrote an unrelated settings
 * field and reloaded the page — it never actually touched
 * settings/xeroTokens, so Xero stayed connected underneath regardless
 * of what the UI showed. This is the real thing: best-effort revokes
 * our app's authorisation at Xero's end (DELETE /connections/{id} —
 * so "Premarket" also disappears from the org's own Connected Apps
 * list, not just from our side), then ALWAYS deletes the local
 * settings/xeroTokens doc regardless of whether the remote revoke
 * succeeded — a network hiccup calling Xero must never leave this
 * stuck "still connected" locally when the actual goal is "Premarket
 * can no longer use this token." Touches nothing else: no
 * propertyCharges, no invoiceRuns, no billing settings, and makes no
 * call that could create or send an invoice.
 */
export async function disconnectXero() {
  const tokens = await getXeroTokens();
  if (!tokens?.access_token) {
    return { wasConnected: false, revokedAtXero: false };
  }

  let revokedAtXero = false;
  try {
    const connRes = await fetch(XERO_CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (connRes.ok) {
      const connections = await connRes.json();
      const connection = connections.find((c) => c.tenantId === tokens.tenant_id) || connections[0];
      if (connection?.id) {
        const delRes = await fetch(`${XERO_CONNECTIONS_URL}/${connection.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        revokedAtXero = delRes.ok;
      }
    }
  } catch (err) {
    // Best-effort — an expired token or network issue here must never
    // block clearing our own local copy below.
    console.error('Xero connection revocation failed (clearing local tokens regardless):', err);
  }

  await adminDb.collection('settings').doc('xeroTokens').delete();

  return { wasConnected: true, revokedAtXero };
}

// ═══════════════════════════════════════════════════════════════════════════
// XERO API: HTTP helper with auto-refresh
// ═══════════════════════════════════════════════════════════════════════════

export async function makeXeroRequest(method, path, body = null, retry = true, extraHeaders = {}) {
  let tokens = await getXeroTokens();
  if (!tokens?.access_token) throw new Error('Xero not connected');

  // Auto-refresh if expired
  if (tokens.expires_at && Date.now() > tokens.expires_at - 60000) {
    const refreshed = await refreshXeroTokens();
    tokens = { ...tokens, access_token: refreshed.access_token };
  }

  const url = path.startsWith('http') ? path : `${XERO_API_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // Empty unless a caller passes one — createInvoice's own
    // idempotencyKey param is the real caller (see
    // runs/[runId]/send/route.js), which lets an operation survive a
    // retry/double-click without creating a duplicate, without this
    // function needing to know anything about why.
    ...extraHeaders,
  };
  if (tokens.tenant_id) {
    headers['Xero-tenant-id'] = tokens.tenant_id;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  // Retry once on 401 — extraHeaders carried through, so a caller's
  // idempotency key survives this retry too, rather than the retried
  // request silently losing its dedup protection.
  if (res.status === 401 && retry) {
    await refreshXeroTokens();
    return makeXeroRequest(method, path, body, false, extraHeaders);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Xero API ${method} ${path} failed (${res.status}): ${errText}`);
  }

  return res.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// XERO API: Contacts
// ═══════════════════════════════════════════════════════════════════════════

export async function findOrCreateContact({ name, email, firstName, lastName, taxNumber, address }) {
  // Search for existing contact by name
  const searchName = name.replace(/"/g, '\\"');
  const searchResult = await makeXeroRequest('GET', `/Contacts?where=Name=="${searchName}"`);

  if (searchResult.Contacts?.length > 0) {
    return searchResult.Contacts[0];
  }

  // Create new contact
  const newContact = {
    Name: name,
    EmailAddress: email || '',
    FirstName: firstName || '',
    LastName: lastName || '',
  };
  // Optional, admin-approved details (billingService.normalizeBillingExtras):
  // the ABN goes in Xero's TaxNumber, and the address as the contact's
  // street address. Only sent when present, so contacts without them are
  // created exactly as before. An existing contact (matched by name above)
  // is never modified.
  if (taxNumber) newContact.TaxNumber = taxNumber;
  if (address?.line1) {
    newContact.Addresses = [
      {
        AddressType: 'STREET',
        AddressLine1: address.line1,
        City: address.suburb,
        Region: address.state,
        PostalCode: address.postcode,
        Country: 'Australia',
      },
    ];
  }

  const result = await makeXeroRequest('POST', '/Contacts', { Contacts: [newContact] });
  return result.Contacts?.[0] || null;
}

/** Read-only. A contact by its Xero ContactID, or null if it no longer exists (404). Any other failure throws. */
export async function getContactById(contactId) {
  if (!contactId) return null;
  try {
    const result = await makeXeroRequest('GET', `/Contacts/${encodeURIComponent(contactId)}`);
    return result.Contacts?.[0] || null;
  } catch (err) {
    if (/\(404\)/.test(err?.message || '')) return null;
    throw err;
  }
}

/** Read-only — never creates. Used by the Xero connection diagnostic
 * to check whether its dedicated test contact already exists, without
 * ever causing a side effect itself. */
export async function searchContactByName(name) {
  const searchName = name.replace(/"/g, '\\"');
  const result = await makeXeroRequest('GET', `/Contacts?where=Name=="${searchName}"`);
  return result.Contacts?.[0] || null;
}

/** Read-only. Confirms which Xero organisation the stored tokens are
 * actually connected to — distinct from isXeroConnected (which only
 * checks that SOME token is stored, not that it's valid or for the
 * org you expect). */
export async function getOrganisation() {
  const result = await makeXeroRequest('GET', '/Organisation');
  return result.Organisations?.[0] || null;
}

/** Read-only. Confirms a given account code actually exists in the
 * connected org's chart of accounts before anything tries to invoice
 * against it. */
export async function getAccountByCode(code) {
  const result = await makeXeroRequest('GET', `/Accounts?where=Code=="${code}"`);
  return result.Accounts?.[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// XERO API: Invoices
// ═══════════════════════════════════════════════════════════════════════════

export async function createInvoice({ contactId, lineItems, reference, dueDate, accountCode, taxType, status, idempotencyKey }) {
  // 'NONE' (not GST registered — Premarket's actual status) or
  // 'OUTPUT' (GST on income, 10%, if that ever changes). Each line
  // item normally carries its own taxType (send/route.js derives it
  // per property, from that property's own snapshotted gstAmount —
  // different properties in the same consolidated invoice could in
  // principle have been charged under different settings if gstRate
  // changed between them). `taxType` here is only a fallback default
  // for a line item that doesn't specify its own — never a value this
  // function invents or defaults to GST on its own.
  const defaultTaxType = taxType || 'NONE';
  const invoice = {
    Type: 'ACCREC',
    Contact: { ContactID: contactId },
    LineItems: lineItems.map((li) => ({
      Description: li.description,
      Quantity: li.quantity,
      UnitAmount: li.unitAmount, // ex-GST
      AccountCode: accountCode || '200',
      TaxType: li.taxType || defaultTaxType,
    })),
    Reference: reference || '',
    DueDate: dueDate || '',
    // Every real caller (send/route.js) relies on this defaulting to
    // AUTHORISED — unchanged. Only the Xero connection diagnostic
    // passes 'DRAFT' explicitly, specifically so it never becomes
    // payable or reaches Xero's own invoice-reminder automation.
    Status: status || 'AUTHORISED',
    LineAmountTypes: 'Exclusive',
  };

  // Optional, deliberately not set by every caller (default undefined
  // => no header => unchanged behaviour): a caller that passes one is
  // telling Xero "if a request with this exact key already succeeded,
  // hand me back that same invoice rather than creating a second one"
  // — Xero's own documented idempotency support, the one mechanism
  // that can close a true blind-timeout race (this code never learns
  // whether its own request reached Xero, but a retry carrying the
  // same key is safe either way). See send/route.js for the real
  // caller that relies on this.
  const result = await makeXeroRequest(
    'POST',
    '/Invoices',
    { Invoices: [invoice] },
    true,
    idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
  );
  return result.Invoices?.[0] || null;
}

export async function sendInvoice(invoiceId) {
  return makeXeroRequest('POST', `/Invoices/${invoiceId}/Email`);
}

/**
 * Read-only. Used as a pre-flight reconciliation check before
 * creating an invoice for an item/record that has no stored
 * xeroInvoiceId yet — covers the scenario a reference string or an
 * Idempotency-Key can't cover alone: this process sent a create
 * request, got no response at all (a timeout, a dropped connection),
 * and genuinely does not know whether Xero's side actually processed
 * it. Checking "does an invoice with this exact reference already
 * exist" before retrying answers that question directly, rather than
 * assuming either way.
 *
 * Deliberately not the ONLY protection against a duplicate — see
 * send/route.js's own comment for why this and the Idempotency-Key
 * passed to createInvoice are complementary, not alternatives: this
 * check and the eventual write are two separate round-trips, so two
 * concurrent retries could in principle both pass this check before
 * either one creates anything — the Idempotency-Key is what closes
 * that specific gap, atomically, at the moment of the write itself.
 */
export async function findInvoiceByReference(reference) {
  const safeReference = String(reference || '').replace(/"/g, '\\"');
  const whereClause = `Reference=="${safeReference}"`;
  const result = await makeXeroRequest('GET', `/Invoices?where=${encodeURIComponent(whereClause)}`);
  return result.Invoices?.[0] || null;
}

export async function getInvoiceStatus(invoiceId) {
  const result = await makeXeroRequest('GET', `/Invoices/${invoiceId}`);
  return result.Invoices?.[0] || null;
}

export async function batchGetInvoiceStatuses(invoiceIds) {
  if (!invoiceIds.length) return [];

  // Xero supports comma-separated IDs
  const ids = invoiceIds.join(',');
  const result = await makeXeroRequest('GET', `/Invoices?IDs=${ids}`);
  return result.Invoices || [];
}

// ═══════════════════════════════════════════════════════════════════════════
// XERO API: Invoice run item sync
// ═══════════════════════════════════════════════════════════════════════════

export async function updateInvoiceRunItem(xeroInvoiceId, statusData) {
  const snap = await adminDb
    .collection('invoiceRunItems')
    .where('xeroInvoiceId', '==', xeroInvoiceId)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const docRef = snap.docs[0].ref;
  const status = statusData.Status || statusData.status;
  const updates = {
    xeroStatus: status,
    lastSyncedAt: FieldValue.serverTimestamp(),
  };

  // Mirrors the exact same status handling as the manual "Sync" action
  // (runs/[runId]/sync/route.js) — the webhook and the manual sync must
  // never disagree about what a given Xero status means locally.
  if (status === 'PAID' || statusData.FullyPaidOnDate) {
    updates.paidAt = statusData.FullyPaidOnDate || new Date().toISOString();
    updates.status = 'paid';
  } else if (status === 'VOIDED') {
    updates.status = 'voided';
  }

  await docRef.update(updates);
  return snap.docs[0].id;
}
