import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

const mockIsXeroConnected = vi.fn();
const mockGetOrganisation = vi.fn();
const mockGetAccountByCode = vi.fn();
const mockSearchContactByName = vi.fn();
const mockFindOrCreateContact = vi.fn();
const mockCreateInvoice = vi.fn();
const mockSendInvoice = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  isXeroConnected: (...args) => mockIsXeroConnected(...args),
  getOrganisation: (...args) => mockGetOrganisation(...args),
  getAccountByCode: (...args) => mockGetAccountByCode(...args),
  searchContactByName: (...args) => mockSearchContactByName(...args),
  findOrCreateContact: (...args) => mockFindOrCreateContact(...args),
  createInvoice: (...args) => mockCreateInvoice(...args),
  sendInvoice: (...args) => mockSendInvoice(...args),
}));

function makeFakeDb() {
  const store = {};
  return {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({ exists: !!(store[name] && store[name][id]), data: () => store[name]?.[id] }),
      }),
    }),
    _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; },
    _store: store,
  };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

function makeRequest({ body, method = 'GET', authHeader = 'Bearer t' } = {}) {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    return new Request('http://localhost/test', { method, headers, body: JSON.stringify(body) });
  }
  return new Request('http://localhost/test', { method, headers });
}

const originalEnabled = process.env.XERO_DIAGNOSTIC_ENABLED;

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
  fakeDb._seed('users', 'admin1', { superAdmin: true });
});

afterEach(() => {
  process.env.XERO_DIAGNOSTIC_ENABLED = originalEnabled;
});

describe('GET /api/admin/invoicing/xero-diagnostic/preview', () => {
  it('404s when XERO_DIAGNOSTIC_ENABLED is not set — disabled by default, even for an admin', async () => {
    delete process.env.XERO_DIAGNOSTIC_ENABLED;
    const { GET } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/preview/route.js');
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(404);
    expect(mockIsXeroConnected).not.toHaveBeenCalled();
  });

  it('404s when XERO_DIAGNOSTIC_ENABLED is any value other than the literal string "true"', async () => {
    process.env.XERO_DIAGNOSTIC_ENABLED = 'yes';
    const { GET } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/preview/route.js');
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(404);
  });

  describe('once enabled', () => {
    beforeEach(() => { process.env.XERO_DIAGNOSTIC_ENABLED = 'true'; });

    it('401s with no auth header', async () => {
      const { GET } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/preview/route.js');
      const res = await GET(makeRequest({ authHeader: null }));
      expect(res.status).toBe(401);
    });

    it('403s for a non-admin', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
      fakeDb._seed('users', 'agent1', { superAdmin: false });
      const { GET } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/preview/route.js');
      const res = await GET(makeRequest({}));
      expect(res.status).toBe(403);
    });

    it('reports not-ready when Xero is not connected, without calling any other Xero function', async () => {
      mockIsXeroConnected.mockResolvedValue(false);
      const { GET } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/preview/route.js');
      const res = await GET(makeRequest({}));
      const data = await res.json();

      expect(data.connected).toBe(false);
      expect(data.readyToCreate).toBe(false);
      expect(mockGetOrganisation).not.toHaveBeenCalled();
      expect(mockGetAccountByCode).not.toHaveBeenCalled();
    });

    it('is ready when connected, the org resolves, and the account code is valid', async () => {
      mockIsXeroConnected.mockResolvedValue(true);
      mockGetOrganisation.mockResolvedValue({ Name: 'Premarket Group Pty Ltd' });
      mockGetAccountByCode.mockResolvedValue({ Code: '200', Name: 'Sales' });
      mockSearchContactByName.mockResolvedValue(null);
      fakeDb._seed('settings', 'invoicing', { xeroAccountCode: '200' });

      const { GET } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/preview/route.js');
      const res = await GET(makeRequest({}));
      const data = await res.json();

      expect(data.readyToCreate).toBe(true);
      expect(data.organisationName).toBe('Premarket Group Pty Ltd');
      expect(data.accountCodeValid).toBe(true);
      expect(data.testContact.name).toMatch(/TEST/);
    });

    it('is NOT ready when the configured account code does not exist in the connected org', async () => {
      mockIsXeroConnected.mockResolvedValue(true);
      mockGetOrganisation.mockResolvedValue({ Name: 'Premarket Group Pty Ltd' });
      mockGetAccountByCode.mockResolvedValue(null);
      mockSearchContactByName.mockResolvedValue(null);
      fakeDb._seed('settings', 'invoicing', { xeroAccountCode: '999' });

      const { GET } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/preview/route.js');
      const res = await GET(makeRequest({}));
      const data = await res.json();

      expect(data.readyToCreate).toBe(false);
      expect(data.accountCodeValid).toBe(false);
    });

    it('surfaces an already-existing test contact rather than silently ignoring it', async () => {
      mockIsXeroConnected.mockResolvedValue(true);
      mockGetOrganisation.mockResolvedValue({ Name: 'Premarket Group Pty Ltd' });
      mockGetAccountByCode.mockResolvedValue({ Code: '200', Name: 'Sales' });
      mockSearchContactByName.mockResolvedValue({ ContactID: 'existing-contact-1' });

      const { GET } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/preview/route.js');
      const res = await GET(makeRequest({}));
      const data = await res.json();

      expect(data.existingTestContactId).toBe('existing-contact-1');
    });

    it('never calls findOrCreateContact or createInvoice — purely read-only', async () => {
      mockIsXeroConnected.mockResolvedValue(true);
      mockGetOrganisation.mockResolvedValue({ Name: 'Premarket Group Pty Ltd' });
      mockGetAccountByCode.mockResolvedValue({ Code: '200', Name: 'Sales' });
      mockSearchContactByName.mockResolvedValue(null);

      const { GET } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/preview/route.js');
      await GET(makeRequest({}));

      expect(mockFindOrCreateContact).not.toHaveBeenCalled();
      expect(mockCreateInvoice).not.toHaveBeenCalled();
    });
  });
});

describe('POST /api/admin/invoicing/xero-diagnostic/create', () => {
  it('404s when XERO_DIAGNOSTIC_ENABLED is not set', async () => {
    delete process.env.XERO_DIAGNOSTIC_ENABLED;
    const { POST } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/create/route.js');
    const res = await POST(makeRequest({ method: 'POST', body: { confirm: true } }));
    expect(res.status).toBe(404);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  describe('once enabled', () => {
    beforeEach(() => { process.env.XERO_DIAGNOSTIC_ENABLED = 'true'; });

    it('401s with no auth header', async () => {
      const { POST } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/create/route.js');
      const res = await POST(makeRequest({ method: 'POST', body: { confirm: true }, authHeader: null }));
      expect(res.status).toBe(401);
    });

    it('403s for a non-admin', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
      fakeDb._seed('users', 'agent1', { superAdmin: false });
      const { POST } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/create/route.js');
      const res = await POST(makeRequest({ method: 'POST', body: { confirm: true } }));
      expect(res.status).toBe(403);
    });

    it('refuses without confirm: true in the body, and never calls Xero at all', async () => {
      const { POST } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/create/route.js');
      const res = await POST(makeRequest({ method: 'POST', body: {} }));
      expect(res.status).toBe(400);
      expect(mockIsXeroConnected).not.toHaveBeenCalled();
      expect(mockFindOrCreateContact).not.toHaveBeenCalled();
      expect(mockCreateInvoice).not.toHaveBeenCalled();
    });

    it('refuses confirm: "true" (string) — only the literal boolean true is accepted', async () => {
      const { POST } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/create/route.js');
      const res = await POST(makeRequest({ method: 'POST', body: { confirm: 'true' } }));
      expect(res.status).toBe(400);
      expect(mockCreateInvoice).not.toHaveBeenCalled();
    });

    it('400s when Xero is not connected, even with confirm: true', async () => {
      mockIsXeroConnected.mockResolvedValue(false);
      const { POST } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/create/route.js');
      const res = await POST(makeRequest({ method: 'POST', body: { confirm: true } }));
      expect(res.status).toBe(400);
      expect(mockCreateInvoice).not.toHaveBeenCalled();
    });

    it('creates exactly one DRAFT, GST-free, $200 invoice for the dedicated test contact, and NEVER calls sendInvoice', async () => {
      mockIsXeroConnected.mockResolvedValue(true);
      mockFindOrCreateContact.mockResolvedValue({ ContactID: 'test-contact-1' });
      mockCreateInvoice.mockResolvedValue({ InvoiceID: 'test-inv-1', InvoiceNumber: 'PM-TEST-1', Status: 'DRAFT' });
      fakeDb._seed('settings', 'invoicing', { xeroAccountCode: '200' });

      const { POST } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/create/route.js');
      const res = await POST(makeRequest({ method: 'POST', body: { confirm: true } }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe('DRAFT');

      expect(mockFindOrCreateContact).toHaveBeenCalledTimes(1);
      const contactArg = mockFindOrCreateContact.mock.calls[0][0];
      expect(contactArg.name).toMatch(/TEST/);
      expect(contactArg.email).not.toMatch(/agency|customer/i);

      expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
      const invoiceArg = mockCreateInvoice.mock.calls[0][0];
      expect(invoiceArg.status).toBe('DRAFT');
      expect(invoiceArg.accountCode).toBe('200');
      expect(invoiceArg.lineItems).toHaveLength(1);
      expect(invoiceArg.lineItems[0].unitAmount).toBe(200);
      expect(invoiceArg.lineItems[0].taxType).toBe('NONE');
      expect(invoiceArg.reference).toMatch(/TEST/);

      expect(mockSendInvoice).not.toHaveBeenCalled(); // the entire point — never emailed
    });

    it('never touches propertyCharges, invoiceRuns, invoiceRunItems, or billingActivatedAt', async () => {
      mockIsXeroConnected.mockResolvedValue(true);
      mockFindOrCreateContact.mockResolvedValue({ ContactID: 'test-contact-1' });
      mockCreateInvoice.mockResolvedValue({ InvoiceID: 'test-inv-1', InvoiceNumber: 'PM-TEST-1', Status: 'DRAFT' });

      const { POST } = await import('../../src/app/api/admin/invoicing/xero-diagnostic/create/route.js');
      await POST(makeRequest({ method: 'POST', body: { confirm: true } }));

      expect(fakeDb._store.propertyCharges).toBeUndefined();
      expect(fakeDb._store.invoiceRuns).toBeUndefined();
      expect(fakeDb._store.invoiceRunItems).toBeUndefined();
      // settings/invoicing was only ever read (for xeroAccountCode), never written.
      expect(fakeDb._store.settings?.invoicing?.billingActivatedAt).toBeUndefined();
    });
  });
});
