import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildInvoiceReference } from '../../src/app/api/services/xeroInvoiceIdentity';

// Invoice preview: the real Xero invoice for a run item, saved in Xero as a DRAFT and shown as
// Xero's own PDF. Send later approves that same draft. Nothing here may email anyone.

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mockVerifyIdToken }) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TIMESTAMP' } }));

function makeFakeDb() {
  const store = {};
  const docRef = (name, id) => ({
    id, _col: name,
    ref: { _col: name, id },
    async get() { const data = store[name]?.[id]; return { exists: !!data, id, data: () => data }; },
    async set(data, opts) { store[name] = store[name] || {}; store[name][id] = opts?.merge ? { ...(store[name][id] || {}), ...data } : { ...data }; },
    async update(patch) { store[name] = store[name] || {}; store[name][id] = { ...(store[name][id] || {}), ...patch }; },
    async delete() { delete store[name][id]; },
  });
  const col = (name) => {
    store[name] = store[name] || {};
    return {
      doc: (id) => docRef(name, id || `auto-${Math.random().toString(36).slice(2)}`),
      where(field, op, value) {
        const docs = Object.entries(store[name]).filter(([, d]) => d[field] === value).map(([id, data]) => ({
          id, data: () => data, ref: { _col: name, id, update: async (p) => { store[name][id] = { ...store[name][id], ...p }; } },
        }));
        return { get: async () => ({ docs, empty: docs.length === 0, size: docs.length }) };
      },
    };
  };
  async function runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async (ref) => { const data = store[ref._col]?.[ref.id]; return { exists: !!data, id: ref.id, data: () => data }; },
      update: (ref, patch) => writes.push(() => { store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch }; }),
      set: (ref, data) => writes.push(() => { store[ref._col][ref.id] = { ...data }; }),
    };
    const result = await fn(tx);
    writes.forEach((w) => w());
    return result;
  }
  const batch = () => {
    const ops = [];
    return {
      delete: (ref) => ops.push(() => { delete store[ref._col][ref.id]; }),
      update: (ref, patch) => ops.push(() => { store[ref._col][ref.id] = { ...store[ref._col][ref.id], ...patch }; }),
      set: (ref, data) => ops.push(() => { store[ref._col][ref.id] = { ...data }; }),
      commit: async () => ops.forEach((o) => o()),
    };
  };
  return { collection: col, runTransaction, batch, _store: store, _seed: (n, id, d) => { store[n] = store[n] || {}; store[n][id] = d; } };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => fakeDb[p] }) }));

// In-memory Xero that behaves like Xero for what matters here: numbers are assigned on
// creation (drafts included); a draft's lines can be rewritten and it can be approved; an
// approved invoice can be neither rewritten nor deleted; a list-by-reference returns no lines.
let xero;
function makeFakeXero() {
  const contacts = new Map();
  const invoices = [];
  let cSeq = 0;
  let iSeq = 0;
  const totals = (lineItems) => {
    const sub = lineItems.reduce((s, l) => s + l.unitAmount * l.quantity, 0);
    const tax = lineItems.reduce((s, l) => s + (l.taxType === 'OUTPUT' ? l.unitAmount * l.quantity * 0.1 : 0), 0);
    return { SubTotal: Math.round(sub * 100) / 100, TotalTax: Math.round(tax * 100) / 100, Total: Math.round((sub + tax) * 100) / 100 };
  };
  const view = (inv) => ({ ...inv, LineItems: inv.LineItems.map((l) => ({ ...l })) });
  return {
    contacts, invoices,
    searchContactByName: async (name) => contacts.get(name) || null,
    getContactById: async (id) => [...contacts.values()].find((c) => c.ContactID === id) || null,
    findOrCreateContact: async ({ name, email }) => {
      if (contacts.has(name)) return contacts.get(name);
      cSeq += 1;
      const c = { ContactID: `contact${cSeq}`, Name: name, EmailAddress: email };
      contacts.set(name, c);
      return c;
    },
    createInvoice: async ({ contactId, lineItems, reference, date, dueDate, status }) => {
      iSeq += 1;
      const inv = { InvoiceID: `inv${iSeq}`, InvoiceNumber: `INV-${String(iSeq).padStart(4, '0')}`, Status: status || 'AUTHORISED', Reference: reference, Contact: { ContactID: contactId }, Date: date, DueDate: dueDate, LineItems: lineItems.map((l) => ({ ...l })), ...totals(lineItems) };
      invoices.push(inv);
      return view(inv);
    },
    updateDraftInvoice: async ({ invoiceId, contactId, lineItems, reference, date, dueDate, status }) => {
      const inv = invoices.find((i) => i.InvoiceID === invoiceId);
      if (!inv) throw new Error('Xero API POST /Invoices failed (404)');
      if (inv.Status !== 'DRAFT') throw new Error(`Xero API POST /Invoices failed (400): invoice is ${inv.Status}`);
      Object.assign(inv, { Contact: { ContactID: contactId }, LineItems: lineItems.map((l) => ({ ...l })), Reference: reference, Date: date, DueDate: dueDate, Status: status, ...totals(lineItems) });
      return view(inv);
    },
    deleteDraftInvoice: async (invoiceId) => {
      const inv = invoices.find((i) => i.InvoiceID === invoiceId);
      if (inv.Status !== 'DRAFT') throw new Error('Xero API POST /Invoices failed (400): only a draft can be deleted');
      inv.Status = 'DELETED';
      return view(inv);
    },
    getInvoiceById: async (id) => { const inv = invoices.find((i) => i.InvoiceID === id); return inv ? view(inv) : null; },
    findInvoiceByReference: async (reference) => {
      const inv = invoices.find((i) => i.Reference === reference && i.Status !== 'DELETED');
      return inv ? { ...inv, LineItems: undefined } : null;
    },
    getInvoicePdf: async (id) => Buffer.from(`%PDF-1.4 ${id}`),
    getOrganisation: async () => ({ Name: 'Premarket Group Pty Ltd', ShortCode: '!pm123' }),
  };
}

const m = {
  createInvoice: vi.fn(), updateDraftInvoice: vi.fn(), deleteDraftInvoice: vi.fn(), getInvoiceById: vi.fn(),
  findInvoiceByReference: vi.fn(), getInvoicePdf: vi.fn(), getOrganisation: vi.fn(), sendInvoice: vi.fn(),
  isXeroConnected: vi.fn(), findOrCreateContact: vi.fn(), searchContactByName: vi.fn(), getContactById: vi.fn(),
};
vi.mock('../../src/app/api/services/xeroService', () => Object.fromEntries(
  ['createInvoice', 'updateDraftInvoice', 'deleteDraftInvoice', 'getInvoiceById', 'findInvoiceByReference', 'getInvoicePdf',
    'getOrganisation', 'sendInvoice', 'isXeroConnected', 'findOrCreateContact', 'searchContactByName', 'getContactById']
    .map((k) => [k, (...a) => m[k](...a)]),
));

const b = { markChargesInvoiced: vi.fn(), markChargesFailed: vi.fn(), resolveBillingContact: vi.fn(), releaseCharges: vi.fn() };
vi.mock('../../src/app/api/services/billingService', () => ({
  markChargesInvoiced: (...a) => b.markChargesInvoiced(...a),
  markChargesFailed: (...a) => b.markChargesFailed(...a),
  resolveBillingContact: (...a) => b.resolveBillingContact(...a),
  releaseCharges: (...a) => b.releaseCharges(...a),
}));

const HPH = 'office:ioxigzf4hcRtowqL4C94';
const LEGAL = 'Results Realty (QLD) Pty Ltd ATF Results Realty Trust trading as Harcourts Property Hub';
const PERIOD_START = new Date('2026-10-24T05:00:14Z');
const ref = (itemId = 'item1') => buildInvoiceReference({ prefix: 'PM-', periodStart: PERIOD_START, itemId });

// The live HPH run's shape: one office item, three $200 campaigns, no GST.
const PROPS = [
  { propertyId: 'pGreenwich', address: '1 Greenwich Avenue, Pimpama QLD, Australia, 4209', agentName: 'Phil Chillemi', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
  { propertyId: 'pRiverwalk', address: '73 Riverwalk Ave, Robina QLD 4226, Australia', agentName: 'Peta Harris', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
  { propertyId: 'pBella', address: '194/2 Bella Ave, Robina QLD 4226, Australia', agentName: 'Rob Ross', subtotalEx: 200, gstAmount: 0, totalInc: 200 },
];
const LINES = [
  '1 Greenwich Avenue, Pimpama QLD, Australia, 4209 — Phil Chillemi — 24 Oct 2026',
  '73 Riverwalk Ave, Robina QLD 4226, Australia — Chantal Damiani — 5 Nov 2026',
  '194/2 Bella Ave, Robina QLD 4226, Australia — Rob Ross — 17 Nov 2026',
];

function seedHph({ runStatus = 'draft', item = {} } = {}) {
  fakeDb._seed('users', 'admin1', { superAdmin: true });
  fakeDb._seed('users', 'phil', { firstName: 'Phil', lastName: 'Chillemi' });
  fakeDb._seed('users', 'peta', { firstName: 'Peta', lastName: 'Harris' });
  fakeDb._seed('users', 'rob', { firstName: 'Rob', lastName: 'Ross' });
  fakeDb._seed('properties', 'pGreenwich', { userId: 'phil', formattedAddress: '1 Greenwich Avenue, Pimpama QLD, Australia, 4209', createdAt: new Date('2026-10-24T04:18:20Z') });
  fakeDb._seed('properties', 'pRiverwalk', { userId: 'peta', agentId: 'roster1', agentName: 'Chantal Damiani', address: 'Robina QLD Australia', formattedAddress: '73 Riverwalk Ave, Robina QLD 4226, Australia', createdAt: new Date('2026-11-05T07:01:14Z') });
  fakeDb._seed('properties', 'pBella', { userId: 'rob', address: 'Robina QLD Australia', formattedAddress: '194/2 Bella Ave, Robina QLD 4226, Australia', createdAt: new Date('2026-11-17T01:47:02Z') });
  fakeDb._seed('billingContacts', HPH, {
    status: 'confirmed', billingName: LEGAL, name: 'Chris Manby', email: 'accounts@hph.test', abn: '68 677 191 726',
    address: { line1: '102-104/6 Waterfront Place', suburb: 'Robina', state: 'QLD', postcode: '4226' },
  });
  fakeDb._seed('settings', 'invoicing', { xeroAccountCode: '200', invoicePrefix: 'PM-', paymentTermsDays: 14, cronEnabled: false });
  fakeDb._seed('invoiceRuns', 'run1', { status: runStatus, periodStart: PERIOD_START, totalAmountInc: 600 });
  fakeDb._seed('invoiceRunItems', 'item1', {
    runId: 'run1', agencyName: 'Harcourts Property Hub', agentName: 'Chris Manby', agentEmail: 'accounts@hph.test',
    billingEntityType: 'office', billingEntityKey: HPH, officeId: 'ioxigzf4hcRtowqL4C94',
    properties: PROPS.map((p) => ({ ...p })), propertyCount: 3, subtotalEx: 600, gstAmount: 0, totalInc: 600, status: 'pending', ...item,
  });
  for (const p of PROPS) fakeDb._seed('propertyCharges', p.propertyId, { status: 'queued', runId: 'run1', totalInc: 200 });
}

const req = (method, body, url = 'http://localhost/api/admin/invoicing/runs/run1/preview') => new Request(url, {
  method, headers: new Headers({ authorization: 'Bearer t', 'Content-Type': 'application/json' }), ...(body ? { body: JSON.stringify(body) } : {}),
});
const ctx = { params: Promise.resolve({ runId: 'run1' }) };
const preview = async (body = { itemId: 'item1', confirm: true }) => {
  const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/preview/route.js');
  const res = await POST(req('POST', body), ctx);
  return { res, body: await res.json() };
};
const getPdf = async (itemId = 'item1') => {
  const { GET } = await import('../../src/app/api/admin/invoicing/runs/[runId]/preview/route.js');
  return GET(req('GET', null, `http://localhost/api/admin/invoicing/runs/run1/preview?itemId=${itemId}`), ctx);
};
const patch = async (body) => {
  const { PATCH } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
  const res = await PATCH(req('PATCH', body, 'http://localhost/api/admin/invoicing/runs/run1'), ctx);
  return { res, body: await res.json() };
};
const send = async () => {
  const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
  return (await POST(req('POST', {}, 'http://localhost/api/admin/invoicing/runs/run1/send'), ctx)).json();
};
const item = () => fakeDb._store.invoiceRunItems.item1;
const now = (iso) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  now('2026-11-23T22:30:00Z'); // Tue 24 Nov 2026, 08:30 in Brisbane
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
  xero = makeFakeXero();
  for (const k of Object.keys(m)) if (xero[k]) m[k].mockImplementation(xero[k]);
  m.isXeroConnected.mockResolvedValue(true);
  m.sendInvoice.mockResolvedValue({});
  b.markChargesInvoiced.mockResolvedValue({ changed: [], skipped: [] });
  b.markChargesFailed.mockResolvedValue({ changed: [], skipped: [] });
  b.releaseCharges.mockResolvedValue({ released: 0 });
  b.resolveBillingContact.mockImplementation(async (key) => {
    const d = fakeDb._store.billingContacts?.[key];
    if (!d || d.status !== 'confirmed' || !d.email) return null;
    return { name: d.name, email: d.email, billingName: d.billingName, ...(d.abn ? { abn: d.abn } : {}), ...(d.address ? { address: d.address } : {}) };
  });
});
afterEach(() => vi.useRealTimers());

describe('POST .../preview — the real invoice, saved in Xero as a DRAFT', () => {
  it('creates ONE draft for HPH: legal name, three $200 lines (address — assigned agent — date), no GST, $600, Brisbane date + 14 days', async () => {
    seedHph();
    const { res, body } = await preview();
    expect(res.status).toBe(200);
    expect(xero.invoices).toHaveLength(1);
    const inv = xero.invoices[0];
    expect(inv.Status).toBe('DRAFT');
    expect(inv.Reference).toBe(ref());
    expect(inv.Date).toBe('2026-11-24');
    expect(inv.DueDate).toBe('2026-12-08');
    expect(inv.LineItems.map((l) => [l.description, l.unitAmount, l.taxType])).toEqual(LINES.map((d) => [d, 200, 'BASEXCLUDED']));
    expect(inv).toMatchObject({ SubTotal: 600, TotalTax: 0, Total: 600 });
    expect(xero.contacts.get(LEGAL)).toMatchObject({ EmailAddress: 'accounts@hph.test' });
    expect(m.createInvoice.mock.calls[0][0]).toMatchObject({ status: 'DRAFT', accountCode: '200' });
    expect(body).toMatchObject({
      success: true, created: true, invoiceNumber: 'INV-0001', status: 'DRAFT', contactName: LEGAL,
      date: '2026-11-24', dueDate: '2026-12-08', paymentTermsDays: 14, subTotal: 600, totalTax: 0, total: 600,
    });
    expect(body.lines.map((l) => l.description)).toEqual(LINES);
    expect(body.xeroUrl).toBe(`https://go.xero.com/organisationlogin/default.aspx?shortcode=!pm123&redirecturl=/AccountsReceivable/Edit.aspx?InvoiceID=${inv.InvoiceID}`);
  });

  it('emails nobody, approves nothing, and leaves the run, its charges and its status exactly as they were', async () => {
    seedHph();
    const runBefore = { ...fakeDb._store.invoiceRuns.run1 };
    const chargesBefore = JSON.stringify(fakeDb._store.propertyCharges);
    await preview();
    expect(m.sendInvoice).not.toHaveBeenCalled();
    expect(b.markChargesInvoiced).not.toHaveBeenCalled();
    expect(b.markChargesFailed).not.toHaveBeenCalled();
    expect(xero.invoices.every((i) => i.Status === 'DRAFT')).toBe(true);
    expect(fakeDb._store.invoiceRuns.run1).toEqual(runBefore);
    expect(JSON.stringify(fakeDb._store.propertyCharges)).toBe(chargesBefore);
    expect(item()).toMatchObject({ status: 'pending', previewXeroInvoiceId: 'inv1', previewXeroInvoiceNumber: 'INV-0001', previewTotal: 600, previewLineCount: 3, previewDate: '2026-11-24', previewDueDate: '2026-12-08', previewInProgressAt: null });
    expect(item().xeroInvoiceId).toBeUndefined(); // never treated as the real, sent invoice
    expect(fakeDb._store.settings.invoicing.cronEnabled).toBe(false);
  });

  it('a second preview refreshes the SAME draft (same number) from the run as it now stands', async () => {
    seedHph();
    await preview();
    await patch({ action: 'removeProperties', itemId: 'item1', propertyIds: ['pGreenwich'] });
    const { body } = await preview();
    expect(xero.invoices).toHaveLength(1);
    expect(body).toMatchObject({ created: false, invoiceNumber: 'INV-0001', total: 400 });
    expect(xero.invoices[0].LineItems).toHaveLength(2);
    expect(xero.invoices[0].Status).toBe('DRAFT');
  });

  it('if the preview draft was deleted in Xero, a new draft is made (the deleted one is ignored)', async () => {
    seedHph();
    await preview();
    xero.invoices[0].Status = 'DELETED';
    const { body } = await preview();
    expect(body).toMatchObject({ created: true, invoiceNumber: 'INV-0002' });
  });

  it('never touches a real invoice that already carries this item\'s reference', async () => {
    seedHph();
    xero.invoices.push({ InvoiceID: 'real', InvoiceNumber: 'INV-0100', Status: 'AUTHORISED', Reference: ref(), Contact: { ContactID: 'x' }, LineItems: [], Total: 600 });
    const { res, body } = await preview();
    expect(res.status).toBe(409);
    expect(body.error).toMatch(/INV-0100 \(AUTHORISED\).*Nothing was changed/);
    expect(m.createInvoice).not.toHaveBeenCalled();
    expect(m.updateDraftInvoice).not.toHaveBeenCalled();
    expect(item().previewInProgressAt).toBeNull();
  });

  it('refuses without confirm: true, for a non-admin, for a sent run, for an item already invoiced, without a confirmed contact, or when Xero is not connected', async () => {
    seedHph();
    expect((await preview({ itemId: 'item1' })).res.status).toBe(400);
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'someone' });
    expect((await preview()).res.status).toBe(403);
    fakeDb._store.invoiceRuns.run1.status = 'sent';
    expect((await preview()).res.status).toBe(400);
    fakeDb._store.invoiceRuns.run1.status = 'approved';
    fakeDb._store.invoiceRunItems.item1.xeroInvoiceId = 'inv-real';
    expect((await preview()).res.status).toBe(400);
    delete fakeDb._store.invoiceRunItems.item1.xeroInvoiceId;
    fakeDb._store.billingContacts[HPH].status = 'pending';
    expect((await preview()).body.error).toMatch(/Billing details required/);
    fakeDb._store.billingContacts[HPH].status = 'confirmed';
    m.isXeroConnected.mockResolvedValueOnce(false);
    expect((await preview()).body.error).toMatch(/not connected/);
    expect(m.createInvoice).not.toHaveBeenCalled();
    expect(xero.contacts.size).toBe(0);
  });

  it('an approved run can still be previewed', async () => {
    seedHph({ runStatus: 'approved' });
    expect((await preview()).res.status).toBe(200);
  });

  it('a preview already in progress blocks a second one (no duplicate drafts from a double-click)', async () => {
    seedHph({ item: { previewInProgressAt: new Date('2026-11-23T22:29:30Z') } });
    const { res } = await preview();
    expect(res.status).toBe(409);
    expect(m.createInvoice).not.toHaveBeenCalled();
  });

  it('a Xero failure is reported and the in-progress marker is cleared', async () => {
    seedHph();
    m.createInvoice.mockRejectedValueOnce(new Error('Xero API POST /Invoices failed (500): boom'));
    const { res, body } = await preview();
    expect(res.status).toBe(500);
    expect(body.error).toMatch(/boom/);
    expect(item().previewInProgressAt).toBeNull();
  });
});

describe('GET .../preview — the PDF exactly as Xero renders it', () => {
  it('returns Xero\'s PDF for the preview draft, inline, never cached', async () => {
    seedHph();
    await preview();
    const res = await getPdf();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="Premarket-invoice-INV-0001-preview.pdf"');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-1.4 inv1');
    expect(m.getInvoicePdf).toHaveBeenCalledWith('inv1');
  });

  it('404 before any preview exists; superAdmin only', async () => {
    seedHph();
    expect((await getPdf()).status).toBe(404);
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'someone' });
    expect((await getPdf()).status).toBe(403);
  });
});

describe('Send after a preview — the previewed draft is approved; no second invoice', () => {
  it('approves the SAME draft (same number), dated the send day and due 14 days later, marks the charges invoiced and emails it once', async () => {
    seedHph();
    await preview();
    fakeDb._store.invoiceRuns.run1.status = 'approved';
    now('2026-11-26T03:00:00Z'); // sent two days later
    const result = await send();
    expect(result.status).toBe('sent');
    expect(xero.invoices).toHaveLength(1);
    expect(m.createInvoice).toHaveBeenCalledTimes(1); // only the preview's draft create
    expect(xero.invoices[0]).toMatchObject({ InvoiceNumber: 'INV-0001', Status: 'AUTHORISED', Date: '2026-11-26', DueDate: '2026-12-10', Total: 600 });
    expect(m.updateDraftInvoice.mock.calls.at(-1)[0]).toMatchObject({ invoiceId: 'inv1', status: 'AUTHORISED' });
    expect(b.markChargesInvoiced).toHaveBeenCalledWith(['pGreenwich', 'pRiverwalk', 'pBella'], { runId: 'run1' });
    expect(m.sendInvoice).toHaveBeenCalledTimes(1);
    expect(m.sendInvoice).toHaveBeenCalledWith('inv1');
    expect(item()).toMatchObject({ xeroInvoiceId: 'inv1', xeroInvoiceNumber: 'INV-0001', status: 'sent' });
  });

  it('if the run changed after the preview, Send rewrites the draft from the run as it is before approving it', async () => {
    seedHph();
    await preview();
    await patch({ action: 'removeProperties', itemId: 'item1', propertyIds: ['pBella'] });
    fakeDb._store.invoiceRuns.run1.status = 'approved';
    expect((await send()).status).toBe('sent');
    expect(xero.invoices).toHaveLength(1);
    expect(xero.invoices[0]).toMatchObject({ Status: 'AUTHORISED', Total: 400 });
    expect(xero.invoices[0].LineItems.map((l) => l.description)).toEqual(LINES.slice(0, 2));
  });

  it('if Xero does not approve the draft, nothing is marked invoiced or emailed and the charges are released for retry', async () => {
    seedHph();
    await preview();
    fakeDb._store.invoiceRuns.run1.status = 'approved';
    m.updateDraftInvoice.mockImplementationOnce(async () => ({ ...xero.invoices[0], Status: 'DRAFT' }));
    const result = await send();
    expect(result.status).toBe('failed');
    expect(m.sendInvoice).not.toHaveBeenCalled();
    expect(b.markChargesInvoiced).not.toHaveBeenCalled();
    expect(b.markChargesFailed).toHaveBeenCalledWith(['pGreenwich', 'pRiverwalk', 'pBella'], { runId: 'run1' });
  });

  it('a preview draft deleted in Xero is ignored: Send creates the invoice as normal', async () => {
    seedHph();
    await preview();
    xero.invoices[0].Status = 'DELETED';
    fakeDb._store.invoiceRuns.run1.status = 'approved';
    expect((await send()).status).toBe('sent');
    expect(xero.invoices.map((i) => i.Status)).toEqual(['DELETED', 'AUTHORISED']);
    expect(m.sendInvoice).toHaveBeenCalledWith('inv2');
  });

  it('without a preview, Send is unchanged apart from the explicit Brisbane invoice date', async () => {
    seedHph({ runStatus: 'approved' });
    expect((await send()).status).toBe('sent');
    expect(m.updateDraftInvoice).not.toHaveBeenCalled();
    expect(m.getInvoiceById).not.toHaveBeenCalled();
    expect(m.createInvoice.mock.calls[0][0]).toMatchObject({ date: '2026-11-24', dueDate: '2026-12-08', reference: ref() });
    expect(m.createInvoice.mock.calls[0][0].status).toBeUndefined(); // AUTHORISED by default, as before
  });
});

describe('Cancelling, deleting or removing deletes the preview draft in Xero', () => {
  it('cancel: charges released, preview draft deleted', async () => {
    seedHph();
    await preview();
    const { body } = await patch({ action: 'cancel' });
    expect(body).toEqual({ success: true, status: 'cancelled' });
    expect(xero.invoices[0].Status).toBe('DELETED');
    expect(b.releaseCharges).toHaveBeenCalledWith(['pGreenwich', 'pRiverwalk', 'pBella']);
  });

  it('cancel still succeeds when Xero cannot be reached, and names the draft to delete by hand', async () => {
    seedHph();
    await preview();
    m.getInvoiceById.mockRejectedValueOnce(new Error('Xero API GET failed (503)'));
    const { body } = await patch({ action: 'cancel' });
    expect(body.status).toBe('cancelled');
    expect(body.warnings[0]).toMatch(/draft invoice INV-0001 for Harcourts Property Hub could not be deleted in Xero.*Delete it in Xero/);
    expect(fakeDb._store.invoiceRuns.run1.status).toBe('cancelled');
  });

  it('removing the agency from the run deletes its preview draft', async () => {
    seedHph();
    await preview();
    await patch({ action: 'removeItems', itemIds: ['item1'] });
    expect(xero.invoices[0].Status).toBe('DELETED');
    expect(fakeDb._store.invoiceRunItems.item1).toBeUndefined();
  });

  it('deleting the draft run deletes its preview draft', async () => {
    seedHph();
    await preview();
    const { DELETE } = await import('../../src/app/api/admin/invoicing/runs/[runId]/route.js');
    const res = await DELETE(req('DELETE', null, 'http://localhost/api/admin/invoicing/runs/run1'), ctx);
    expect((await res.json()).success).toBe(true);
    expect(xero.invoices[0].Status).toBe('DELETED');
  });

  it('a run without a preview makes no Xero call when cancelled', async () => {
    seedHph();
    await patch({ action: 'cancel' });
    expect(m.getInvoiceById).not.toHaveBeenCalled();
    expect(m.deleteDraftInvoice).not.toHaveBeenCalled();
  });
});

describe('wiring', () => {
  const src = (p) => readFileSync(new URL(`../../src/app/${p}`, import.meta.url), 'utf8');
  it('the preview route cannot email: it does not import sendInvoice, and only ever asks Xero for DRAFT', () => {
    const s = src('api/admin/invoicing/runs/[runId]/preview/route.js');
    const imports = s.match(/import\s*\{[^}]*\}\s*from '..\/..\/..\/..\/..\/services\/xeroService'/)[0];
    expect(imports).not.toMatch(/sendInvoice/);
    expect(s).not.toMatch(/sendInvoice\(/);
    expect(s).toMatch(/status: 'DRAFT'/);
    expect(s).not.toMatch(/'AUTHORISED'/);
  });
  it('Send and Preview build the invoice with the same function', () => {
    expect(src('api/admin/invoicing/runs/[runId]/send/route.js')).toMatch(/buildRunItemInvoice\(/);
    expect(src('api/admin/invoicing/runs/[runId]/preview/route.js')).toMatch(/buildRunItemInvoice\(/);
  });
  it('the draft run page shows the preview panel', () => {
    expect(src('dashboard/admin/invoicing/components/InvoiceRunDetail.js')).toMatch(/<InvoicePreviewPanel/);
    expect(src('dashboard/admin/invoicing/components/InvoicePreviewPanel.js')).toMatch(/Preview invoice/);
  });
});
