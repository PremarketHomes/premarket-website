import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP', delete: () => 'DELETE_SENTINEL' },
}));

// In-memory Firestore fake: doc get/create/set/update, chained where(==),
// collection get, orderBy().limit().get(), batch, and transactions with
// deferred writes (thrown away if the callback throws).
function makeFakeDb() {
  const store = {};
  const table = (n) => (store[n] = store[n] || {});
  const snap = (name, id) => {
    const data = table(name)[id];
    return {
      exists: !!data,
      id,
      data: () => data,
      ref: { _col: name, id },
    };
  };
  function docRef(name, id) {
    const docId = id || `auto-${Math.random().toString(36).slice(2)}`;
    return {
      _col: name,
      id: docId,
      async get() { return snap(name, docId); },
      async create(data) {
        if (table(name)[docId]) {
          const err = new Error('ALREADY_EXISTS: Document already exists');
          err.code = 6;
          throw err;
        }
        table(name)[docId] = { ...data };
      },
      async set(data) { table(name)[docId] = { ...data }; },
      async update(patch) { table(name)[docId] = { ...table(name)[docId], ...patch }; },
    };
  }
  function query(name, filters) {
    const run = () =>
      Object.keys(table(name))
        .map((id) => snap(name, id))
        .filter((d) => filters.every(([f, o, v]) => (o === '==' ? d.data()[f] === v : true)));
    return {
      where: (f, o, v) => query(name, [...filters, [f, o, v]]),
      orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [], empty: true }) }) }),
      async get() { const docs = run(); return { docs, empty: docs.length === 0, size: docs.length }; },
    };
  }
  const collection = (name) => ({ doc: (id) => docRef(name, id), ...query(name, []) });
  const batch = () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(() => { table(ref._col)[ref.id] = { ...data }; }),
      update: (ref, patch) => ops.push(() => { table(ref._col)[ref.id] = { ...table(ref._col)[ref.id], ...patch }; }),
      commit: async () => ops.forEach((op) => op()),
    };
  };
  async function runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async (ref) => snap(ref._col, ref.id),
      set: (ref, data) => writes.push(() => { table(ref._col)[ref.id] = { ...data }; }),
      update: (ref, patch) => writes.push(() => { table(ref._col)[ref.id] = { ...table(ref._col)[ref.id], ...patch }; }),
    };
    const result = await fn(tx);
    writes.forEach((w) => w());
    return result;
  }
  return {
    collection, batch, runTransaction, _store: store,
    seed: (n, id, data) => { table(n)[id] = data; },
  };
}

let db;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, p) => db[p] }),
}));

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: (...a) => mockVerifyIdToken(...a) }),
}));

const billing = await import('../../src/app/api/services/billingService');
const statusRoute = await import('../../src/app/api/agency/billing-contact-status/route.js');
const proposeRoute = await import('../../src/app/api/agency/propose-billing-contact/route.js');

const HPH = 'hphOffice1';
const VALID_ABN = '51824753556'; // ATO's published example ABN
const ADDRESS = { line1: '1 George St', suburb: 'Sydney', state: 'NSW', postcode: '2000' };

beforeEach(() => {
  db = makeFakeDb();
  db.seed('officeAdminInfo', HPH, { name: 'Harcourts Property Hub', status: 'active', officeAdminUids: ['hphAdmin'] });
  db.seed('users', 'hphAdmin', { firstName: 'Ada', lastName: 'Admin', officeId: HPH, isOfficeAdmin: true });
  db.seed('users', 'phil', { firstName: 'Phil', lastName: 'Agent', officeId: HPH });
  db.seed('users', 'solo', { firstName: 'Sol', lastName: 'Solo' });
});

const call = (uid, body) => {
  mockVerifyIdToken.mockResolvedValue({ uid, email: `${uid}@x.test` });
  return new Request('http://localhost/t', {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
};
const OFFICE_FORM = { billingName: 'Harcourts Property Hub Pty Ltd', contactName: 'HPH Accounts', contactEmail: 'accounts@hph.test', abn: '51 824 753 556', address: ADDRESS };

describe('ABN and address validation', () => {
  it('accepts a valid ABN (with or without spaces) and normalises its format', () => {
    expect(billing.isValidAbn(VALID_ABN)).toBe(true);
    expect(billing.normalizeBillingExtras({ abn: '51 824 753 556' }).abn).toBe('51 824 753 556');
    expect(billing.normalizeBillingExtras({ abn: VALID_ABN }).abn).toBe('51 824 753 556');
  });
  it('rejects an invalid ABN', () => {
    expect(() => billing.normalizeBillingExtras({ abn: '12345678901' })).toThrow(/ABN is not valid/);
    expect(() => billing.normalizeBillingExtras({ abn: '5182475355' })).toThrow(/ABN is not valid/);
  });
  it('treats blank ABN and address as "not provided"', () => {
    expect(billing.normalizeBillingExtras({ abn: '', address: { line1: '', suburb: '', state: '', postcode: '' } })).toEqual({ abn: '', address: null });
    expect(billing.normalizeBillingExtras({})).toEqual({ abn: '', address: null });
  });
  it('rejects a half-filled address, a bad state or a bad postcode', () => {
    expect(() => billing.normalizeBillingExtras({ address: { line1: '1 George St' } })).toThrow(/complete the billing address/);
    expect(() => billing.normalizeBillingExtras({ address: { ...ADDRESS, state: 'XX' } })).toThrow(/valid Australian state/);
    expect(() => billing.normalizeBillingExtras({ address: { ...ADDRESS, postcode: '20' } })).toThrow(/Postcode/);
  });
});

describe('office administrator submits billing details', () => {
  it('stores the proposal as PENDING with ABN and address — not approved, no invoice or charge created', async () => {
    db.seed('propertyCharges', 'c1', { status: 'pending', billingEntityKey: `office:${HPH}` });
    const before = JSON.stringify(db._store.propertyCharges);

    const res = await proposeRoute.POST(call('hphAdmin', OFFICE_FORM));
    expect(res.status).toBe(200);

    expect(db._store.billingContacts[`office:${HPH}`]).toMatchObject({
      status: 'pending',
      billingEntityType: 'office',
      proposedBillingName: 'Harcourts Property Hub Pty Ltd',
      proposedEmail: 'accounts@hph.test',
      proposedAbn: '51 824 753 556',
      proposedAddress: ADDRESS,
    });
    expect(await billing.resolveBillingContact(`office:${HPH}`)).toBeNull(); // not usable for invoicing
    expect(db._store.invoiceRuns).toBeUndefined();
    expect(db._store.invoiceRunItems).toBeUndefined();
    expect(JSON.stringify(db._store.propertyCharges)).toBe(before); // existing charges untouched
  });

  it('shows the pending status and the submitted details back to the administrator', async () => {
    await proposeRoute.POST(call('hphAdmin', OFFICE_FORM));
    const body = await (await statusRoute.GET(call('hphAdmin'))).json();
    expect(body).toMatchObject({
      applicable: true,
      billingEntityType: 'office',
      status: 'pending',
      proposedBillingName: 'Harcourts Property Hub Pty Ltd',
      proposedAbn: '51 824 753 556',
      proposedAddress: ADDRESS,
    });
  });

  it('requires the legal business name for an office, and rejects an invalid ABN or half-filled address (400)', async () => {
    expect((await proposeRoute.POST(call('hphAdmin', { ...OFFICE_FORM, billingName: '  ' }))).status).toBe(400);
    expect((await proposeRoute.POST(call('hphAdmin', { ...OFFICE_FORM, abn: '11111111111' }))).status).toBe(400);
    expect((await proposeRoute.POST(call('hphAdmin', { ...OFFICE_FORM, address: { line1: 'x' } }))).status).toBe(400);
    expect(db._store.billingContacts).toBeUndefined();
  });

  it('resubmitting while pending updates the same single record (no duplicate billing contact)', async () => {
    await proposeRoute.POST(call('hphAdmin', OFFICE_FORM));
    await proposeRoute.POST(call('hphAdmin', { ...OFFICE_FORM, contactEmail: 'ap@hph.test' }));
    expect(Object.keys(db._store.billingContacts)).toEqual([`office:${HPH}`]);
    expect(db._store.billingContacts[`office:${HPH}`]).toMatchObject({ proposedEmail: 'ap@hph.test', version: 2 });
  });

  it('after admin REJECTION the administrator sees Rejected with the reason and can resubmit', async () => {
    await proposeRoute.POST(call('hphAdmin', OFFICE_FORM));
    await billing.rejectBillingContact({ billingEntityKey: `office:${HPH}`, reason: 'ABN does not match', adminUid: 'luke' });
    const rejected = await (await statusRoute.GET(call('hphAdmin'))).json();
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'ABN does not match' });
    expect((await proposeRoute.POST(call('hphAdmin', { ...OFFICE_FORM, abn: '51824753556' }))).status).toBe(200);
    expect((await (await statusRoute.GET(call('hphAdmin'))).json()).status).toBe('pending');
  });
});

describe('approval carries the details to the approved contact', () => {
  it('approving without re-typing keeps the submitted ABN and address; resolveBillingContact exposes them for Xero', async () => {
    await proposeRoute.POST(call('hphAdmin', OFFICE_FORM));
    await billing.setBillingContact({ billingEntityKey: `office:${HPH}`, name: 'HPH Accounts', email: 'accounts@hph.test', adminUid: 'luke' });
    expect(await billing.resolveBillingContact(`office:${HPH}`)).toMatchObject({
      billingName: 'Harcourts Property Hub Pty Ltd', abn: '51 824 753 556', address: ADDRESS,
    });
    const status = await (await statusRoute.GET(call('hphAdmin'))).json();
    expect(status).toMatchObject({ status: 'confirmed', abn: '51 824 753 556', address: ADDRESS });
  });

  it('an amendment keeps the approved details active until approved, then replaces them', async () => {
    await proposeRoute.POST(call('hphAdmin', OFFICE_FORM));
    await billing.setBillingContact({ billingEntityKey: `office:${HPH}`, name: 'HPH', email: 'accounts@hph.test', adminUid: 'luke' });
    await proposeRoute.POST(call('hphAdmin', { ...OFFICE_FORM, contactEmail: 'new@hph.test', address: { ...ADDRESS, line1: '9 New St' } }));
    expect((await billing.resolveBillingContact(`office:${HPH}`)).address.line1).toBe('1 George St'); // still the old one
    await billing.setBillingContact({ billingEntityKey: `office:${HPH}`, name: 'HPH', email: 'new@hph.test', adminUid: 'luke' });
    expect((await billing.resolveBillingContact(`office:${HPH}`)).address.line1).toBe('9 New St');
  });

  it('an admin-supplied invalid ABN is refused at approval', async () => {
    await expect(billing.setBillingContact({ billingEntityKey: `office:${HPH}`, name: 'x', email: 'a@b.test', abn: '123', adminUid: 'luke' })).rejects.toThrow(/ABN/);
  });

  it('the admin review list shows the ABN and address for new proposals and change requests', async () => {
    await proposeRoute.POST(call('hphAdmin', OFFICE_FORM));
    expect((await billing.listPendingBillingContacts())[0]).toMatchObject({ proposedAbn: '51 824 753 556', proposedAddress: ADDRESS });
    await billing.setBillingContact({ billingEntityKey: `office:${HPH}`, name: 'x', email: 'a@b.test', adminUid: 'luke' });
    await proposeRoute.POST(call('hphAdmin', { ...OFFICE_FORM, abn: '' }));
    expect((await billing.listPendingBillingContacts())[0]).toMatchObject({ isChangeRequest: true, proposedAbn: null });
  });
});

describe('permissions', () => {
  it('an ordinary office agent cannot submit billing details for the office (403) and nothing is written', async () => {
    const res = await proposeRoute.POST(call('phil', OFFICE_FORM));
    expect(res.status).toBe(403);
    expect(db._store.billingContacts).toBeUndefined();
  });

  it('an ordinary office agent is told billing is managed by their office, not shown a form', async () => {
    expect(await (await statusRoute.GET(call('phil'))).json()).toEqual({ applicable: false, officeBilling: true, billingEntityName: 'Harcourts Property Hub' });
  });

  it('independent agents keep their individual flow: own agent:{uid} record, name optional, no ABN/address required', async () => {
    const res = await proposeRoute.POST(call('solo', { contactName: 'Sol', contactEmail: 'sol@solo.test' }));
    expect(res.status).toBe(200);
    expect(db._store.billingContacts['agent:solo']).toMatchObject({ status: 'pending', billingEntityType: 'independent', proposedAbn: '', proposedAddress: null });
    expect(await (await statusRoute.GET(call('solo'))).json()).toMatchObject({ applicable: true, billingEntityType: 'independent', status: 'pending' });
  });
});

describe('Xero contact creation uses the approved ABN and address', () => {
  beforeEach(() => {
    db.seed('settings', 'xeroTokens', { access_token: 't', tenant_id: 'ten', expires_at: Date.now() + 3600_000 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubXero = () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
      const isPost = (init?.method || 'GET') === 'POST';
      return new Response(JSON.stringify(isPost ? { Contacts: [{ ContactID: 'c1' }] } : { Contacts: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    return calls;
  };

  it('sends TaxNumber and a STREET address when approved details include them', async () => {
    const calls = stubXero();
    const { findOrCreateContact } = await import('../../src/app/api/services/xeroService.js');
    await findOrCreateContact({ name: 'HPH (abc)', email: 'a@hph.test', taxNumber: '51 824 753 556', address: ADDRESS });
    const created = calls.find((c) => c.method === 'POST').body.Contacts[0];
    expect(created).toMatchObject({
      Name: 'HPH (abc)', EmailAddress: 'a@hph.test', TaxNumber: '51 824 753 556',
      Addresses: [{ AddressType: 'STREET', AddressLine1: '1 George St', City: 'Sydney', Region: 'NSW', PostalCode: '2000', Country: 'Australia' }],
    });
  });

  it('creates contacts WITHOUT those fields exactly as before when none were provided (independent agents)', async () => {
    const calls = stubXero();
    const { findOrCreateContact } = await import('../../src/app/api/services/xeroService.js');
    await findOrCreateContact({ name: 'Sol Solo (x)', email: 's@solo.test', firstName: 'Sol', lastName: 'Solo' });
    const created = calls.find((c) => c.method === 'POST').body.Contacts[0];
    expect(created).toEqual({ Name: 'Sol Solo (x)', EmailAddress: 's@solo.test', FirstName: 'Sol', LastName: 'Solo' });
  });
});

describe('Settings UI wiring (source checks)', () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf-8');

  it('Settings renders the Billing Details section for office members too — the `!officeId` condition that hid it is gone', () => {
    const src = read('../../src/app/dashboard/settings/page.js');
    expect(src).toMatch(/\(userData\?\.isAgent \|\| userData\?\.agent\) && <BillingDetailsSection \/>/);
    expect(src).not.toMatch(/!officeId && <BillingDetailsSection/);
  });

  it('the section submits ABN and address for offices only, to the existing propose endpoint', () => {
    const src = read('../../src/app/dashboard/settings/BillingDetailsSection.js');
    expect(src).toContain("authFetch('/api/agency/propose-billing-contact'");
    expect(src).toContain('...(isOffice && { abn: formAbn.trim(), address: formAddress })');
    expect(src).toContain("isOffice ? 'Pending approval' : 'Pending review'");
    expect(src).toContain("isOffice ? 'Approved' : 'Verified'");
  });

  it('ordinary office agents get the explanatory message, not the form', () => {
    const src = read('../../src/app/dashboard/settings/BillingDetailsSection.js');
    expect(src).toContain('Your office');
    expect(src).toMatch(/if \(!loading && officeBillingName\)[\s\S]*Your office\s+administrator manages the billing details/);
  });

  it('the dashboard billing popup no longer appears for office accounts', () => {
    const src = read('../../src/app/dashboard/page.js');
    expect(src).toContain("setApplicable(!!data.applicable && data.billingEntityType !== 'office')");
  });
});
