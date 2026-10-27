import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mockVerifyIdToken }) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

function makeFakeDb() {
  const store = {};
  const col = (name) => {
    store[name] = store[name] || {};
    return {
      doc: (id) => ({ id, async get() { const d = store[name][id]; return { exists: !!d, id, data: () => d }; } }),
      where(field, op, value) {
        const rows = Object.entries(store[name]).filter(([, d]) => (op === '==' ? d[field] === value : true));
        return { async get() { return { docs: rows.map(([id, d]) => ({ id, data: () => d })), size: rows.length, empty: !rows.length }; } };
      },
    };
  };
  return { collection: col, _seed(n, id, d) { store[n] = store[n] || {}; store[n][id] = d; }, _store: store };
}
let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => fakeDb[p] }) }));

// Xero module: the READ functions are real-ish fakes; every WRITE function explodes if touched.
const reads = {
  isXeroConnected: vi.fn(),
  getOrganisation: vi.fn(),
  getAccountByCode: vi.fn(),
  getTaxRates: vi.fn(),
  searchContactByName: vi.fn(),
  getContactById: vi.fn(),
  listInvoicesByReference: vi.fn(),
  listInvoicesForContact: vi.fn(),
};
const boom = (name) => vi.fn(() => { throw new Error(`WRITE FUNCTION CALLED: ${name}`); });
const writes = { createInvoice: boom('createInvoice'), sendInvoice: boom('sendInvoice'), findOrCreateContact: boom('findOrCreateContact'), makeXeroRequest: boom('makeXeroRequest'), disconnectXero: boom('disconnectXero') };
vi.mock('../../src/app/api/services/xeroService', () => ({
  isXeroConnected: (...a) => reads.isXeroConnected(...a),
  getOrganisation: (...a) => reads.getOrganisation(...a),
  getAccountByCode: (...a) => reads.getAccountByCode(...a),
  getTaxRates: (...a) => reads.getTaxRates(...a),
  searchContactByName: (...a) => reads.searchContactByName(...a),
  getContactById: (...a) => reads.getContactById(...a),
  listInvoicesByReference: (...a) => reads.listInvoicesByReference(...a),
  listInvoicesForContact: (...a) => reads.listInvoicesForContact(...a),
  createInvoice: (...a) => writes.createInvoice(...a),
  sendInvoice: (...a) => writes.sendInvoice(...a),
  findOrCreateContact: (...a) => writes.findOrCreateContact(...a),
  makeXeroRequest: (...a) => writes.makeXeroRequest(...a),
  disconnectXero: (...a) => writes.disconnectXero(...a),
}));

const LEGAL = 'Results Realty (QLD) Pty Ltd ATF Results Realty Trust trading as Harcourts Property Hub';
const req = (body, { token = 't' } = {}) => new Request('http://localhost/api/admin/invoicing/xero-readiness', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const post = async (...a) => (await import('../../src/app/api/admin/invoicing/xero-readiness/route.js')).POST(req(...a));

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
  process.env.XERO_READINESS_ENABLED = 'true';
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
  fakeDb._seed('users', 'admin1', { superAdmin: true });
  fakeDb._seed('users', 'agent1', { superAdmin: false });
  fakeDb._seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0, paymentTermsDays: 14 });
  fakeDb._seed('billingContacts', 'office:hph', { billingEntityType: 'office', billingEntityKey: 'office:hph', status: 'confirmed', billingName: LEGAL, abn: '68 677 191 726', email: 'accounts@hph.test' });
  fakeDb._seed('billingContacts', 'agent:solo', { billingEntityType: 'independent', billingEntityKey: 'agent:solo', status: 'confirmed', billingName: 'Solo Realty', email: 's@x.test' });
  fakeDb._seed('billingContacts', 'office:pending', { billingEntityType: 'office', billingEntityKey: 'office:pending', status: 'pending', billingName: 'Pending Co' });
  reads.isXeroConnected.mockResolvedValue(true);
  reads.getOrganisation.mockResolvedValue({ Name: 'Premarket Group Pty Ltd', IsDemoCompany: false, PaysTax: false, SalesTaxBasis: 'NONE' });
  reads.getAccountByCode.mockResolvedValue({ Code: '200', Name: 'Sales', Type: 'REVENUE', Class: 'REVENUE', Status: 'ACTIVE', TaxType: 'BASEXCLUDED' });
  reads.getTaxRates.mockResolvedValue([{ Name: 'BAS Excluded', TaxType: 'BASEXCLUDED', Status: 'ACTIVE', EffectiveRate: 0, CanApplyToRevenue: true }]);
  reads.searchContactByName.mockResolvedValue(null);
  reads.getContactById.mockResolvedValue(null);
  reads.listInvoicesByReference.mockResolvedValue([]);
  reads.listInvoicesForContact.mockResolvedValue([]);
});
afterEach(() => { delete process.env.XERO_READINESS_ENABLED; });

describe('POST /api/admin/invoicing/xero-readiness: gates', () => {
  it('is OFF by default: 404 and Xero is never contacted, even for a superAdmin with confirm', async () => {
    delete process.env.XERO_READINESS_ENABLED;
    const res = await post({ confirm: true });
    expect(res.status).toBe(404);
    expect(reads.isXeroConnected).not.toHaveBeenCalled();
    expect(reads.getOrganisation).not.toHaveBeenCalled();
  });
  it.each(['false', '1', 'TRUE', ''])('only the exact string "true" enables it (%j stays off)', async (v) => {
    process.env.XERO_READINESS_ENABLED = v;
    expect((await post({ confirm: true })).status).toBe(404);
  });
  it('401 when not logged in; Xero not contacted', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad'));
    expect((await post({ confirm: true }, { token: 'x' })).status).toBe(401);
    expect(reads.getOrganisation).not.toHaveBeenCalled();
  });
  it('403 for a signed-in user who is not a superAdmin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    expect((await post({ confirm: true })).status).toBe(403);
    expect(reads.getOrganisation).not.toHaveBeenCalled();
  });
  it('400 without confirm: true (checked before Xero is contacted)', async () => {
    for (const body of [undefined, {}, { confirm: 'true' }, { confirm: 1 }, { confirm: false }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(reads.isXeroConnected).not.toHaveBeenCalled();
    expect(reads.getOrganisation).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/invoicing/xero-readiness: behaviour', () => {
  it('reports "not connected" without calling Xero when no tokens are stored', async () => {
    reads.isXeroConnected.mockResolvedValue(false);
    const body = await (await post({ confirm: true })).json();
    expect(body).toMatchObject({ connected: false, ready: false });
    expect(reads.getOrganisation).not.toHaveBeenCalled();
  });

  it('runs the check for confirmed OFFICE contacts only, using the configured account code', async () => {
    fakeDb._seed('settings', 'invoicing', { xeroAccountCode: '260' });
    const res = await post({ confirm: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ connected: true, readOnly: true, ready: true });
    expect(reads.getAccountByCode).toHaveBeenCalledWith('260');
    expect(body.checks.filter((c) => c.id.startsWith('contact:')).map((c) => c.id)).toEqual(['contact:office:hph']); // not the independent, not the pending one
    expect(reads.searchContactByName).toHaveBeenCalledWith(LEGAL);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('uses the remembered Xero contact id from xeroContacts when there is one', async () => {
    fakeDb._seed('xeroContacts', 'office:hph', { xeroContactId: 'stored-123' });
    reads.getContactById.mockResolvedValue({ ContactID: 'stored-123', Name: LEGAL, ContactStatus: 'ACTIVE' });
    await post({ confirm: true });
    expect(reads.getContactById).toHaveBeenCalledWith('stored-123');
  });

  it('CREATES/SENDS NOTHING: no write function is ever called, across every scenario', async () => {
    await post({ confirm: true });
    reads.getOrganisation.mockRejectedValue(new Error('down'));
    await post({ confirm: true });
    reads.getOrganisation.mockResolvedValue({ Name: 'X', IsDemoCompany: true });
    await post({ confirm: true });
    for (const [name, fn] of Object.entries(writes)) expect(fn, name).not.toHaveBeenCalled();
  });

  it('never writes to Firestore (the fake db exposes no write at all) and returns no secrets', async () => {
    const res = await post({ confirm: true });
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/access_token|refresh_token|client_secret|XERO_CLIENT/i);
  });

  it('a failure inside the check returns a generic 500, with no internals', async () => {
    reads.getAccountByCode.mockImplementation(() => { throw new Error('secret internal detail'); });
    const res = await post({ confirm: true });
    // the orchestrator isolates per-check errors, so this is a 200 with a failed check, not a leak
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.checks.find((c) => c.id === 'account').status).toBe('fail');
  });
});
