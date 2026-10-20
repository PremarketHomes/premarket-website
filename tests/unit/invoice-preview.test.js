import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
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
        return {
          id,
          _col: name,
          async get() {
            const data = store[name][id];
            return { exists: !!data, id, data: () => data };
          },
        };
      },
      where(field, op, value) {
        function matches(raw, f, o, v) {
          if (o === '==') return raw[f] === v;
          if (o === 'array-contains') return Array.isArray(raw[f]) && raw[f].includes(v);
          return true;
        }
        function makeQuery(docs) {
          return {
            where: (f2, o2, v2) => makeQuery(docs.filter((d) => matches(d._raw, f2, o2, v2))),
            limit: (n) => makeQuery(docs.slice(0, n)),
            get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
          };
        }
        const all = Object.entries(store[name]).map(([docId, data]) => ({
          id: docId,
          data: () => data,
          _raw: data,
        }));
        return makeQuery(all.filter((d) => matches(d._raw, field, op, value)));
      },
      async get() {
        const docs = Object.entries(store[name]).map(([docId, data]) => ({ id: docId, data: () => data }));
        return { docs, empty: docs.length === 0 };
      },
    };
  }
  return {
    collection: col,
    _store: store,
    _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; },
  };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

function makeRequest({ url, authHeader } = {}) {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new Request(url || 'http://localhost/api/admin/invoicing/preview', { method: 'GET', headers });
}

function seedPhilLikeAccount() {
  fakeDb._seed('users', 'philUid', {
    email: 'phil@propertyhubgc.com.au',
    firstName: 'Phil',
    lastName: 'Chillemi',
    companyName: 'Harcourts Property Hub',
    superAdmin: true,
  });
  fakeDb._seed('settings', 'invoicing', {
    pricePerListing: 200,
    gstRate: 0,
    paymentTermsDays: 14,
    invoicePrefix: 'PM-',
    excludeAgentIds: [],
  });
  const addresses = [
    '137-139 Crescent Ave, Hope Island QLD 4212',
    '21 Palladium Blvd, Hope Island QLD 4212',
    '7 Jingella St, Hope Island QLD 4212',
    '23 Esplanade, Jacobs Well QLD 4208',
    '1 Parnell Bvd, Robina QLD 4226',
  ];
  addresses.forEach((address, i) => {
    fakeDb._seed('properties', `prop${i + 1}`, {
      userId: 'philUid',
      formattedAddress: address,
      createdAt: new Date(2026, 8, 9 + i),
    });
  });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
});

describe('buildAgencyInvoicePreview (pure/read-only)', () => {
  it('computes exactly 5 line items totalling $1,000 with $0 GST for a 5-property agent', async () => {
    seedPhilLikeAccount();
    const { buildAgencyInvoicePreview } = await import('../../src/app/api/services/invoicePreviewService.js');
    const preview = await buildAgencyInvoicePreview({ agentUserId: 'philUid' });

    expect(preview.propertyCount).toBe(5);
    expect(preview.subtotalEx).toBe(1000);
    expect(preview.gstAmount).toBe(0);
    expect(preview.totalInc).toBe(1000);
    expect(preview.agencyName).toBe('Harcourts Property Hub');
    // Regression: getInvoicingSettings() (billingService.js) never
    // returns these three fields — buildAgencyInvoicePreview must
    // read them itself rather than silently passing through undefined.
    expect(preview.paymentTermsDays).toBe(14);
    expect(preview.invoicePrefix).toBe('PM-');
    expect(preview.xeroAccountCode).toBe('200');
    expect(preview.properties.map((p) => p.address)).toEqual([
      '137-139 Crescent Ave, Hope Island QLD 4212',
      '21 Palladium Blvd, Hope Island QLD 4212',
      '7 Jingella St, Hope Island QLD 4212',
      '23 Esplanade, Jacobs Well QLD 4208',
      '1 Parnell Bvd, Robina QLD 4226',
    ]);
    preview.properties.forEach((p) => expect(p.totalInc).toBe(200));
  });

  it('never writes to propertyCharges, invoiceRuns, or invoiceRunItems', async () => {
    seedPhilLikeAccount();
    const { buildAgencyInvoicePreview } = await import('../../src/app/api/services/invoicePreviewService.js');
    await buildAgencyInvoicePreview({ agentUserId: 'philUid' });

    expect(fakeDb._store.propertyCharges).toBeUndefined();
    expect(fakeDb._store.invoiceRuns).toBeUndefined();
    expect(fakeDb._store.invoiceRunItems).toBeUndefined();
  });

  it('returns propertyCount: 0 for an agent with no properties, without throwing', async () => {
    fakeDb._seed('users', 'empty1', { email: 'nobody@example.com', firstName: 'No', lastName: 'Body' });
    const { buildAgencyInvoicePreview } = await import('../../src/app/api/services/invoicePreviewService.js');
    const preview = await buildAgencyInvoicePreview({ agentUserId: 'empty1' });
    expect(preview.propertyCount).toBe(0);
  });

  it('throws for a nonexistent agent account', async () => {
    const { buildAgencyInvoicePreview } = await import('../../src/app/api/services/invoicePreviewService.js');
    await expect(buildAgencyInvoicePreview({ agentUserId: 'doesNotExist' })).rejects.toThrow();
  });
});

describe('buildTestInvoicePreviewEmail', () => {
  it('includes the TEST banner, line items, total, and a clickable billing-enquiries mailto link', async () => {
    seedPhilLikeAccount();
    const { buildAgencyInvoicePreview, buildTestInvoicePreviewEmail } = await import('../../src/app/api/services/invoicePreviewService.js');
    const preview = await buildAgencyInvoicePreview({ agentUserId: 'philUid' });
    const email = buildTestInvoicePreviewEmail(preview);

    expect(email.html).toMatch(/TEST ONLY — NO PAYMENT REQUIRED/);
    expect(email.html).toMatch(/No payment is required and no action is necessary/);
    expect(email.html).toContain('137-139 Crescent Ave, Hope Island QLD 4212');
    expect(email.html).toContain('$200.00');
    expect(email.html).toMatch(/\$1000\.00|\$1,000\.00/);
    expect(email.html).toContain('mailto:accounts@premarket.homes');
    expect(email.subject).toMatch(/^\[TEST\]/);
  });

  it('shows the real billing entity, Premarket Group Pty Ltd, not the consumer brand', async () => {
    seedPhilLikeAccount();
    const { buildAgencyInvoicePreview, buildTestInvoicePreviewEmail } = await import('../../src/app/api/services/invoicePreviewService.js');
    const preview = await buildAgencyInvoicePreview({ agentUserId: 'philUid' });
    const email = buildTestInvoicePreviewEmail(preview);

    expect(email.html).toContain('Premarket Group Pty Ltd');
    expect(email.html).not.toContain('Premarket Australia');
  });

  it('never includes a payment button or an online-invoice link', async () => {
    seedPhilLikeAccount();
    const { buildAgencyInvoicePreview, buildTestInvoicePreviewEmail } = await import('../../src/app/api/services/invoicePreviewService.js');
    const preview = await buildAgencyInvoicePreview({ agentUserId: 'philUid' });
    const email = buildTestInvoicePreviewEmail(preview);

    expect(email.html).not.toMatch(/Pay Now/i);
    expect(email.html).not.toMatch(/OnlineInvoiceUrl/i);
    expect(email.html).not.toMatch(/xero\.com/i);
  });
});

describe('invoicePreviewService.js never imports a real charge/invoice-creation path (structural guarantee)', () => {
  it('source contains none of the persisting billing/Xero function names, outside of comments', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/services/invoicePreviewService.js'),
      'utf8'
    );
    // Strip // line comments and /* */ block comments before checking —
    // the file's own header deliberately NAMES these functions in prose
    // to document what must never be imported; that documentation
    // should not itself trip the check it's describing.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const forbidden = [
      'recordPropertyCharge',
      'createPropertyAndChargeAtomically',
      'ensureChargesForProperties',
      'reconcileMissingCharges',
      'createInvoiceRunFromPendingCharges',
      'createInvoice(',
      'sendInvoice(',
      'xeroService',
    ];
    for (const name of forbidden) {
      expect(code).not.toContain(name);
    }
  });
});

describe('GET /api/admin/invoicing/preview', () => {
  it('401s with no auth header', async () => {
    const { GET } = await import('../../src/app/api/admin/invoicing/preview/route.js');
    const res = await GET(makeRequest({ url: 'http://localhost/api/admin/invoicing/preview?email=phil@propertyhubgc.com.au' }));
    expect(res.status).toBe(401);
  });

  it('403s for an authenticated non-admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'intruder' });
    fakeDb._seed('users', 'intruder', { superAdmin: false });
    const { GET } = await import('../../src/app/api/admin/invoicing/preview/route.js');
    const res = await GET(makeRequest({ url: 'http://localhost/api/admin/invoicing/preview?email=phil@propertyhubgc.com.au', authHeader: 'Bearer t' }));
    expect(res.status).toBe(403);
  });

  it('400s with no email query param, even for an admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    const { GET } = await import('../../src/app/api/admin/invoicing/preview/route.js');
    const res = await GET(makeRequest({ url: 'http://localhost/api/admin/invoicing/preview', authHeader: 'Bearer t' }));
    expect(res.status).toBe(400);
  });

  it('404s for an unknown email', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    const { GET } = await import('../../src/app/api/admin/invoicing/preview/route.js');
    const res = await GET(makeRequest({ url: 'http://localhost/api/admin/invoicing/preview?email=nobody@nowhere.com', authHeader: 'Bearer t' }));
    expect(res.status).toBe(404);
  });

  it('returns a full preview + email for an admin requesting a real 5-property agent', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    seedPhilLikeAccount();

    const { GET } = await import('../../src/app/api/admin/invoicing/preview/route.js');
    const res = await GET(makeRequest({ url: 'http://localhost/api/admin/invoicing/preview?email=phil@propertyhubgc.com.au', authHeader: 'Bearer t' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.preview.propertyCount).toBe(5);
    expect(data.preview.totalInc).toBe(1000);
    expect(data.email.html).toMatch(/TEST ONLY/);

    // the whole point of this route: still nothing persisted
    expect(fakeDb._store.propertyCharges).toBeUndefined();
    expect(fakeDb._store.invoiceRuns).toBeUndefined();
  });

  it('400s for an admin requesting an agent with zero properties', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('users', 'empty1', { email: 'nobody@example.com', firstName: 'No', lastName: 'Body' });

    const { GET } = await import('../../src/app/api/admin/invoicing/preview/route.js');
    const res = await GET(makeRequest({ url: 'http://localhost/api/admin/invoicing/preview?email=nobody@example.com', authHeader: 'Bearer t' }));
    expect(res.status).toBe(400);
  });
});
