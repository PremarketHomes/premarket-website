import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildInvoiceReference } from '../../src/app/api/services/xeroInvoiceIdentity';
import { ZERO_GST_TAX_TYPE, GST_TAX_TYPE } from '../../src/app/api/services/xeroTaxTypes';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

function makeFakeDb() {
  const store = {};
  function col(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        const docId = id || `auto-${Math.random().toString(36).slice(2)}`;
        return {
          id: docId,
          ref: { _col: name, id: docId },
          _col: name,
          async get() {
            const data = store[name][docId];
            return { exists: !!data, id: docId, data: () => data };
          },
          async set(data) { store[name][docId] = { ...data }; },
          async update(patch) { store[name][docId] = { ...(store[name][docId] || {}), ...patch }; },
          async delete() { delete store[name][docId]; },
        };
      },
      where(field, op, value) {
        const all = Object.entries(store[name]).map(([id, data]) => ({
          id,
          data: () => data,
          _raw: data,
          ref: {
            _col: name,
            id,
            async update(patch) { store[name][id] = { ...(store[name][id] || {}), ...patch }; },
          },
        }));
        const filtered = all.filter((d) => (op === '==' ? d._raw[field] === value : true));
        return { get: async () => ({ docs: filtered, empty: filtered.length === 0, size: filtered.length }) };
      },
    };
  }
  // Mirrors real Firestore transaction semantics closely enough for
  // send/route.js's own use: tx.get reads current store state, every
  // write inside the callback is deferred until the callback resolves
  // (and thrown away entirely if it throws) — exactly what the
  // approved -> sending claim at the top of that route relies on.
  async function runTransaction(updateFn) {
    const pendingWrites = [];
    const tx = {
      get: async (ref) => {
        const data = store[ref._col]?.[ref.id];
        return { exists: !!data, id: ref.id, data: () => data };
      },
      update: (ref, patch) => pendingWrites.push(() => {
        store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch };
      }),
      set: (ref, data) => pendingWrites.push(() => {
        store[ref._col][ref.id] = { ...data };
      }),
    };
    const result = await updateFn(tx);
    pendingWrites.forEach((write) => write());
    return result;
  }

  return { collection: col, runTransaction, _store: store, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

const mockFindOrCreateContact = vi.fn();
const mockCreateInvoice = vi.fn();
const mockSendInvoice = vi.fn();
const mockIsXeroConnected = vi.fn();
const mockFindInvoiceByReference = vi.fn();
const mockSearchContactByName = vi.fn();
const mockGetContactById = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  findOrCreateContact: (...args) => mockFindOrCreateContact(...args),
  searchContactByName: (...args) => mockSearchContactByName(...args),
  getContactById: (...args) => mockGetContactById(...args),
  createInvoice: (...args) => mockCreateInvoice(...args),
  sendInvoice: (...args) => mockSendInvoice(...args),
  isXeroConnected: (...args) => mockIsXeroConnected(...args),
  findInvoiceByReference: (...args) => mockFindInvoiceByReference(...args),
}));

const mockMarkChargesInvoiced = vi.fn();
const mockMarkChargesFailed = vi.fn();
const mockResolveBillingContact = vi.fn();
vi.mock('../../src/app/api/services/billingService', () => ({
  markChargesInvoiced: (...args) => mockMarkChargesInvoiced(...args),
  markChargesFailed: (...args) => mockMarkChargesFailed(...args),
  resolveBillingContact: (...args) => mockResolveBillingContact(...args),
}));

// In-memory stand-in for the parts of Xero this route touches. Contacts are found by exact
// name (as Xero does); invoices are found by exact Reference (as Xero does), and — like a real
// list response — come back WITHOUT line items.
let xero;
function makeFakeXero() {
  const contacts = new Map();   // name -> contact
  const invoices = [];          // created invoices
  let contactSeq = 0;
  let invoiceSeq = 0;
  return {
    contacts, invoices,
    searchContactByName: async (name) => contacts.get(name) || null,
    getContactById: async (id) => [...contacts.values()].find((c) => c.ContactID === id) || null,
    findOrCreateContact: async ({ name, email, taxNumber }) => {
      if (contacts.has(name)) return contacts.get(name);
      contactSeq += 1;
      const c = { ContactID: `contact${contactSeq}`, Name: name, EmailAddress: email, ...(taxNumber ? { TaxNumber: taxNumber } : {}) };
      contacts.set(name, c);
      return c;
    },
    createInvoice: async ({ contactId, lineItems, reference }) => {
      invoiceSeq += 1;
      // Like Xero: only a taxed type (OUTPUT, 10%) adds GST; any 0% type (BASEXCLUDED) adds none.
      const sub = lineItems.reduce((sum, l) => sum + l.unitAmount * l.quantity, 0);
      const tax = lineItems.reduce((sum, l) => sum + (l.taxType === 'OUTPUT' ? l.unitAmount * l.quantity * 0.1 : 0), 0);
      const total = sub + tax;
      const inv = { InvoiceID: `inv${invoiceSeq}`, InvoiceNumber: `PM-${invoiceSeq}`, Status: 'AUTHORISED', Reference: reference, Contact: { ContactID: contactId }, SubTotal: Math.round(sub * 100) / 100, TotalTax: Math.round(tax * 100) / 100, Total: Math.round(total * 100) / 100, LineItems: undefined };
      invoices.push(inv);
      return inv;
    },
    findInvoiceByReference: async (reference) => invoices.find((i) => i.Reference === reference) || null,
  };
}

function makeRequest() {
  const headers = new Headers({ authorization: 'Bearer t' });
  return new Request('http://localhost/test', { method: 'POST', headers });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
  fakeDb._seed('users', 'admin1', { superAdmin: true });
  mockIsXeroConnected.mockResolvedValue(true);
  xero = makeFakeXero();
  mockFindOrCreateContact.mockImplementation(xero.findOrCreateContact);
  mockSearchContactByName.mockImplementation(xero.searchContactByName);
  mockGetContactById.mockImplementation(xero.getContactById);
  mockCreateInvoice.mockImplementation(xero.createInvoice);
  mockFindInvoiceByReference.mockImplementation(xero.findInvoiceByReference); // nothing pre-existing, by default
  mockSendInvoice.mockResolvedValue({});
  mockMarkChargesInvoiced.mockResolvedValue({ changed: [], skipped: [] });
  mockMarkChargesFailed.mockResolvedValue({ changed: [], skipped: [] });
  // Mirrors the real resolveBillingContact's contract against this
  // file's fake Firestore store, so each test's own
  // fakeDb._seed('billingContacts', key, {...}) is what actually
  // decides whether an item is treated as confirmed — the real
  // billingService.js implementation is never exercised here, since
  // the whole module is mocked above.
  mockResolveBillingContact.mockImplementation(async (billingEntityKey) => {
    const data = fakeDb._store.billingContacts?.[billingEntityKey];
    if (!data || data.status !== 'confirmed' || !data.email) return null;
    return {
      name: data.name || '',
      email: data.email,
      billingName: data.billingName || '',
      ...(data.abn ? { abn: data.abn } : {}),
      ...(data.address ? { address: data.address } : {}),
    };
  });
});

describe('POST /api/admin/invoicing/runs/[runId]/send — GST', () => {
  // Fixtures here deliberately match the REAL shape
  // invoiceRunService.groupChargesByEntity actually produces: no
  // pricePerListing on the item, no gstRate on the run — only each
  // property's own already-computed subtotalEx/gstAmount, snapshotted
  // per charge. An earlier version of these tests seeded an item-level
  // pricePerListing and a run-level gstRate that groupChargesByEntity
  // never actually sets, which masked a real bug: item.pricePerListing
  // was always undefined in production, so every real unitAmount sent
  // to Xero would have been NaN. Fixed in send/route.js to derive
  // unitAmount/taxType from each property's own numbers instead.

  it('passes the explicit zero-GST tax type (BASEXCLUDED) and each property\'s own ex-GST subtotal as the unit amount when not GST registered', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('billingContacts', 'agent:uid1', { status: 'confirmed', billingName: 'Acme Agency', name: 'Jo Bloggs', email: 'jo@example.com' });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Jo Bloggs',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      billingEntityType: 'independent',
      billingEntityKey: 'agent:uid1',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems[0].unitAmount).toBe(200);
    expect(call.lineItems[0].taxType).toBe(ZERO_GST_TAX_TYPE);
  });

  it('passes taxType OUTPUT and that property\'s own ex-GST amount when its charge was snapshotted with GST', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('billingContacts', 'agent:uid1', { status: 'confirmed', billingName: 'Acme Agency', name: 'Jo Bloggs', email: 'jo@example.com' });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Jo Bloggs',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      billingEntityType: 'independent',
      billingEntityKey: 'agent:uid1',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems[0].taxType).toBe('OUTPUT');
    expect(call.lineItems[0].unitAmount).toBeCloseTo(181.82, 2);
  });

  it('a consolidated invoice itemises every property with ITS OWN amount and tax status, never a single run-wide value', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('billingContacts', 'agent:uid1', { status: 'confirmed', billingName: 'Acme Agency', name: 'Jo Bloggs', email: 'jo@example.com' });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Jo Bloggs',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      billingEntityType: 'independent',
      billingEntityKey: 'agent:uid1',
      properties: [
        { propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
        { propertyId: 'p2', address: '2 Test St', subtotalEx: 181.82, gstAmount: 18.18, totalInc: 200 },
      ],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems).toHaveLength(2);
    expect(call.lineItems[0]).toMatchObject({ unitAmount: 200, taxType: ZERO_GST_TAX_TYPE });
    expect(call.lineItems[1]).toMatchObject({ taxType: 'OUTPUT' });
    expect(call.lineItems[1].unitAmount).toBeCloseTo(181.82, 2);
  });
});

describe('POST .../send — Xero contact name-collision fix (ONE AGENT = ONE BILLING ACCOUNT)', () => {
  it('two different agents who happen to share a personal name get two DIFFERENT, disambiguated Xero contact names', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('billingContacts', 'agent:uidAAAAAAAA', { status: 'confirmed', name: 'Jo Lee', email: 'jo.a@example.com' });
    fakeDb._seed('billingContacts', 'agent:uidBBBBBBBB', { status: 'confirmed', name: 'Jo Lee', email: 'jo.b@example.com' });
    fakeDb._seed('invoiceRunItems', 'itemA', {
      runId: 'run1', agencyName: 'Jo Lee', agentName: 'Jo Lee', agentEmail: 'jo.a@example.com',
      billingEntityType: 'independent', billingEntityKey: 'agent:uidAAAAAAAA',
      properties: [{ propertyId: 'pA', address: '1 A St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    fakeDb._seed('invoiceRunItems', 'itemB', {
      runId: 'run1', agencyName: 'Jo Lee', agentName: 'Jo Lee', agentEmail: 'jo.b@example.com',
      billingEntityType: 'independent', billingEntityKey: 'agent:uidBBBBBBBB',
      properties: [{ propertyId: 'pB', address: '2 B St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(mockFindOrCreateContact).toHaveBeenCalledTimes(2);
    const name1 = mockFindOrCreateContact.mock.calls[0][0].name;
    const name2 = mockFindOrCreateContact.mock.calls[1][0].name;
    expect(name1).toBe('Jo Lee');                 // the first entity gets the clean name — no technical suffix
    expect(name2).toMatch(/^Jo Lee \(uidBBBBB/);   // only the SECOND, different entity is disambiguated
    expect(name1).not.toBe(name2);                // never collide, even with identical display names
    expect(new Set([...xero.contacts.values()].map((c) => c.ContactID)).size).toBe(2);
  });

  it('SECURITY: two agents who both confirmed the SAME agency name as their billingName still get disambiguated Xero contacts — never merged', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('billingContacts', 'agent:agentA', { status: 'confirmed', billingName: 'Harcourts Property Hub', name: 'Jo Lee', email: 'jo@example.com' });
    fakeDb._seed('billingContacts', 'agent:agentB', { status: 'confirmed', billingName: 'Harcourts Property Hub', name: 'Max Tan', email: 'max@example.com' });
    fakeDb._seed('invoiceRunItems', 'itemA', {
      runId: 'run1', agencyName: 'Jo Lee', agentName: 'Jo Lee', agentEmail: 'jo@example.com',
      billingEntityType: 'independent', billingEntityKey: 'agent:agentA',
      properties: [{ propertyId: 'pA', address: '1 A St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    fakeDb._seed('invoiceRunItems', 'itemB', {
      runId: 'run1', agencyName: 'Max Tan', agentName: 'Max Tan', agentEmail: 'max@example.com',
      billingEntityType: 'independent', billingEntityKey: 'agent:agentB',
      properties: [{ propertyId: 'pB', address: '2 B St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(mockFindOrCreateContact).toHaveBeenCalledTimes(2);
    const name1 = mockFindOrCreateContact.mock.calls[0][0].name;
    const name2 = mockFindOrCreateContact.mock.calls[1][0].name;
    expect(name1).toBe('Harcourts Property Hub');
    expect(name2).toMatch(/^Harcourts Property Hub \(agentB/);
    expect(new Set([...xero.contacts.values()].map((c) => c.ContactID)).size).toBe(2);  // never merged
  });

  it('an agent with a CONFIRMED billing-email override (different from their login email) gets invoiced to that override, never their login email', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('billingContacts', 'agent:uidSolo', {
      status: 'confirmed', billingName: 'Jo Lee', name: 'Jo\'s Bookkeeper', email: 'bookkeeper@different-domain.example.com',
    });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', agencyName: 'Jo Lee', agentName: 'Jo Lee', agentEmail: 'jo.lee@login-email.example.com',
      billingEntityType: 'independent', billingEntityKey: 'agent:uidSolo',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('sent');
    expect(mockFindOrCreateContact).toHaveBeenCalledWith(expect.objectContaining({ email: 'bookkeeper@different-domain.example.com' }));
    expect(mockFindOrCreateContact).not.toHaveBeenCalledWith(expect.objectContaining({ email: 'jo.lee@login-email.example.com' }));
  });

  it('SECURITY: an agent with NO confirmed billing contact is BLOCKED entirely — never falls back to their own login email', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    // Deliberately no billingContacts doc at all for this key.
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', agencyName: 'Max Tan', agentName: 'Max Tan', agentEmail: 'max@login-email.example.com',
      billingEntityType: 'independent', billingEntityKey: 'agent:uidMax',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('failed');
    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(body.errors[0].error).toMatch(/[Bb]illing details required/);
    expect(mockMarkChargesFailed).toHaveBeenCalledWith(['p1'], { runId: 'run1' });

    const item = (await fakeDb.collection('invoiceRunItems').doc('item1').get()).data();
    expect(item.status).toBe('contact_required');
  });

  it('an item with no billingEntityType/billingEntityKey at all (older data shape) is safely blocked, never silently invoiced to a fallback contact', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      agencyName: 'Acme Agency',
      agentName: 'Jo Bloggs',
      agentEmail: 'jo@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    expect(body.errors[0].error).toMatch(/[Bb]illing details required/);
  });
});

// Every test using this helper is exercising something OTHER than the
// per-agent billing-contact requirement itself (GST handling,
// duplicate protection, idempotency, concurrency) — see
// billing-contact-confirmation.test.js for that feature's own
// dedicated tests — so a confirmed contact is seeded here by default,
// at the exact billingEntityKey send/route.js now requires one for.
function seedSingleItemRun(overrides = {}) {
  fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
  fakeDb._seed('billingContacts', 'agent:uid1', {
    status: 'confirmed', billingName: 'Acme Agency', name: 'Jo Bloggs', email: 'jo@example.com',
  });
  fakeDb._seed('invoiceRunItems', 'item1', {
    runId: 'run1',
    agencyName: 'Jo Bloggs',
    agentName: 'Jo Bloggs',
    agentEmail: 'jo@example.com',
    billingEntityType: 'independent',
    billingEntityKey: 'agent:uid1',
    properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    ...overrides,
  });
}

describe('POST .../send — duplicate-invoice protection (Priority 1)', () => {
  it('Xero invoice created successfully, email fails: charges stay invoiced, not released, and no second invoice is created', async () => {
    seedSingleItemRun();
    mockSendInvoice.mockRejectedValue(new Error('Xero email service unavailable'));

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('failed'); // the only item failed its EMAIL step
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    // This is the actual fix: markChargesInvoiced was called (charges are
    // invoiced), and markChargesFailed was NEVER called for this item —
    // a failed email must never release charges back to pending.
    expect(mockMarkChargesInvoiced).toHaveBeenCalledWith(['p1'], { runId: 'run1' });
    expect(mockMarkChargesFailed).not.toHaveBeenCalled();

    const item = (await fakeDb.collection('invoiceRunItems').doc('item1').get()).data();
    expect(item.status).toBe('email_failed');
    expect(item.xeroInvoiceId).toBe('inv1'); // the real invoice ID is recorded
    expect(item.lastEmailError).toMatch(/unavailable/);
  });

  it('retrying a run whose item already has a stored xeroInvoiceId never calls createInvoice again — only retries the email', async () => {
    seedSingleItemRun({ xeroInvoiceId: 'inv-existing', xeroInvoiceNumber: 'PM-0042', xeroStatus: 'AUTHORISED', status: 'email_failed' });
    // Approve again to re-trigger send (simulating an admin retry of a 'failed'/'partial' run moved back to approved — the point under test is what happens to an item that already has an invoice ID).
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('sent');
    expect(mockCreateInvoice).not.toHaveBeenCalled(); // never re-created
    expect(mockFindOrCreateContact).not.toHaveBeenCalled(); // never even looked up a contact again
    expect(mockSendInvoice).toHaveBeenCalledWith('inv-existing'); // retried against the EXISTING invoice
  });

  it('creation itself failing (e.g. a true timeout with no response at all) still safely releases charges for retry', async () => {
    seedSingleItemRun();
    mockCreateInvoice.mockRejectedValue(new Error('Xero request timed out'));

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('failed');
    expect(mockMarkChargesFailed).toHaveBeenCalledWith(['p1'], { runId: 'run1' });
    expect(mockMarkChargesInvoiced).not.toHaveBeenCalled();

    const item = (await fakeDb.collection('invoiceRunItems').doc('item1').get()).data();
    expect(item.status).toBe('error');
    expect(item.xeroInvoiceId).toBeUndefined();
  });

  it('attaches a stable, deterministic Idempotency-Key to the createInvoice call, so a blind retry after a timeout is safe at the Xero API level', async () => {
    seedSingleItemRun();
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    const key1 = mockCreateInvoice.mock.calls[0][0].idempotencyKey;
    expect(key1).toBeTruthy();

    // A second, independent send attempt for the SAME item (simulating
    // a retried request after the first one's response was lost) must
    // produce the exact same key.
    mockCreateInvoice.mockClear();
    fakeDb.collection('invoiceRunItems').doc('item1').update({ status: 'pending', xeroInvoiceId: undefined });
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    // The reference lookup misses (e.g. Xero hasn't indexed the first attempt yet), so only the
    // Idempotency-Key stands between this retry and a duplicate — it must be identical.
    mockFindInvoiceByReference.mockResolvedValueOnce(null);
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const key2 = mockCreateInvoice.mock.calls[0][0].idempotencyKey;

    expect(key2).toBe(key1);
  });

  it('the exact ambiguous-timeout scenario: Xero actually created the invoice, our connection timed out before we found out — a retry reconciles instead of duplicating', async () => {
    seedSingleItemRun();

    // Attempt 1: the create call itself throws (simulating a true
    // network timeout — this process never received ANY response, so
    // it genuinely cannot tell whether Xero processed the request).
    mockFindInvoiceByReference.mockResolvedValueOnce(null); // nothing to find yet, this is the very first attempt
    mockCreateInvoice.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const first = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect((await first.json()).status).toBe('failed');
    expect(mockMarkChargesFailed).toHaveBeenCalledWith(['p1'], { runId: 'run1' }); // safely released, since we don't yet know an invoice exists

    // Unbeknownst to Premarket, Xero actually DID create the invoice
    // during attempt 1 — simulate that by having the reconciliation
    // check find it on the retry.
    mockCreateInvoice.mockClear();
    mockMarkChargesFailed.mockClear();
    mockFindInvoiceByReference.mockResolvedValueOnce({ InvoiceID: 'inv-created-during-timeout', InvoiceNumber: 'PM-0007', Status: 'AUTHORISED', Contact: { ContactID: 'contact1' }, Total: 200 });
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });

    const second = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const secondBody = await second.json();

    expect(secondBody.status).toBe('sent');
    expect(mockCreateInvoice).not.toHaveBeenCalled(); // reconciliation found it first — never created a second one
    expect(mockSendInvoice).toHaveBeenCalledWith('inv-created-during-timeout');

    const item = (await fakeDb.collection('invoiceRunItems').doc('item1').get()).data();
    expect(item.xeroInvoiceId).toBe('inv-created-during-timeout');
  });

  it('checks for an existing invoice by reference before ever calling createInvoice, for any item with no stored invoice ID yet', async () => {
    seedSingleItemRun();
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(mockFindInvoiceByReference).toHaveBeenCalledTimes(1);
    const referenceChecked = mockFindInvoiceByReference.mock.calls[0][0];
    expect(referenceChecked).toMatch(/^PM-October 2026 - [A-F0-9]{10}$/);   // derived from the run item, not the contact name
    expect(referenceChecked).not.toContain('Acme Agency');

    // createInvoice must have been called strictly after the check,
    // not concurrently with or before it — order matters here, since
    // the whole point is to decide based on the check's result.
    const checkOrder = mockFindInvoiceByReference.mock.invocationCallOrder[0];
    const createOrder = mockCreateInvoice.mock.invocationCallOrder[0];
    expect(checkOrder).toBeLessThan(createOrder);
  });

  it('refuses a second concurrent send on the same run — the atomic approved -> sending claim prevents it', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'sending', periodStart: new Date('2026-10-01') }); // already claimed by "another" request
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', agencyName: 'Acme Agency', agentName: 'Jo Bloggs', agentEmail: 'jo@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(res.status).toBe(400);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('never bypasses admin approval — a draft run cannot be sent at all', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'draft', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', agencyName: 'Acme Agency', agentName: 'Jo Bloggs', agentEmail: 'jo@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(res.status).toBe(400);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });
});


describe('POST .../send — office (consolidated) invoices', () => {
  const officeItem = (over = {}) => ({
    runId: 'run1',
    agencyName: 'Harcourts Property Hub',
    agentName: 'HPH Accounts',
    agentEmail: 'accounts@hph.test',
    agentUserId: null,
    officeId: 'hphOffice1',
    billingEntityType: 'office',
    billingEntityKey: 'office:hphOffice1',
    properties: [
      { propertyId: 'p1', address: '1 Phil St', agentName: 'Phil Agent', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
      { propertyId: 'p2', address: '2 Sam St', agentName: 'Sam Agent', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
    ],
    ...over,
  });
  const seedOffice = () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('billingContacts', 'office:hphOffice1', { status: 'confirmed', billingName: 'Harcourts Property Hub', name: 'HPH Accounts', email: 'accounts@hph.test' });
  };

  it('sends ONE invoice for the office with a separate $200 line per property, to the confirmed office contact', async () => {
    seedOffice();
    fakeDb._seed('invoiceRunItems', 'item1', officeItem());
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });

    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems).toHaveLength(2);
    expect(call.lineItems.map((l) => [l.description, l.unitAmount, l.taxType])).toEqual([
      ['Premarket listing: 1 Phil St (Phil Agent)', 200, ZERO_GST_TAX_TYPE],
      ['Premarket listing: 2 Sam St (Sam Agent)', 200, ZERO_GST_TAX_TYPE],
    ]);
    expect(mockFindOrCreateContact.mock.calls[0][0]).toMatchObject({ email: 'accounts@hph.test' });
  });

  it('Xero contact name is EXACTLY the confirmed legal billing name — no office-id suffix, no "office:" prefix', async () => {
    seedOffice();
    fakeDb._seed('invoiceRunItems', 'item1', officeItem());
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect(mockFindOrCreateContact.mock.calls[0][0].name).toBe('Harcourts Property Hub');
    expect([...xero.contacts.keys()]).toEqual(['Harcourts Property Hub']);
  });

  it('an office with NO confirmed contact is blocked — never falls back to an agent\'s email', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', officeItem());
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
  });

  it('idempotency: an office item that already has a Xero invoice ID never creates a second invoice', async () => {
    seedOffice();
    fakeDb._seed('invoiceRunItems', 'item1', officeItem({ xeroInvoiceId: 'inv-existing', xeroInvoiceNumber: 'PM-9', xeroStatus: 'AUTHORISED' }));
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('idempotency: createInvoice is called with a stable idempotency key and the office reference is checked first', async () => {
    seedOffice();
    fakeDb._seed('invoiceRunItems', 'item1', officeItem());
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect(mockFindInvoiceByReference).toHaveBeenCalledTimes(1);
    expect(mockFindInvoiceByReference.mock.calls[0][0]).toMatch(/^PM-October 2026 - [A-F0-9]{10}$/);
    expect(mockCreateInvoice.mock.calls[0][0].idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('never bypasses admin approval for office invoices — a draft run cannot be sent', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'draft', periodStart: new Date('2026-10-01') });
    fakeDb._seed('billingContacts', 'office:hphOffice1', { status: 'confirmed', name: 'HPH Accounts', email: 'accounts@hph.test' });
    fakeDb._seed('invoiceRunItems', 'item1', officeItem());
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect(res.status).toBe(400);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('a mixed run keeps independent invoices exactly as before (original description, no agent suffix)', async () => {
    seedOffice();
    fakeDb._seed('billingContacts', 'agent:solo', { status: 'confirmed', name: 'Sol Solo', email: 'sol@solo.test' });
    fakeDb._seed('invoiceRunItems', 'item1', officeItem());
    fakeDb._seed('invoiceRunItems', 'item2', {
      runId: 'run1', agencyName: 'Sol Solo', agentName: 'Sol Solo', agentEmail: 'sol@solo.test',
      billingEntityType: 'independent', billingEntityKey: 'agent:solo',
      properties: [{ propertyId: 'p4', address: '4 Solo St', agentName: 'Sol Solo', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect(mockCreateInvoice).toHaveBeenCalledTimes(2);
    const descriptions = mockCreateInvoice.mock.calls.flatMap((c) => c[0].lineItems.map((l) => l.description));
    expect(descriptions).toContain('Premarket listing: 4 Solo St');
  });

  it('passes the approved ABN and billing address through to the Xero contact', async () => {
    seedOffice();
    fakeDb._seed('billingContacts', 'office:hphOffice1', {
      status: 'confirmed', billingName: 'Harcourts Property Hub Pty Ltd', name: 'HPH Accounts', email: 'accounts@hph.test',
      abn: '51 824 753 556', address: { line1: '1 George St', suburb: 'Sydney', state: 'NSW', postcode: '2000' },
    });
    fakeDb._seed('invoiceRunItems', 'item1', officeItem());
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect(mockFindOrCreateContact.mock.calls[0][0]).toMatchObject({
      taxNumber: '51 824 753 556',
      address: { line1: '1 George St', suburb: 'Sydney', state: 'NSW', postcode: '2000' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unique invoice references, verified reuse, stable HPH contact, idempotent charge marking
// ─────────────────────────────────────────────────────────────────────────────
describe('POST .../send — HPH consolidated invoices: unique references, verified retries, clean contact', () => {
  const HPH = 'office:hphOffice1';
  const LEGAL = 'Results Realty (QLD) Pty Ltd ATF Results Realty Trust trading as Harcourts Property Hub';
  const props = (ids) => ids.map((id, i) => ({ propertyId: id, address: `${i + 1} Test St`, agentName: i % 2 ? 'Sam Agent' : 'Phil Agent', subtotalEx: 200, gstAmount: 0, totalInc: 200 }));
  const seedContact = () => fakeDb._seed('billingContacts', HPH, {
    status: 'confirmed', billingName: LEGAL, name: 'Chris Manby', email: 'accounts@hph.test', abn: '68 677 191 726',
    address: { line1: '102-104/6 Waterfront Place', suburb: 'Robina', state: 'QLD', postcode: '4226' },
  });
  const seedRun = (runId, itemId, periodStart, propertyIds, over = {}) => {
    fakeDb._seed('invoiceRuns', runId, { status: 'approved', periodStart: new Date(periodStart) });
    fakeDb._seed('invoiceRunItems', itemId, {
      runId, agencyName: 'Harcourts Property Hub', agentName: 'HPH Accounts', agentEmail: 'accounts@hph.test',
      billingEntityType: 'office', billingEntityKey: HPH, officeId: 'hphOffice1', properties: props(propertyIds), ...over,
    });
  };
  const send = async (runId) => {
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeRequest(), { params: Promise.resolve({ runId }) });
    return res.json();
  };
  const refFor = (periodStart, itemId) => buildInvoiceReference({ prefix: 'PM-', periodStart: new Date(periodStart), itemId });
  const item = async (id) => (await fakeDb.collection('invoiceRunItems').doc(id).get()).data();

  it('REGRESSION: a second run for the same office in the same month creates its OWN invoice — it never reuses the first run\'s', async () => {
    seedContact();
    seedRun('run1', 'itemOct1', '2026-10-01', ['p1', 'p2']);
    expect((await send('run1')).status).toBe('sent');

    seedRun('run2', 'itemOct30', '2026-10-30', ['p3']);   // same calendar month, same office, same legal contact name
    expect((await send('run2')).status).toBe('sent');

    expect(xero.invoices).toHaveLength(2);
    expect(xero.invoices[0].Reference).not.toBe(xero.invoices[1].Reference);
    expect((await item('itemOct1')).xeroInvoiceId).toBe('inv1');
    expect((await item('itemOct30')).xeroInvoiceId).toBe('inv2');              // not inv1
    expect(mockMarkChargesInvoiced).toHaveBeenNthCalledWith(1, ['p1', 'p2'], { runId: 'run1' });
    expect(mockMarkChargesInvoiced).toHaveBeenNthCalledWith(2, ['p3'], { runId: 'run2' });   // run2\'s charges ARE on run2\'s own invoice
    expect(xero.invoices[1].Total).toBe(200);
  });

  it('multiple billing periods for the same office: distinct references, ONE Xero contact, the legal name, no suffix', async () => {
    seedContact();
    const periods = ['2026-11-23', '2026-12-23', '2027-01-01', '2027-01-31', '2027-03-02'];
    for (const [i, start] of periods.entries()) {
      seedRun(`run${i}`, `item${i}`, start, [`p${i}a`, `p${i}b`]);
      expect((await send(`run${i}`)).status).toBe('sent');
    }
    expect(xero.invoices).toHaveLength(5);
    expect(new Set(xero.invoices.map((i) => i.Reference)).size).toBe(5);
    expect(new Set(xero.invoices.map((i) => i.Contact.ContactID)).size).toBe(1);
    expect([...xero.contacts.keys()]).toEqual([LEGAL]);
  });

  it('the first run creates the contact and remembers it; later runs use the remembered id (no name lookup)', async () => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1']);
    await send('run1');
    expect(mockFindOrCreateContact).toHaveBeenCalledTimes(1);
    expect(mockFindOrCreateContact.mock.calls[0][0]).toMatchObject({ name: LEGAL, taxNumber: '68 677 191 726', email: 'accounts@hph.test' });
    expect(fakeDb._store.xeroContacts[HPH]).toMatchObject({ billingEntityKey: HPH, xeroContactId: 'contact1', xeroContactName: LEGAL });

    mockFindOrCreateContact.mockClear(); mockSearchContactByName.mockClear();
    seedRun('run2', 'item2', '2026-12-23', ['p2']);
    await send('run2');
    expect(mockGetContactById).toHaveBeenCalledWith('contact1');
    expect(mockSearchContactByName).not.toHaveBeenCalled();
    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    expect(xero.invoices[1].Contact.ContactID).toBe('contact1');
  });

  it('a retry after a blind timeout (Xero DID create the invoice) reuses it: one invoice, charges marked invoiced, same reference both times', async () => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1', 'p2']);
    mockCreateInvoice.mockImplementationOnce(async (args) => { await xero.createInvoice(args); throw new Error('ETIMEDOUT'); });

    expect((await send('run1')).status).toBe('failed');
    expect(xero.invoices).toHaveLength(1);                                   // Xero has it; we never learned that
    expect(mockMarkChargesFailed).toHaveBeenCalledWith(['p1', 'p2'], { runId: 'run1' });
    expect(mockMarkChargesInvoiced).not.toHaveBeenCalled();

    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-11-23') });
    expect((await send('run1')).status).toBe('sent');

    expect(xero.invoices).toHaveLength(1);                                   // never a second invoice
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    expect((await item('item1')).xeroInvoiceId).toBe('inv1');
    expect(mockMarkChargesInvoiced).toHaveBeenCalledWith(['p1', 'p2'], { runId: 'run1' });
    expect(xero.invoices[0].Reference).toBe(refFor('2026-11-23', 'item1'));   // stable: the retry looked up exactly this
  });

  it('sending the same run twice in a row never creates a second invoice', async () => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1']);
    await send('run1');
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-11-23') });
    await send('run1');
    expect(xero.invoices).toHaveLength(1);
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
  });

  it('CONFLICT: an invoice already under this exact reference but with a different total is NEVER reused or marked as covering these charges', async () => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1', 'p2']);
    const ref = refFor('2026-11-23', 'item1');
    xero.invoices.push({ InvoiceID: 'foreign', InvoiceNumber: 'PM-0001', Status: 'AUTHORISED', Reference: ref, Contact: { ContactID: 'contact1' }, Total: 200 });
    xero.contacts.set(LEGAL, { ContactID: 'contact1', Name: LEGAL, TaxNumber: '68677191726' });

    const body = await send('run1');
    expect(body.status).toBe('failed');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(mockMarkChargesInvoiced).not.toHaveBeenCalled();                  // NOT marked invoiced without being included
    expect(mockMarkChargesFailed).not.toHaveBeenCalled();                    // and NOT released to be billed again elsewhere
    expect(mockSendInvoice).not.toHaveBeenCalled();
    const it1 = await item('item1');
    expect(it1.status).toBe('error');
    expect(it1.xeroInvoiceId).toBeUndefined();
    expect(it1.lastError).toMatch(/already exists in Xero but is not this run's invoice/);
  });

  it.each([
    ['a VOIDED invoice', { Status: 'VOIDED', Total: 400, Contact: { ContactID: 'contact1' } }],
    ['an invoice for a different contact', { Status: 'AUTHORISED', Total: 400, Contact: { ContactID: 'other' } }],
    ['an invoice whose total cannot be verified', { Status: 'AUTHORISED', Contact: { ContactID: 'contact1' } }],
  ])('CONFLICT: %s under the reference blocks the item instead of being reused', async (_n, partial) => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1', 'p2']);
    xero.contacts.set(LEGAL, { ContactID: 'contact1', Name: LEGAL, TaxNumber: '68677191726' });
    xero.invoices.push({ InvoiceID: 'x1', InvoiceNumber: 'PM-0009', Reference: refFor('2026-11-23', 'item1'), ...partial });
    await send('run1');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(mockMarkChargesInvoiced).not.toHaveBeenCalled();
    expect(mockMarkChargesFailed).not.toHaveBeenCalled();
    expect((await item('item1')).status).toBe('error');
  });

  it('a legitimately matching existing invoice (same contact, same $400 total) IS reused', async () => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1', 'p2']);
    xero.contacts.set(LEGAL, { ContactID: 'contact1', Name: LEGAL, TaxNumber: '68677191726' });
    xero.invoices.push({ InvoiceID: 'mine', InvoiceNumber: 'PM-0010', Status: 'AUTHORISED', Reference: refFor('2026-11-23', 'item1'), Contact: { ContactID: 'contact1' }, Total: 400 });
    expect((await send('run1')).status).toBe('sent');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect((await item('item1')).xeroInvoiceId).toBe('mine');
    expect(mockMarkChargesInvoiced).toHaveBeenCalledWith(['p1', 'p2'], { runId: 'run1' });
  });

  it('retrying an item that already has an invoice re-runs the (idempotent) charge marking, so "invoice created but charges never marked" cannot persist', async () => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1', 'p2'], { xeroInvoiceId: 'inv-existing', xeroInvoiceNumber: 'PM-0042', xeroStatus: 'AUTHORISED', status: 'invoice_created' });
    expect((await send('run1')).status).toBe('sent');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(mockMarkChargesInvoiced).toHaveBeenCalledWith(['p1', 'p2'], { runId: 'run1' });
  });

  it('charges that were not queued in this run are reported on the item, never silently ignored; already-invoiced ones are fine', async () => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1', 'p2', 'p3']);
    mockMarkChargesInvoiced.mockResolvedValue({
      changed: ['p1'],
      skipped: [{ id: 'p2', status: 'pending', runId: null }, { id: 'p3', status: 'invoiced', runId: 'run1' }],
    });
    await send('run1');
    expect((await item('item1')).unmarkedCharges).toEqual([{ propertyId: 'p2', status: 'pending' }]);
  });

  it('if marking charges invoiced fails AFTER the invoice exists, the charges are NOT released for re-billing; the problem is recorded and the invoice is still delivered', async () => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1']);
    mockMarkChargesInvoiced.mockRejectedValue(new Error('transaction contention'));
    const body = await send('run1');
    expect(xero.invoices).toHaveLength(1);
    expect(mockMarkChargesFailed).not.toHaveBeenCalled();
    const it1 = await item('item1');
    expect(it1.chargeMarkError).toMatch(/contention/);
    expect(it1.xeroInvoiceId).toBe('inv1');
    expect(body.status).toBe('sent');
  });

  it('an archived Xero contact blocks the item before any invoice is created', async () => {
    seedContact();
    fakeDb._seed('xeroContacts', HPH, { billingEntityKey: HPH, xeroContactId: 'contact1' });
    xero.contacts.set(LEGAL, { ContactID: 'contact1', Name: LEGAL, ContactStatus: 'ARCHIVED' });
    seedRun('run1', 'item1', '2026-11-23', ['p1']);
    await send('run1');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect((await item('item1')).lastError).toMatch(/archived/i);
  });

  it('PRESERVED: one invoice per office, a $200 ex-GST line per property naming the agent, zero GST, 14-day terms', async () => {
    seedContact();
    seedRun('run1', 'item1', '2026-11-23', ['p1', 'p2']);
    await send('run1');
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems).toEqual([
      { description: 'Premarket listing: 1 Test St (Phil Agent)', quantity: 1, unitAmount: 200, taxType: ZERO_GST_TAX_TYPE },
      { description: 'Premarket listing: 2 Test St (Sam Agent)', quantity: 1, unitAmount: 200, taxType: ZERO_GST_TAX_TYPE },
    ]);
    const due = new Date(); due.setDate(due.getDate() + 14);
    expect(call.dueDate).toBe(due.toISOString().split('T')[0]);
    expect(call.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(call.reference).toMatch(/^PM-November 2026 - [A-F0-9]{10}$/);
    expect(xero.invoices[0].Total).toBe(400);
  });

  it('PRESERVED: an independent agent\'s invoice keeps its original description and also gets a unique reference', async () => {
    fakeDb._seed('billingContacts', 'agent:solo1', { status: 'confirmed', name: 'Solo Agent', email: 'solo@example.com', billingName: 'Solo Realty' });
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-11-01') });
    fakeDb._seed('invoiceRunItems', 'itemSolo', {
      runId: 'run1', agencyName: 'Solo Realty', agentName: 'Solo Agent', agentEmail: 'solo@example.com',
      billingEntityType: 'independent', billingEntityKey: 'agent:solo1',
      properties: [{ propertyId: 'ps', address: '9 Solo Rd', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    await send('run1');
    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems[0].description).toBe('Premarket listing: 9 Solo Rd');
    expect(call.reference).toBe(refFor('2026-11-01', 'itemSolo'));
    expect(mockFindOrCreateContact.mock.calls[0][0].name).toBe('Solo Realty');
  });
});

describe('POST .../send — zero-GST tax type is explicit (BASEXCLUDED), never the placeholder "NONE"', () => {
  const HPH = 'office:hphOffice1';
  const seedHph = (properties, over = {}) => {
    fakeDb._seed('billingContacts', HPH, { status: 'confirmed', billingName: 'Results Realty (QLD) Pty Ltd ATF Results Realty Trust trading as Harcourts Property Hub', name: 'Chris Manby', email: 'accounts@hph.test', abn: '68 677 191 726' });
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-11-23') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', agencyName: 'Harcourts Property Hub', agentName: 'HPH Accounts', agentEmail: 'accounts@hph.test',
      billingEntityType: 'office', billingEntityKey: HPH, officeId: 'hphOffice1', properties, ...over,
    });
  };
  const send = async () => {
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    return (await POST(makeRequest(), { params: Promise.resolve({ runId: 'run1' }) })).json();
  };

  it('HPH\'s $200 campaign fee: unit amount $200, tax type BASEXCLUDED, $0 GST and a $200 invoice total', async () => {
    seedHph([{ propertyId: 'p1', address: '1 Greenwich Avenue, Pimpama QLD, Australia', agentName: 'Phil Chillemi', subtotalEx: 200, gstAmount: 0, totalInc: 200 }]);
    expect((await send()).status).toBe('sent');
    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems).toEqual([{ description: 'Premarket listing: 1 Greenwich Avenue, Pimpama QLD, Australia (Phil Chillemi)', quantity: 1, unitAmount: 200, taxType: 'BASEXCLUDED' }]);
    expect(xero.invoices[0]).toMatchObject({ SubTotal: 200, TotalTax: 0, Total: 200 });
  });

  it('a consolidated HPH invoice of several $200 campaigns is all BASEXCLUDED, with $0 GST in total', async () => {
    seedHph(['a', 'b', 'c'].map((id, i) => ({ propertyId: id, address: `${i + 1} Test St`, agentName: 'Phil Chillemi', subtotalEx: 200, gstAmount: 0, totalInc: 200 })));
    await send();
    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems.every((l) => l.taxType === 'BASEXCLUDED' && l.unitAmount === 200)).toBe(true);
    expect(xero.invoices[0]).toMatchObject({ SubTotal: 600, TotalTax: 0, Total: 600 });
  });

  it('a line whose charge WAS snapshotted with GST still uses OUTPUT (GST handling preserved), alongside zero-GST lines', async () => {
    seedHph([
      { propertyId: 'p1', address: '1 Test St', agentName: 'Phil Chillemi', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
      { propertyId: 'p2', address: '2 Test St', agentName: 'Phil Chillemi', subtotalEx: 200, gstAmount: 20, totalInc: 220 },
    ]);
    await send();
    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.lineItems.map((l) => l.taxType)).toEqual([ZERO_GST_TAX_TYPE, GST_TAX_TYPE]);
    expect(xero.invoices[0]).toMatchObject({ SubTotal: 400, TotalTax: 20, Total: 420 });
  });

  it('an independent agent\'s $200 invoice is also BASEXCLUDED with $0 GST', async () => {
    fakeDb._seed('billingContacts', 'agent:solo', { status: 'confirmed', name: 'Solo Agent', email: 's@x.test', billingName: 'Solo Realty' });
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-11-01') });
    fakeDb._seed('invoiceRunItems', 'item1', { runId: 'run1', agencyName: 'Solo Realty', agentName: 'Solo Agent', agentEmail: 's@x.test', billingEntityType: 'independent', billingEntityKey: 'agent:solo', properties: [{ propertyId: 'ps', address: '9 Solo Rd', subtotalEx: 200, gstAmount: 0, totalInc: 200 }] });
    await send();
    expect(mockCreateInvoice.mock.calls[0][0].lineItems[0].taxType).toBe('BASEXCLUDED');
    expect(xero.invoices[0]).toMatchObject({ TotalTax: 0, Total: 200 });
  });

  it('the placeholder "NONE" is never sent to Xero on any line', async () => {
    seedHph([{ propertyId: 'p1', address: '1 Test St', agentName: 'Phil', subtotalEx: 200, gstAmount: 0, totalInc: 200 }]);
    await send();
    expect(JSON.stringify(mockCreateInvoice.mock.calls)).not.toContain('"NONE"');
  });
});
