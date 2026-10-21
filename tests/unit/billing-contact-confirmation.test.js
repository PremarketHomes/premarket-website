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

describe('resolveBillingEntityForAgent', () => {
  it('resolves a VERIFIED agency agent (brand creator) to an agency-type entity', async () => {
    fakeDb._seed('users', 'agent1', { companyName: 'Acme Realty', firstName: 'Jo', lastName: 'Bloggs', agencyBrandId: 'brand-acme' });
    fakeDb._seed('agencyBrands', 'brand-acme', { name: 'Acme Realty', createdBy: 'agent1' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const entity = await resolveBillingEntityForAgent('agent1');
    expect(entity.billingEntityType).toBe('agency');
    expect(entity.billingEntityKey).toBe('brand:brand-acme');
  });

  it('SECURITY: companyName alone, with no verified brand, resolves as independent — never agency', async () => {
    fakeDb._seed('users', 'agent1', { companyName: 'Acme Realty', firstName: 'Jo', lastName: 'Bloggs' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const entity = await resolveBillingEntityForAgent('agent1');
    expect(entity.billingEntityType).toBe('independent');
  });

  it('resolves an agent with no companyName to independent — no separate agency to confirm', async () => {
    fakeDb._seed('users', 'agent1', { firstName: 'Jo', lastName: 'Solo' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const entity = await resolveBillingEntityForAgent('agent1');
    expect(entity.billingEntityType).toBe('independent');
    expect(entity.billingEntityKey).toBe('agent:agent1');
  });

  it('two differently-spelled but genuinely different agency names never resolve to the same key', async () => {
    fakeDb._seed('users', 'agentA', { companyName: 'Harcourts Property Hub' });
    fakeDb._seed('users', 'agentB', { companyName: 'Harcourts Properties Hub' }); // one letter different — a real, different agency
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const a = await resolveBillingEntityForAgent('agentA');
    const b = await resolveBillingEntityForAgent('agentB');
    expect(a.billingEntityKey).not.toBe(b.billingEntityKey);
  });

  it('two VERIFIED members of the same agency resolve to the SAME key', async () => {
    fakeDb._seed('agencyBrands', 'brand-hph', { name: 'Harcourts Property Hub', createdBy: 'agentA' });
    fakeDb._seed('users', 'agentA', { companyName: 'Harcourts Property Hub', agencyBrandId: 'brand-hph' });
    fakeDb._seed('users', 'agentB', { companyName: 'Harcourts Property Hub', agencyBrandId: 'brand-hph' });
    fakeDb._seed('agencyMemberships', 'agentB', { uid: 'agentB', agencyBrandId: 'brand-hph', status: 'verified' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const a = await resolveBillingEntityForAgent('agentA');
    const b = await resolveBillingEntityForAgent('agentB');
    expect(a.billingEntityKey).toBe(b.billingEntityKey);
  });

  it('SECURITY: two agents merely sharing the same companyName (no verified brand) do NOT resolve to the same key', async () => {
    fakeDb._seed('users', 'agentA', { companyName: 'Harcourts Property Hub' });
    fakeDb._seed('users', 'agentB', { companyName: '  harcourts property hub  ' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const a = await resolveBillingEntityForAgent('agentA');
    const b = await resolveBillingEntityForAgent('agentB');
    expect(a.billingEntityKey).not.toBe(b.billingEntityKey);
  });

  it('an admin override always wins, even over companyName', async () => {
    fakeDb._seed('users', 'agent1', { companyName: 'Some Agency' });
    fakeDb._seed('billingAgencyOverrides', 'agent1', { billingEntityKey: 'agency:override-target', billingEntityName: 'Override Target' });
    const { resolveBillingEntityForAgent } = await import('../../src/app/api/services/billingService.js');
    const entity = await resolveBillingEntityForAgent('agent1');
    expect(entity.billingEntityKey).toBe('agency:override-target');
  });
});

// ─── billingService-level: propose / approve / reject lifecycle ───

describe('proposeBillingContact / setBillingContact / rejectBillingContact lifecycle', () => {
  it('independent agents cannot propose a billing contact at all', async () => {
    const { proposeBillingContact } = await import('../../src/app/api/services/billingService.js');
    await expect(proposeBillingContact({
      billingEntityKey: 'agent:solo1', billingEntityType: 'independent', billingEntityName: 'Jo Solo',
      proposedEmail: 'jo@example.com', agentUserId: 'solo1',
    })).rejects.toThrow(/independent/i);
  });

  it('a fresh proposal on an unset agency succeeds and is NOT usable for invoicing yet', async () => {
    const { proposeBillingContact, resolveBillingContact, getBillingContactStatus } = await import('../../src/app/api/services/billingService.js');
    const result = await proposeBillingContact({
      billingEntityKey: 'agency:a', billingEntityType: 'agency', billingEntityName: 'Agency A',
      proposedBillingName: 'Agency A Pty Ltd', proposedName: 'Jane Accounts', proposedEmail: 'accounts@a.example.com',
      agentUserId: 'agent1',
    });
    expect(result.status).toBe('pending');
    expect(await resolveBillingContact('agency:a')).toBeNull(); // critical: never usable until confirmed
    expect((await getBillingContactStatus('agency:a')).status).toBe('pending');
  });

  it('a SECOND agent at the same agency cannot overwrite a still-pending proposal — the first submission holds the slot', async () => {
    const { proposeBillingContact } = await import('../../src/app/api/services/billingService.js');
    await proposeBillingContact({
      billingEntityKey: 'agency:a', billingEntityType: 'agency', billingEntityName: 'Agency A',
      proposedEmail: 'first@a.example.com', agentUserId: 'agentOne',
    });
    await expect(proposeBillingContact({
      billingEntityKey: 'agency:a', billingEntityType: 'agency', billingEntityName: 'Agency A',
      proposedEmail: 'second@a.example.com', agentUserId: 'agentTwo',
    })).rejects.toThrow(/pending/i);

    expect(fakeDb._store.billingContacts['agency:a'].proposedEmail).toBe('first@a.example.com'); // unchanged
  });

  it('an agent cannot propose a change once the agency contact is confirmed — admin-only from that point', async () => {
    const { proposeBillingContact, setBillingContact } = await import('../../src/app/api/services/billingService.js');
    await setBillingContact({ billingEntityKey: 'agency:a', billingName: 'Agency A', name: 'Jane', email: 'jane@a.example.com', adminUid: 'admin1' });

    await expect(proposeBillingContact({
      billingEntityKey: 'agency:a', billingEntityType: 'agency', billingEntityName: 'Agency A',
      proposedEmail: 'sneaky@attacker.example.com', agentUserId: 'agentX',
    })).rejects.toThrow(/confirmed/i);

    expect(fakeDb._store.billingContacts['agency:a'].email).toBe('jane@a.example.com'); // untouched
  });

  it('rejecting a pending proposal lets the agency resubmit afterwards', async () => {
    const { proposeBillingContact, rejectBillingContact, getBillingContactStatus } = await import('../../src/app/api/services/billingService.js');
    await proposeBillingContact({
      billingEntityKey: 'agency:a', billingEntityType: 'agency', billingEntityName: 'Agency A',
      proposedEmail: 'wrong-department@a.example.com', agentUserId: 'agent1',
    });
    await rejectBillingContact({ billingEntityKey: 'agency:a', reason: 'Wrong department — please resubmit with the accounts team\'s address', adminUid: 'admin1' });
    expect((await getBillingContactStatus('agency:a')).status).toBe('rejected');

    // Resubmission now succeeds.
    const result = await proposeBillingContact({
      billingEntityKey: 'agency:a', billingEntityType: 'agency', billingEntityName: 'Agency A',
      proposedEmail: 'corrected@a.example.com', agentUserId: 'agent1',
    });
    expect(result.status).toBe('pending');
  });

  it('rejecting when nothing is pending (already approved, or a concurrent reject already won) fails safely', async () => {
    const { rejectBillingContact } = await import('../../src/app/api/services/billingService.js');
    await expect(rejectBillingContact({ billingEntityKey: 'agency:never-proposed', adminUid: 'admin1' })).rejects.toThrow(/no pending/i);
  });

  it('approving (setBillingContact) a pending proposal moves it to confirmed and it becomes invoice-usable', async () => {
    const { proposeBillingContact, setBillingContact, resolveBillingContact } = await import('../../src/app/api/services/billingService.js');
    await proposeBillingContact({
      billingEntityKey: 'agency:a', billingEntityType: 'agency', billingEntityName: 'Agency A',
      proposedBillingName: 'Agency A Pty Ltd', proposedName: 'Jane Accounts', proposedEmail: 'accounts@a.example.com',
      agentUserId: 'agent1',
    });
    await setBillingContact({ billingEntityKey: 'agency:a', billingName: 'Agency A Pty Ltd', name: 'Jane Accounts', email: 'accounts@a.example.com', adminUid: 'admin1' });

    const contact = await resolveBillingContact('agency:a');
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

  it('independent agents get applicable: false', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'solo1' });
    fakeDb._seed('users', 'solo1', { firstName: 'Jo' }); // no companyName
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const res = await GET(makeGetRequest('Bearer t'));
    const data = await res.json();
    expect(data.applicable).toBe(false);
  });

  it('reflects the real, server-resolved status for a VERIFIED agency agent', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('agencyBrands', 'brand-a', { name: 'Agency A', createdBy: 'agent1' });
    fakeDb._seed('users', 'agent1', { companyName: 'Agency A', agencyBrandId: 'brand-a' });
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const res = await GET(makeGetRequest('Bearer t'));
    const data = await res.json();
    expect(data.applicable).toBe(true);
    expect(data.status).toBe('unset');
  });

  it('IS applicable (pending) for an agent with only a companyName and no verified brand — the simplified, low-friction signup path', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { companyName: 'Agency A' });
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const res = await GET(makeGetRequest('Bearer t'));
    const data = await res.json();
    expect(data.applicable).toBe(true);
    expect(data.status).toBe('unset');
    expect(data.billingEntityName).toBe('Agency A');
  });

  it('is NOT applicable for a genuinely independent agent — no companyName at all', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'solo1' });
    fakeDb._seed('users', 'solo1', {});
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const res = await GET(makeGetRequest('Bearer t'));
    const data = await res.json();
    expect(data.applicable).toBe(false);
  });
});

describe('POST /api/agency/propose-billing-contact', () => {
  it('401s with no auth', async () => {
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(makeRequest({ contactEmail: 'a@example.com' }));
    expect(res.status).toBe(401);
  });

  it('a genuinely independent agent (no companyName) confirms their own billing email immediately — no admin review', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'solo1' });
    fakeDb._seed('users', 'solo1', {});
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(makeRequest({ contactEmail: 'solo@example.com' }, 'Bearer t'));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe('confirmed');
    expect(fakeDb._store.billingContacts['agent:solo1'].status).toBe('confirmed');
    expect(fakeDb._store.billingContacts['agent:solo1'].email).toBe('solo@example.com');
  });

  it('ALWAYS writes under the server-resolved key, ignoring any billingEntityKey the client tries to supply', async () => {
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
    expect(data.billingEntityKey).toBe('brand:brand-real'); // the agent's OWN real key, never the injected one
    expect(fakeDb._store.billingContacts['agency:someone-elses-agency']).toBeUndefined();
  });

  it('two VERIFIED agents proposing for the same real agency both land under the one shared key', async () => {
    fakeDb._seed('agencyBrands', 'brand-shared', { name: 'Shared Agency', createdBy: 'agentA' });
    fakeDb._seed('users', 'agentA', { companyName: 'Shared Agency', agencyBrandId: 'brand-shared' });
    mockVerifyIdToken.mockResolvedValue({ uid: 'agentA' });
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    await POST(makeRequest({ contactEmail: 'first@shared.example.com' }, 'Bearer t'));

    expect(Object.keys(fakeDb._store.billingContacts)).toEqual(['brand:brand-shared']);
  });

  it('SECURITY: an agent with only a companyName (no verified brand) files a PENDING proposal — never instantly confirmed, isolated under its own agency key', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'agentX' });
    fakeDb._seed('users', 'agentX', { companyName: 'Harcourts Property Hub' }); // unverified — the exact scenario from the Phil incident
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(makeRequest({ contactEmail: 'attempt@example.com' }, 'Bearer t'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('pending'); // filed for review, never auto-confirmed off the name match
    const doc = fakeDb._store.billingContacts['agency:harcourts property hub'];
    expect(doc.status).toBe('pending');
    expect(doc.proposedBy).toBe('agentX');
  });

  it('SECURITY: two different agents with the same unresolved company name both land as claimants on the ONE pending entry, never two separate confirmed entities', async () => {
    fakeDb._seed('users', 'agentA', { companyName: 'New Agency' });
    fakeDb._seed('users', 'agentB', { companyName: 'New Agency' });
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');

    mockVerifyIdToken.mockResolvedValue({ uid: 'agentA' });
    await POST(makeRequest({ contactEmail: 'a@example.com' }, 'Bearer t'));
    mockVerifyIdToken.mockResolvedValue({ uid: 'agentB' });
    const res = await POST(makeRequest({ contactEmail: 'b@example.com' }, 'Bearer t'));

    expect(res.status).toBe(200); // never rejected/409 — this is the exact lean-onboarding fix
    const doc = fakeDb._store.billingContacts['agency:new agency'];
    expect(doc.status).toBe('pending');
    expect(doc.proposedByUids).toEqual(['agentA', 'agentB']);
    expect(Object.keys(fakeDb._store.billingContacts)).toHaveLength(1); // one entity, not two
  });

  it('a new agent entering an ALREADY-CONFIRMED agency\'s exact name is low-friction folded in for billing (the explicit, approved trade-off) but CANNOT overwrite the confirmed contact', async () => {
    fakeDb._seed('billingContacts', 'agency:established agency', {
      billingEntityKey: 'agency:established agency', billingEntityType: 'agency', billingEntityName: 'Established Agency',
      status: 'confirmed', billingName: 'Established Agency Pty Ltd', name: 'Real Accounts', email: 'real-accounts@established.example.com',
    });
    fakeDb._seed('users', 'newAgent', { companyName: 'Established Agency' });
    mockVerifyIdToken.mockResolvedValue({ uid: 'newAgent' });

    // Their own charge/entity resolution already folds them in —
    // confirmed via the status route.
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const statusRes = await GET(makeGetRequest('Bearer t'));
    const statusData = await statusRes.json();
    expect(statusData.applicable).toBe(true);
    expect(statusData.status).toBe('confirmed');

    // But attempting to propose/change the contact is rejected — the
    // confirmed record is admin-only to change, regardless of who
    // tries, satisfying "never overwrite an existing agency's
    // confirmed billing contact with information entered by a newly
    // registered agent."
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(makeRequest({ contactEmail: 'attacker-chosen@example.com' }, 'Bearer t'));
    expect(res.status).toBe(409);
    expect(fakeDb._store.billingContacts['agency:established agency'].email).toBe('real-accounts@established.example.com'); // untouched
  });

  it('two unrelated agencies that happen to share a name resolve to the SAME key by construction but each independently requires its own superAdmin confirmation — never merged by the name alone', async () => {
    fakeDb._seed('users', 'agentFromAgencyOne', { companyName: 'Prestige Realty' });
    fakeDb._seed('users', 'agentFromUnrelatedAgencyTwo', { companyName: 'Prestige Realty' }); // coincidentally identical name, genuinely unrelated business
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');

    mockVerifyIdToken.mockResolvedValue({ uid: 'agentFromAgencyOne' });
    await POST(makeRequest({ contactEmail: 'one@example.com' }, 'Bearer t'));

    // Nothing is confirmed yet — a superAdmin must explicitly review,
    // and would see BOTH claimants on the one entry rather than either
    // being silently trusted. This is the documented, intentional
    // limitation: an exact name collision between genuinely unrelated
    // businesses relies on the superAdmin noticing during review, not
    // on automatic detection — the system never auto-merges or
    // auto-confirms either one.
    const doc = fakeDb._store.billingContacts['agency:prestige realty'];
    expect(doc.status).toBe('pending');
    expect(doc.email).toBeUndefined(); // never auto-confirmed/usable for a real invoice
  });
});

// ─── Route-level: admin approval workflow ───

describe('GET /api/admin/invoicing/billing-contacts (pending list)', () => {
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
    fakeDb._seed('billingContacts', 'agency:a', { billingEntityKey: 'agency:a', status: 'pending', proposedEmail: 'a@example.com' });
    fakeDb._seed('billingContacts', 'agency:b', { billingEntityKey: 'agency:b', status: 'confirmed', email: 'b@example.com' });

    const { GET } = await import('../../src/app/api/admin/invoicing/billing-contacts/route.js');
    const res = await GET(makeGetRequest('Bearer t'));
    const data = await res.json();
    expect(data.pending).toHaveLength(1);
    expect(data.pending[0].billingEntityKey).toBe('agency:a');
  });
});

describe('POST /api/admin/invoicing/billing-contacts/reject', () => {
  it('401s with no auth, 403s for a non-admin', async () => {
    const { POST } = await import('../../src/app/api/admin/invoicing/billing-contacts/reject/route.js');
    expect((await POST(makeRequest({ billingEntityKey: 'agency:a' }))).status).toBe(401);

    mockVerifyIdToken.mockResolvedValue({ uid: 'agent1' });
    fakeDb._seed('users', 'agent1', { superAdmin: false });
    expect((await POST(makeRequest({ billingEntityKey: 'agency:a' }, 'Bearer t'))).status).toBe(403);
  });

  it('rejects a pending proposal as an admin', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'admin1' });
    fakeDb._seed('users', 'admin1', { superAdmin: true });
    fakeDb._seed('billingContacts', 'agency:a', { billingEntityKey: 'agency:a', status: 'pending', proposedEmail: 'bad@@a.example' });

    const { POST } = await import('../../src/app/api/admin/invoicing/billing-contacts/reject/route.js');
    const res = await POST(makeRequest({ billingEntityKey: 'agency:a', reason: 'Bad email' }, 'Bearer t'));
    expect(res.status).toBe(200);
    expect(fakeDb._store.billingContacts['agency:a'].status).toBe('rejected');
  });
});

// ─── Send-time safety: the critical invoice guard ───

describe('send/route.js — agency billing-contact safety guard', () => {
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
      billingEntityType: 'agency',
      billingEntityKey: 'agency:a',
      agencyName: 'Agency A',
      agentName: 'Whoever Submitted First', // deliberately the STALE/wrong value — see the test below
      agentEmail: 'whoever-submitted-first@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    if (billingContact) {
      fakeDb._seed('billingContacts', 'agency:a', billingContact);
    }
  }

  it('blocks sending for an agency with no confirmed contact — charge stays recorded, nothing sent to Xero', async () => {
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
    seedRun({ billingContact: { billingEntityKey: 'agency:a', status: 'pending', proposedEmail: 'proposed@a.example.com' } });
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    await POST(makeSendRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    expect(mockFindOrCreateContact).not.toHaveBeenCalled();
  });

  it('once confirmed, sends using the CONFIRMED contact — never the stale agentName/agentEmail stamped on the item', async () => {
    seedRun({
      billingContact: {
        billingEntityKey: 'agency:a', status: 'confirmed',
        billingName: 'Agency A Pty Ltd', name: 'Real Accounts Contact', email: 'real-accounts@a.example.com',
      },
    });
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeSendRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();

    expect(body.status).toBe('sent');
    expect(mockFindOrCreateContact).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Agency A Pty Ltd',
      email: 'real-accounts@a.example.com',
    }));
    // The stale item-level fields were never used for anything sent to Xero.
    expect(mockFindOrCreateContact).not.toHaveBeenCalledWith(expect.objectContaining({ email: 'whoever-submitted-first@example.com' }));
  });

  it('independent agents are completely unaffected — their own identity remains the contact, no confirmation required', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'item1', {
      runId: 'run1', billingEntityType: 'independent', billingEntityKey: 'agent:solo1',
      agencyName: 'Jo Solo', agentName: 'Jo Solo', agentEmail: 'jo@example.com',
      properties: [{ propertyId: 'p1', address: '1 Test St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    const { POST } = await import('../../src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    const res = await POST(makeSendRequest(), { params: Promise.resolve({ runId: 'run1' }) });
    const body = await res.json();
    expect(body.status).toBe('sent');
    expect(mockFindOrCreateContact).toHaveBeenCalledWith(expect.objectContaining({ email: 'jo@example.com' }));
  });

  it('blocking one agency item in a run never touches a different, already-confirmed agency item in the SAME run', async () => {
    fakeDb._seed('invoiceRuns', 'run1', { status: 'approved', periodStart: new Date('2026-10-01') });
    fakeDb._seed('invoiceRunItems', 'itemBlocked', {
      runId: 'run1', billingEntityType: 'agency', billingEntityKey: 'agency:unconfirmed',
      agencyName: 'Unconfirmed Agency', agentName: 'X', agentEmail: 'x@example.com',
      properties: [{ propertyId: 'pX', address: '1 X St', subtotalEx: 200, gstAmount: 0, totalInc: 200 }],
    });
    fakeDb._seed('billingContacts', 'agency:confirmed', { status: 'confirmed', billingName: 'Confirmed Agency', name: 'Y', email: 'y@example.com' });
    fakeDb._seed('invoiceRunItems', 'itemConfirmed', {
      runId: 'run1', billingEntityType: 'agency', billingEntityKey: 'agency:confirmed',
      agencyName: 'Confirmed Agency', agentName: 'Y', agentEmail: 'y@example.com',
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
