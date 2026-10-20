import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const mockFindOrCreateContact = vi.fn();
const mockCreateInvoice = vi.fn();
const mockMakeXeroRequest = vi.fn();
// Deliberately NOT mocking sendInvoice at all — if this feature ever
// accidentally called it, the mock module wouldn't provide it and the
// call would throw, making that mistake loud rather than silent.
vi.mock('../../src/app/api/services/xeroService', () => ({
  findOrCreateContact: (...args) => mockFindOrCreateContact(...args),
  createInvoice: (...args) => mockCreateInvoice(...args),
  makeXeroRequest: (...args) => mockMakeXeroRequest(...args),
}));

const mockBuildAgencyInvoicePreview = vi.fn();
vi.mock('../../src/app/api/services/invoicePreviewService', () => ({
  buildAgencyInvoicePreview: (...args) => mockBuildAgencyInvoicePreview(...args),
}));

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

function makeFakeDb() {
  const store = {};
  function col(name) {
    store[name] = store[name] || {};
    return {
      doc(id) {
        return { id, _col: name, async get() { const data = store[name][id]; return { exists: !!data, id, data: () => data }; } };
      },
      where(field, op, value) {
        function matches(raw, f, o, v) { if (o === '==') return raw[f] === v; return true; }
        function makeQuery(docs) {
          return {
            where: (f2, o2, v2) => makeQuery(docs.filter((d) => matches(d._raw, f2, o2, v2))),
            limit: (n) => makeQuery(docs.slice(0, n)),
            get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
          };
        }
        const all = Object.entries(store[name]).map(([docId, data]) => ({ id: docId, data: () => data, _raw: data }));
        return makeQuery(all.filter((d) => matches(d._raw, field, op, value)));
      },
    };
  }
  return { collection: col, _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

const PHIL_PREVIEW = {
  agentUserId: 'philUid',
  agentName: 'Phil Chillemi',
  agencyName: 'Harcourts Property Hub',
  billingContact: { name: 'Phil Chillemi', email: 'phil@propertyhubgc.com.au' },
  properties: [
    { propertyId: 'p1', address: '137-139 Crescent Ave, Hope Island QLD 4212', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
    { propertyId: 'p2', address: '21 Palladium Blvd, Hope Island QLD 4212', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
    { propertyId: 'p3', address: '7 Jingella St, Hope Island QLD 4212', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
    { propertyId: 'p4', address: '23 Esplanade, Jacobs Well QLD 4208', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
    { propertyId: 'p5', address: '1 Parnell Bvd, Robina QLD 4226', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
  ],
  propertyCount: 5,
  pricePerListing: 200,
  gstRate: 0,
  paymentTermsDays: 14,
  invoicePrefix: 'PM-',
  xeroAccountCode: '200',
  subtotalEx: 1000,
  gstAmount: 0,
  totalInc: 1000,
};

// The GET /Invoices?where=... duplicate-check and the POST /Invoices
// create both go through makeXeroRequest — tell them apart by method.
function mockMakeXeroRequestByMethod({ onGet, onPost } = {}) {
  mockMakeXeroRequest.mockImplementation(async (method, path, body, retry, extraHeaders) => {
    if (method === 'GET') return (onGet && onGet(path)) || { Invoices: [] };
    if (method === 'POST') return (onPost && onPost(path, body, extraHeaders)) || { Invoices: [{ InvoiceID: 'inv-default', Status: 'DRAFT' }] };
    throw new Error(`Unexpected method in test: ${method}`);
  });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
  mockBuildAgencyInvoicePreview.mockResolvedValue(PHIL_PREVIEW);
  mockMakeXeroRequestByMethod(); // no existing test invoice, by default
});

describe('previewXeroTestInvoice (read-only)', () => {
  it('proposes exactly 5 line items at $200 each, DRAFT status, correct reference/contact', async () => {
    const { previewXeroTestInvoice, TEST_CONTACT_NAME, TEST_REFERENCE } = await import('../../src/app/api/services/xeroTestInvoiceService.js');
    const result = await previewXeroTestInvoice({ agentUserId: 'philUid' });

    expect(result.proposedInvoice.lineItems).toHaveLength(5);
    expect(result.proposedInvoice.lineItems.every((li) => li.unitAmount === 200 && li.taxType === 'NONE')).toBe(true);
    expect(result.proposedInvoice.status).toBe('DRAFT');
    expect(result.proposedInvoice.contactName).toBe(TEST_CONTACT_NAME);
    expect(result.proposedInvoice.reference).toBe(TEST_REFERENCE);
    expect(result.proposedInvoice.totalInc).toBe(1000);
    expect(result.proposedInvoice.gstAmount).toBe(0);
    expect(result.alreadyExists).toBe(false);

    // Never calls any write — findOrCreateContact/createInvoice untouched,
    // and the only makeXeroRequest call was the read-only GET check.
    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(mockMakeXeroRequest).toHaveBeenCalledTimes(1);
    expect(mockMakeXeroRequest.mock.calls[0][0]).toBe('GET');
  });

  it('reports alreadyExists: true when a matching test invoice is found', async () => {
    mockMakeXeroRequestByMethod({ onGet: () => ({ Invoices: [{ InvoiceID: 'existing-123', InvoiceNumber: 'PM-0001', Status: 'DRAFT' }] }) });
    const { previewXeroTestInvoice } = await import('../../src/app/api/services/xeroTestInvoiceService.js');
    const result = await previewXeroTestInvoice({ agentUserId: 'philUid' });

    expect(result.alreadyExists).toBe(true);
    expect(result.existingInvoice.invoiceId).toBe('existing-123');
  });

  it('throws for an account with zero properties, without calling Xero', async () => {
    mockBuildAgencyInvoicePreview.mockResolvedValue({ ...PHIL_PREVIEW, propertyCount: 0, properties: [] });
    const { previewXeroTestInvoice } = await import('../../src/app/api/services/xeroTestInvoiceService.js');
    await expect(previewXeroTestInvoice({ agentUserId: 'empty1' })).rejects.toThrow();
    expect(mockMakeXeroRequest).not.toHaveBeenCalled();
  });
});

describe('createXeroTestInvoice (the one real write)', () => {
  it('refuses without confirm: true, and never calls Xero at all', async () => {
    const { createXeroTestInvoice } = await import('../../src/app/api/services/xeroTestInvoiceService.js');
    await expect(createXeroTestInvoice({ agentUserId: 'philUid', confirm: false })).rejects.toThrow(/confirm/i);
    expect(mockMakeXeroRequest).not.toHaveBeenCalled();
    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('creates exactly one DRAFT invoice with 5 real line items when confirmed, carrying a stable Idempotency-Key', async () => {
    mockFindOrCreateContact.mockResolvedValue({ ContactID: 'contact-abc' });
    let capturedHeaders;
    let capturedBody;
    mockMakeXeroRequestByMethod({
      onPost: (path, body, extraHeaders) => {
        capturedBody = body;
        capturedHeaders = extraHeaders;
        return { Invoices: [{ InvoiceID: 'inv-xyz', InvoiceNumber: 'PM-0099', Status: 'DRAFT' }] };
      },
    });

    const { createXeroTestInvoice, TEST_REFERENCE } = await import('../../src/app/api/services/xeroTestInvoiceService.js');
    const result = await createXeroTestInvoice({ agentUserId: 'philUid', confirm: true });

    expect(result.created).toBe(true);
    expect(result.invoiceId).toBe('inv-xyz');
    expect(result.total).toBe(1000);
    expect(result.propertyCount).toBe(5);

    // The shared createInvoice() is never used by this feature — the
    // invoice body is built and sent directly so a custom header can
    // be attached without widening that shared function's signature.
    expect(mockCreateInvoice).not.toHaveBeenCalled();

    const invoice = capturedBody.Invoices[0];
    expect(invoice.Status).toBe('DRAFT');
    expect(invoice.Reference).toBe(TEST_REFERENCE);
    expect(invoice.LineItems).toHaveLength(5);
    expect(invoice.LineItems.every((li) => li.UnitAmount === 200 && li.TaxType === 'NONE')).toBe(true);

    expect(capturedHeaders['Idempotency-Key']).toBeTruthy();
    expect(typeof capturedHeaders['Idempotency-Key']).toBe('string');
  });

  it('uses the exact same Idempotency-Key across two separate calls for the same agent', async () => {
    mockFindOrCreateContact.mockResolvedValue({ ContactID: 'contact-abc' });
    const capturedKeys = [];
    mockMakeXeroRequestByMethod({
      onPost: (path, body, extraHeaders) => {
        capturedKeys.push(extraHeaders['Idempotency-Key']);
        return { Invoices: [{ InvoiceID: 'inv-xyz', Status: 'DRAFT' }] };
      },
    });

    const { createXeroTestInvoice } = await import('../../src/app/api/services/xeroTestInvoiceService.js');
    await createXeroTestInvoice({ agentUserId: 'philUid', confirm: true });
    // Simulate a second, independent call (e.g. a retried request) for the same agent
    await createXeroTestInvoice({ agentUserId: 'philUid', confirm: true });

    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).toBe(capturedKeys[1]);
  });

  it('refuses to create a second test invoice when one already exists, without calling Xero to write anything', async () => {
    mockMakeXeroRequestByMethod({ onGet: () => ({ Invoices: [{ InvoiceID: 'existing-123', InvoiceNumber: 'PM-0001', Status: 'DRAFT' }] }) });
    const { createXeroTestInvoice } = await import('../../src/app/api/services/xeroTestInvoiceService.js');
    const result = await createXeroTestInvoice({ agentUserId: 'philUid', confirm: true });

    expect(result.created).toBe(false);
    expect(result.reason).toBe('already-exists');
    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    // Only the read-only GET happened — no POST at all
    expect(mockMakeXeroRequest).toHaveBeenCalledTimes(1);
    expect(mockMakeXeroRequest.mock.calls[0][0]).toBe('GET');
  });

  it('has no force override at all — passing one has no effect, the duplicate is still refused', async () => {
    mockMakeXeroRequestByMethod({ onGet: () => ({ Invoices: [{ InvoiceID: 'existing-123', Status: 'DRAFT' }] }) });
    const { createXeroTestInvoice } = await import('../../src/app/api/services/xeroTestInvoiceService.js');
    const result = await createXeroTestInvoice({ agentUserId: 'philUid', confirm: true, force: true });

    expect(result.created).toBe(false);
    expect(result.reason).toBe('already-exists');
    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
  });

  it('never accepts a caller-supplied status — always DRAFT regardless of what is passed in', async () => {
    mockFindOrCreateContact.mockResolvedValue({ ContactID: 'contact-abc' });
    let capturedBody;
    mockMakeXeroRequestByMethod({
      onPost: (path, body) => { capturedBody = body; return { Invoices: [{ InvoiceID: 'inv-xyz', Status: 'DRAFT' }] }; },
    });

    const { createXeroTestInvoice } = await import('../../src/app/api/services/xeroTestInvoiceService.js');
    // status isn't even a parameter this function accepts — confirms the call site can't smuggle one through
    await createXeroTestInvoice({ agentUserId: 'philUid', confirm: true, status: 'AUTHORISED' });

    expect(capturedBody.Invoices[0].Status).toBe('DRAFT');
  });
});

describe('xeroTestInvoiceService.js never imports a real charge-creation path or sendInvoice', () => {
  it('source contains none of the forbidden names, outside comments', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/services/xeroTestInvoiceService.js'),
      'utf8'
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const forbidden = [
      'recordPropertyCharge',
      'createPropertyAndChargeAtomically',
      'ensureChargesForProperties',
      'reconcileMissingCharges',
      'createInvoiceRunFromPendingCharges',
      'sendInvoice',
    ];
    for (const name of forbidden) {
      expect(code).not.toContain(name);
    }
  });
});

describe('GET /api/admin/invoicing/xero-test-invoice/preview', () => {
  const originalEnv = process.env.XERO_DIAGNOSTIC_ENABLED;
  function makeRequest(url, authHeader) {
    const headers = new Headers();
    if (authHeader) headers.set('authorization', authHeader);
    return new Request(url, { method: 'GET', headers });
  }

  it('404s when XERO_DIAGNOSTIC_ENABLED is not "true"', async () => {
    delete process.env.XERO_DIAGNOSTIC_ENABLED;
    const { GET } = await import('../../src/app/api/admin/invoicing/xero-test-invoice/preview/route.js');
    const res = await GET(makeRequest('http://localhost/test?email=phil@propertyhubgc.com.au'));
    expect(res.status).toBe(404);
    process.env.XERO_DIAGNOSTIC_ENABLED = originalEnv;
  });

  it('401s with no auth header, even when enabled', async () => {
    process.env.XERO_DIAGNOSTIC_ENABLED = 'true';
    const { GET } = await import('../../src/app/api/admin/invoicing/xero-test-invoice/preview/route.js');
    const res = await GET(makeRequest('http://localhost/test?email=phil@propertyhubgc.com.au'));
    expect(res.status).toBe(401);
    process.env.XERO_DIAGNOSTIC_ENABLED = originalEnv;
  });

  it('403s for an authenticated non-admin', async () => {
    process.env.XERO_DIAGNOSTIC_ENABLED = 'true';
    mockVerifyIdToken.mockResolvedValue({ uid: 'intruder' });
    fakeDb._seed('users', 'intruder', { superAdmin: false });
    const { GET } = await import('../../src/app/api/admin/invoicing/xero-test-invoice/preview/route.js');
    const res = await GET(makeRequest('http://localhost/test?email=phil@propertyhubgc.com.au', 'Bearer t'));
    expect(res.status).toBe(403);
    process.env.XERO_DIAGNOSTIC_ENABLED = originalEnv;
  });

  it('returns a full preview for an admin, with Phil\'s real-shaped data', async () => {
    process.env.XERO_DIAGNOSTIC_ENABLED = 'true';
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('users', 'philUid', { email: 'phil@propertyhubgc.com.au' });

    const { GET } = await import('../../src/app/api/admin/invoicing/xero-test-invoice/preview/route.js');
    const res = await GET(makeRequest('http://localhost/test?email=phil@propertyhubgc.com.au', 'Bearer t'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.proposedInvoice.lineItems).toHaveLength(5);
    expect(data.proposedInvoice.totalInc).toBe(1000);
    process.env.XERO_DIAGNOSTIC_ENABLED = originalEnv;
  });
});

describe('POST /api/admin/invoicing/xero-test-invoice/create', () => {
  const originalEnv = process.env.XERO_DIAGNOSTIC_ENABLED;
  function makeRequest(body, authHeader) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (authHeader) headers.set('authorization', authHeader);
    return new Request('http://localhost/test', { method: 'POST', headers, body: JSON.stringify(body) });
  }

  it('404s when XERO_DIAGNOSTIC_ENABLED is not "true"', async () => {
    delete process.env.XERO_DIAGNOSTIC_ENABLED;
    const { POST } = await import('../../src/app/api/admin/invoicing/xero-test-invoice/create/route.js');
    const res = await POST(makeRequest({ email: 'phil@propertyhubgc.com.au', confirm: true }));
    expect(res.status).toBe(404);
    process.env.XERO_DIAGNOSTIC_ENABLED = originalEnv;
  });

  it('400s without confirm: true, even for an admin, and never touches Xero', async () => {
    process.env.XERO_DIAGNOSTIC_ENABLED = 'true';
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });

    const { POST } = await import('../../src/app/api/admin/invoicing/xero-test-invoice/create/route.js');
    const res = await POST(makeRequest({ email: 'phil@propertyhubgc.com.au' }, 'Bearer t'));
    expect(res.status).toBe(400);
    expect(mockMakeXeroRequest).not.toHaveBeenCalled();
    process.env.XERO_DIAGNOSTIC_ENABLED = originalEnv;
  });

  it('403s for a non-admin even with confirm: true', async () => {
    process.env.XERO_DIAGNOSTIC_ENABLED = 'true';
    mockVerifyIdToken.mockResolvedValue({ uid: 'intruder' });
    fakeDb._seed('users', 'intruder', { superAdmin: false });

    const { POST } = await import('../../src/app/api/admin/invoicing/xero-test-invoice/create/route.js');
    const res = await POST(makeRequest({ email: 'phil@propertyhubgc.com.au', confirm: true }, 'Bearer t'));
    expect(res.status).toBe(403);
    expect(mockMakeXeroRequest).not.toHaveBeenCalled();
    process.env.XERO_DIAGNOSTIC_ENABLED = originalEnv;
  });

  it('succeeds end-to-end for an admin with confirm: true', async () => {
    process.env.XERO_DIAGNOSTIC_ENABLED = 'true';
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('users', 'philUid', { email: 'phil@propertyhubgc.com.au' });
    mockFindOrCreateContact.mockResolvedValue({ ContactID: 'contact-abc' });

    const { POST } = await import('../../src/app/api/admin/invoicing/xero-test-invoice/create/route.js');
    const res = await POST(makeRequest({ email: 'phil@propertyhubgc.com.au', confirm: true }, 'Bearer t'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.created).toBe(true);
    process.env.XERO_DIAGNOSTIC_ENABLED = originalEnv;
  });
});
