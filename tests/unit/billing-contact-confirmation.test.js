import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

// Xero itself is mocked at module scope, same convention as every
// other test file here — only send/route.js's own describe block
// below actually exercises these; every other describe block in this
// file never reaches xeroService at all.
const mockFindOrCreateContact = vi.fn();
const mockCreateInvoice = vi.fn();
const mockSendInvoice = vi.fn();
const mockIsXeroConnected = vi.fn();
const mockFindInvoiceByReference = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  findOrCreateContact: (...args) => mockFindOrCreateContact(...args),
  createInvoice: (...args) => mockCreateInvoice(...args),
  sendInvoice: (...args) => mockSendInvoice(...args),
  isXeroConnected: (...args) => mockIsXeroConnected(...args),
  findInvoiceByReference: (...args) => mockFindInvoiceByReference(...args),
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
          _col: name,
          async get() {
            const data = store[name][docId];
            return { exists: !!data, id: docId, data: () => data };
          },
          async set(data, opts) {
            store[name][docId] = opts?.merge ? { ...(store[name][docId] || {}), ...data } : { ...data };
          },
          async update(patch) {
            if (!store[name][docId]) {
              const err = new Error('NOT_FOUND');
              err.code = 5;
              throw err;
            }
            store[name][docId] = { ...store[name][docId], ...patch };
          },
        };
      },
      where(field, op, value) {
        function matches(raw, f, o, v) {
          if (o === '==') return raw[f] === v;
          return true;
        }
        function makeQuery(docs) {
          return {
            where: (f2, o2, v2) => makeQuery(docs.filter((d) => matches(d._raw, f2, o2, v2))),
            get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
          };
        }
        const all = Object.entries(store[name]).map(([docId, data]) => ({
          id: docId,
          data: () => data,
          _raw: data,
          ref: { _col: name, id: docId, async update(patch) { store[name][docId] = { ...(store[name][docId] || {}), ...patch }; } },
        }));
        return makeQuery(all.filter((d) => matches(d._raw, field, op, value)));
      },
    };
  }

  function batch() {
    const ops = [];
    return {
      set: (ref, data) => ops.push(() => { store[ref._col] = store[ref._col] || {}; store[ref._col][ref.id] = { ...data }; }),
      update: (ref, patch) => ops.push(() => { store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch }; }),
      delete: (ref) => ops.push(() => { delete store[ref._col][ref.id]; }),
      commit: async () => { ops.forEach((op) => op()); },
    };
  }

  async function runTransaction(updateFn) {
    const pendingWrites = [];
    const tx = {
      get: async (ref) => {
        const data = store[ref._col]?.[ref.id];
        return { exists: !!data, id: ref.id, data: () => data };
      },
      set: (ref, data) => pendingWrites.push(() => {
        store[ref._col] = store[ref._col] || {};
        store[ref._col][ref.id] = { ...data };
      }),
      update: (ref, patch) => pendingWrites.push(() => {
        store[ref._col][ref.id] = { ...(store[ref._col][ref.id] || {}), ...patch };
      }),
    };
    const result = await updateFn(tx);
    pendingWrites.forEach((write) => write());
    return result;
  }

  return {
    collection: col,
    batch,
    runTransaction,
    _store: store,
    _seed: (name, id, data) => { store[name] = store[name] || {}; store[name][id] = data; },
  };
}

let fakeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: new Proxy({}, { get: (_, prop) => fakeDb[prop] }),
}));

function makeRequest(body, authHeader) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method: 'POST', headers, body: JSON.stringify(body || {}) });
}

function makeGetRequest(authHeader) {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/test', { method: 'GET', headers });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  vi.clearAllMocks();
});

// ─── billingService-level: resolveBillingEntityForAgent ───

describe('resolveBillingEntityForAgent — ONE AGENT = ONE BILLING ACCOUNT', () => {
  it('always resolves to the agent\'s own UID, even for a verified brand creator', async () => {
    fakeDb._seed('users', 'agent1', { companyName: 'Acme Realty', firstName: 'Jo', lastName: 'Bloggs', agencyBrandId: 'brand-acme' });
    fakeDb._seed('agencyBrands', 'brand-acme', { name: 'Acme Realty', createdBy: 'agent1' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const entity = await resolveBillingEntityForAgent('agent1');
    expect(entity.billingEntityType).toBe('independent');
    expect(entity.billingEntityKey).toBe('agent:agent1');
  });

  it('resolves an agent with no companyName to the same independent shape, keyed by their own uid', async () => {
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Solo' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const entity = await resolveBillingEntityForAgent('agent1');
    expect(entity.billingEntityType).toBe('independent');
    expect(entity.billingEntityKey).toBe('agent:agent1');
  });

  it('two agents who are both VERIFIED members of the same real brand still resolve to DIFFERENT keys — branding never influences billing identity', async () => {
    fakeDb._seed('agencyBrands', 'brand-hph', { name: 'Harcourts Property Hub', createdBy: 'agentA' });
    fakeDb._seed('users', 'agentA', { companyName: 'Harcourts Property Hub', agencyBrandId: 'brand-hph' });
    fakeDb._seed('users', 'agentB', { companyName: 'Harcourts Property Hub', agencyBrandId: 'brand-hph' });
    fakeDb._seed('agencyMemberships', 'agentB', { uid: 'agentB', agencyBrandId: 'brand-hph', status: 'verified' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const a = await resolveBillingEntityForAgent('agentA');
    const b = await resolveBillingEntityForAgent('agentB');
    expect(a.billingEntityKey).not.toBe(b.billingEntityKey);
    expect(a.billingEntityKey).toBe('agent:agentA');
    expect(b.billingEntityKey).toBe('agent:agentB');
  });

  it('SECURITY: two agents merely sharing the same companyName never resolve to the same key', async () => {
    fakeDb._seed('users', 'agentA', { companyName: 'Harcourts Property Hub' });
    fakeDb._seed('users', 'agentB', { companyName: '  harcourts property hub  ' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const a = await resolveBillingEntityForAgent('agentA');
    const b = await resolveBillingEntityForAgent('agentB');
    expect(a.billingEntityKey).not.toBe(b.billingEntityKey);
  });
});

// ─── billingService-level: propose / approve / reject lifecycle ───

describe('proposeBillingContact / setBillingContact / rejectBillingContact lifecycle', () => {
  it('a fresh proposal is NOT usable for invoicing yet', async () => {
    const { proposeBillingContact, resolveBillingContact, getBillingContactStatus } = await import('../../src/app/api/services/billingService.js');
    const result = await proposeBillingContact({
      billingEntityKey: 'agent:agent1', billingEntityType: 'independent', billingEntityName: 'Jo Bloggs',
      proposedBillingName: 'Agency A Pty Ltd', proposedName: 'Jane Accounts', proposedEmail: 'accounts@a.example.com',
      agentUserId: 'agent1',
    });
    expect(result.status).toBe('pending');
    expect(await resolveBillingContact('agent:agent1')).toBeNull(); // critical: never usable until confirmed
    expect((await getBillingContactStatus('agent:agent1')).status).toBe('pending');
  });

  it('two DIFFERENT agents at the same named agency each file their own independent pending proposal — no collision, no 409', async () => {
    const { proposeBillingContact } = await import('../../src/app/api/services/billingService.js');
    await proposeBillingContact({
      billingEntityKey: 'agent:agentOne', billingEntityType: 'independent', billingEntityName: 'Jo Lee',
      proposedBillingName: 'Agency A', proposedEmail: 'first@a.example.com', agentUserId: 'agentOne',
    });
    await proposeBillingContact({
      billingEntityKey: 'agent:agentTwo', billingEntityType: 'independent', billingEntityName: 'Max Tan',
      proposedBillingName: 'Agency A', proposedEmail: 'second@a.example.com', agentUserId: 'agentTwo',
    });

    expect(fakeDb._store.billingContacts['agent:agentOne'].proposedEmail).toBe('first@a.example.com');
    expect(fakeDb._store.billingContacts['agent:agentTwo'].proposedEmail).toBe('second@a.example.com');
  });

  it('an agent cannot change their own contact once it is confirmed — admin-only from that point', async () => {
    const { proposeBillingContact, setBillingContact } = await import('../../src/app/api/services/billingService.js');
    await setBillingContact({ billingEntityKey: 'agent:agent1', billingName: 'Agency A', name: 'Jane', email: 'jane@a.example.com', adminUid: 'admin1' });

    await expect(proposeBillingContact({
      billingEntityKey: 'agent:agent1', billingEntityType: 'independent', billingEntityName: 'Jo Bloggs',
      proposedEmail: 'sneaky@attacker.example.com', agentUserId: 'agent1',
    })).rejects.toThrow(/confirmed/i);

    expect(fakeDb._store.billingContacts['agent:agent1'].email).toBe('jane@a.example.com'); // untouched
  });

  it('one agent\'s proposal, confirmation, or rejection never touches a DIFFERENT agent\'s record, even with an identical agency name or billing email', async () => {
    const { proposeBillingContact, setBillingContact } = await import('../../src/app/api/services/billingService.js');
    await proposeBillingContact({
      billingEntityKey: 'agent:agentA', billingEntityType: 'independent', billingEntityName: 'Jo Lee',
      proposedBillingName: 'Shared Agency', proposedEmail: 'shared@example.com', agentUserId: 'agentA',
    });
    await proposeBillingContact({
      billingEntityKey: 'agent:agentB', billingEntityType: 'independent', billingEntityName: 'Max Tan',
      proposedBillingName: 'Shared Agency', proposedEmail: 'shared@example.com', agentUserId: 'agentB',
    });
    await setBillingContact({ billingEntityKey: 'agent:agentA', billingName: 'Shared Agency', name: 'Jo Lee', email: 'shared@example.com', adminUid: 'admin1' });

    expect(fakeDb._store.billingContacts['agent:agentA'].status).toBe('confirmed');
    expect(fakeDb._store.billingContacts['agent:agentB'].status).toBe('pending'); // entirely unaffected
  });

  it('rejecting a pending proposal lets the agent resubmit afterwards', async () => {
    const { proposeBillingContact, rejectBillingContact, getBillingContactStatus } = await import('../../src/app/api/services/billingService.js');
    await proposeBillingContact({
      billingEntityKey: 'agent:agent1', billingEntityType: 'independent', billingEntityName: 'Jo Bloggs',
      proposedEmail: 'wrong-department@a.example.com', agentUserId: 'agent1',
    });
    await rejectBillingContact({ billingEntityKey: 'agent:agent1', reason: 'Wrong department — please resubmit with the accounts team\'s address', adminUid: 'admin1' });
    expect((await getBillingContactStatus('agent:agent1')).status).toBe('rejected');

    // Resubmission now succeeds.
    const result = await proposeBillingContact({
      billingEntityKey: 'agent:agent1', billingEntityType: 'independent', billingEntityName: 'Jo Bloggs',
      proposedEmail: 'corrected@a.example.com', agentUserId: 'agent1',
    });
    expect(result.status).toBe('pending');
  });

  it('rejecting when nothing is pending (already approved, or a concurrent reject already won) fails safely', async () => {
    const { rejectBillingContact } = await import('../../src/app/api/services/billingService.js');
    await expect(rejectBillingContact({ billingEntityKey: 'agent:never-proposed', adminUid: 'admin1' })).rejects.toThrow(/no pending/i);
  });

  it('approving (setBillingContact) a pending proposal moves it to confirmed and it becomes invoice-usable', async () => {
    const { proposeBillingContact, setBillingContact, resolveBillingContact } = await import('../../src/app/api/services/billingService.js');
    await proposeBillingContact({
      billingEntityKey: 'agent:agent1', billingEntityType: 'independent', billingEntityName: 'Jo Bloggs',
      proposedBillingName: 'Agency A Pty Ltd', proposedName: 'Jane Accounts', proposedEmail: 'accounts@a.example.com',
      agentUserId: 'agent1',
    });
    await setBillingContact({ billingEntityKey: 'agent:agent1', billingName: 'Agency A Pty Ltd', name: 'Jane Accounts', email: 'accounts@a.example.com', adminUid: 'admin1' });

    const contact = await resolveBillingContact('agent:agent1');
    expect(contact).toEqual({ name: 'Jane Accounts', email: 'accounts@a.example.com', billingName: 'Agency A Pty Ltd' });
  });
});

// ─── Route-level: agent-facing endpoints never trust a client-supplied key ───

describe('GET /api/agency/billing-contact-status', () => {
  it('401s with no auth', async () => {
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('is ALWAYS applicable — every agent has their own billing identity, with or without a companyName', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'solo1' });
    fakeDb._seed('users', 'solo1', { firstName: 'Jo' }); // no companyName at all
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const res = await GET(makeGetRequest('Bearer t'));
    const data = await res.json();
    expect(data.applicable).toBe(true);
    expect(data.status).toBe('unset');
  });

  it('reflects the real, server-resolved status for THIS agent\'s own key — unaffected by agencyBrandId', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('agencyBrands', 'brand-a', { name: 'Agency A', createdBy: 'agent1' });
    fakeDb._seed('users', 'agent1', { companyName: 'Agency A', agencyBrandId: 'brand-a' });
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const res = await GET(makeGetRequest('Bearer t'));
    const data = await res.json();
    expect(data.applicable).toBe(true);
    expect(data.status).toBe('unset');
  });

  it('two agents at the same agency each see only their OWN status — one being confirmed never clears the other\'s prompt', async () => {
    fakeDb._seed('users', 'agentA', { companyName: 'Shared Agency' });
    fakeDb._seed('users', 'agentB', { companyName: 'Shared Agency' });
    fakeDb._seed('billingContacts', 'agent:agentA', { status: 'confirmed', email: 'a@example.com' });

    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    mockVerifyIdToken.mockResolvedValue({ uid: 'agentA' });
    const dataA = await (await GET(makeGetRequest('Bearer t'))).json();
    mockVerifyIdToken.mockResolvedValue({ uid: 'agentB' });
    const dataB = await (await GET(makeGetRequest('Bearer t'))).json();

    expect(dataA.status).toBe('confirmed');
    expect(dataB.status).toBe('unset');
  });
});

describe('POST /api/agency/propose-billing-contact', () => {
  it('401s with no auth', async () => {
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(makeRequest({ contactEmail: 'a@example.com' }));
    expect(res.status).toBe(401);
  });

  it('SECURITY: always files a PENDING proposal awaiting superAdmin review — no instant self-confirm for any agent any more', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'solo1' });
    fakeDb._seed('users', 'solo1', {});
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(makeRequest({ contactEmail: 'solo@example.com' }, 'Bearer t'));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe('pending');
    expect(fakeDb._store.billingContacts['agent:solo1'].status).toBe('pending');
    expect(fakeDb._store.billingContacts['agent:solo1'].proposedEmail).toBe('solo@example.com');
  });

  it('ALWAYS writes under the server-resolved agent:{uid} key, ignoring any billingEntityKey the client tries to supply', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('agencyBrands', 'brand-real', { name: 'Real Agency', createdBy: 'agent1' });
    fakeDb._seed('users', 'agent1', { companyName: 'Real Agency', agencyBrandId: 'brand-real' });
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(makeRequest({
      billingEntityKey: 'agency:someone-elses-agency', // attempted injection — must be ignored entirely
      billingName: 'Real Agency', contactName: 'Jane', contactEmail: 'jane@real.example.com',
    }, 'Bearer t'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.billingEntityKey).toBe('agent:agent1'); // the agent's OWN real key, never the injected one
    expect(fakeDb._store.billingContacts['agency:someone-elses-agency']).toBeUndefined();
  });

  it('two VERIFIED agents at the SAME real agency land under TWO separate keys, never one shared entry', async () => {
    fakeDb._seed('agencyBrands', 'brand-shared', { name: 'Shared Agency', createdBy: 'agentA' });
    fakeDb._seed('users', 'agentA', { companyName: 'Shared Agency', agencyBrandId: 'brand-shared' });
    fakeDb._seed('users', 'agentB', { companyName: 'Shared Agency', agencyBrandId: 'brand-shared' });
    fakeDb._seed('agencyMemberships', 'agentB', { uid: 'agentB', agencyBrandId: 'brand-shared', status: 'verified' });
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');

    mockVerifyIdToken.mockResolvedValue({ uid: 'agentA' });
    await POST(makeRequest({ contactEmail: 'first@shared.example.com' }, 'Bearer t'));
    mockVerifyIdToken.mockResolvedValue({ uid: 'agentB' });
    await POST(makeRequest({ contactEmail: 'second@shared.example.com' }, 'Bearer t'));

    expect(Object.keys(fakeDb._store.billingContacts).sort()).toEqual(['agent:agentA', 'agent:agentB']);
  });

  it('SECURITY: an agent with a companyName matching an EXISTING, already-confirmed agency is STILL only ever confirmed through their own separate review — never inherits the other entity\'s confirmed status', async () => {
    fakeDb._seed('billingContacts', 'agent:establishedAgent', {
      status: 'confirmed', billingName: 'Established Agency Pty Ltd', name: 'Real Accounts', email: 'real-accounts@established.example.com',
    });
    fakeDb._seed('users', 'newAgent', { companyName: 'Established Agency' });
    mockVerifyIdToken.mockResolvedValue({ uid: 'newAgent' });

    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const statusData = await (await GET(makeGetRequest('Bearer t'))).json();
    expect(statusData.applicable).toBe(true);
    expect(statusData.status).toBe('unset'); // newAgent's OWN key — unaffected by the other agent's confirmation

    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(makeRequest({ contactEmail: 'newagent@example.com' }, 'Bearer t'));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('pending');
    // The unrelated, already-confirmed agent's record is completely untouched.
    expect(fakeDb._store.billingContacts['agent:establishedAgent'].email).toBe('real-accounts@established.example.com');
  });
});

// ─── Route-level: admin approval workflow ───

describe('GET /api/admin/invoicing/billing-contacts (pending list) — one row per agent', () => {
  it('401s with no auth, 403s for a non-admin', async () => {
    const { GET } = await import('../../src/app/api/admin/invoicing/billing-contacts/route.js');
    expect((await GET(makeGetRequest())).status).toBe(401);

    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    expect((await GET(makeGetRequest('Bearer t'))).status).toBe(403);
  });

  it('lists only pending proposals, discoverable with no invoice run involved at all', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('billingContacts', 'agent:a', { billingEntityKey: 'agent:a', status: 'pending', proposedEmail: 'a@example.com' });
    fakeDb._seed('billingContacts', 'agent:b', { billingEntityKey: 'agent:b', status: 'confirmed', email: 'b@example.com' });

    const { GET } = await import('../../src/app/api/admin/invoicing/billing-contacts/route.js');
    const res = await GET(makeGetRequest('Bearer t'));
    const data = await res.json();
    expect(data.pending).toHaveLength(1);
    expect(data.pending[0].billingEntityKey).toBe('agent:a');
  });

  it('two agents at the SAME named agency both appear as SEPARATE rows, never grouped into one', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('billingContacts', 'agent:agentA', { billingEntityKey: 'agent:agentA', billingEntityName: 'Jo Lee', status: 'pending', proposedBillingName: 'Harcourts Property Hub', proposedEmail: 'jo@example.com' });
    fakeDb._seed('billingContacts', 'agent:agentB', { billingEntityKey: 'agent:agentB', billingEntityName: 'Max Tan', status: 'pending', proposedBillingName: 'Harcourts Property Hub', proposedEmail: 'max@example.com' });

    const { GET } = await import('../../src/app/api/admin/invoicing/billing-contacts/route.js');
    const data = await (await GET(makeGetRequest('Bearer t'))).json();
    expect(data.pending).toHaveLength(2);
    expect(data.pending.map((p) => p.billingEntityKey).sort()).toEqual(['agent:agentA', 'agent:agentB']);
  });
});

describe('POST /api/admin/invoicing/billing-contacts/reject', () => {
  it('401s with no auth, 403s for a non-admin', async () => {
    const { POST } = await import('../../src/app/api/admin/invoicing/billing-contacts/reject/route.js');
    expect((await POST(makeRequest({ billingEntityKey: 'agent:a' }))).status).toBe(401);

    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    expect((await POST(makeRequest({ billingEntityKey: 'agent:a' }, 'Bearer t'))).status).toBe(403);
  });

  it('rejects a pending proposal as an admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('billingContacts', 'agent:a', { billingEntityKey: 'agent:a', status: 'pending', proposedEmail: 'bad@@a.example' });

    const { POST } = await import('../../src/app/api/admin/invoicing/billing-contacts/reject/route.js');
    const res = await POST(makeRequest({ billingEntityKey: 'agent:a', reason: 'Bad email' }, 'Bearer t'));
    expect(res.status).toBe(200);
    expect(fakeDb._store.billingContacts['agent:a'].status).toBe('rejected');
  });
});

// ─── Send-time safety: the critical invoice guard ───

describe('send/route.js — per-agent billing-contact safety guard', () => {
  function makeSendRequest() {
    const headers = new Headers({ authorization: 'Bearer t' });
    return new Request('http://localhost/test', { method: 'POST', headers });
  }

  beforeEach(() => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    mockIsXeroConnected.mockResolvedValue(true);
    mockFindOrCreateContact.mockResolvedValue({ ContactID: 'contact1' });
    mockCreateInvoice.mockResolvedValue({ InvoiceID: 'inv1', InvoiceNumber: 'PM-1', Status: 'AUTHORISED' });
    mockSendInvoice.mockResolvedValue({});
    mockFindInvoiceByReference.mockResolvedValue(null);
  });

  function seedRun({ billingContact } = {}) {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1',
      billingEntityType: 'independent',
      billingEntityKey: 'agent:a',
      agencyName: 'Agency A',
      agentName: 'Whoever Submitted First', // deliberately the STALE/wrong value — see the test below
      agentEmail: 'whoever-submitted-first@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    if (billingContact) {
      fakeDb._seed('billingContacts', 'agent:a', billingContact);
    }
  }

  it('blocks sending for an agent with no confirmed contact — charge stays recorded, nothing sent to Xero', async () => {
    seedRun(); // no billingContacts doc at all
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeSendRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(body.errors[0].error).toMatch(/billing details required/i);

    const item = (await fakeDb.collection('invoiceRunItems').doc('item1').get()).data();
    expect(item.status).toBe('contact_required');
    // The underlying charge itself is untouched/still real — only released back to pending for a future run, never lost or deleted.
  });

  it('a merely PENDING (not yet admin-approved) proposal still blocks sending — proposing is not the same as confirming', async () => {
    seedRun({ billingContact: { billingEntityKey: 'agent:a', status: 'pending', proposedEmail: 'proposed@a.example.com' } });
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeSendRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
  });

  it('once confirmed, sends using the CONFIRMED contact — never the stale agentName/agentEmail stamped on the item, never a login-email fallback', async () => {
    seedRun({
      billingContact: {
        billingEntityKey: 'agent:a', status: 'confirmed',
        billingName: 'Agency A Pty Ltd', name: 'Real Accounts Contact', email: 'real-accounts@a.example.com',
      },
    });
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeSendRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('sent');
    expect(mockFindOrCreateContact).toHaveBeenCalledWith(expect.objectContaining({
      email: 'real-accounts@a.example.com',
    }));
    // The stale item-level fields were never used for anything sent to Xero.
    expect(mockFindOrCreateContact).not.toHaveBeenCalledWith(expect.objectContaining({ email: 'whoever-submitted-first@example.com' }));
  });

  it('blocking one agent\'s item in a run never touches a DIFFERENT, already-confirmed agent\'s item in the SAME run', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'itemBlocked', {
      runId: 'run1', billingEntityType: 'independent', billingEntityKey: 'agent:unconfirmed',
      agencyName: 'Unconfirmed Agent', agentName: 'X', agentEmail: 'x@example.com',
      properties: [{ propertyId: 'pX', address: '1 X St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    fakeDb._seed('billingContacts', 'agent:confirmed', { status: 'confirmed', billingName: 'Confirmed Agent', name: 'Y', email: 'y@example.com' });
    fakeDb._seed('invoiceRunItems', 'itemConfirmed', {
      runId: 'run1', billingEntityType: 'independent', billingEntityKey: 'agent:confirmed',
      agencyName: 'Confirmed Agent', agentName: 'Y', agentEmail: 'y@example.com',
      properties: [{ propertyId: 'pY', address: '1 Y St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });

    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeSendRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('partial');
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
    const confirmedItem = (await fakeDb.collection('invoiceRunItems').doc('itemConfirmed').get()).data();
    expect(confirmedItem.status).toBe('sent');
  });
});
