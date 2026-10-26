import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const billing = await import('../../src/app/api/services/billingService');
const { createInvoiceRunFromPendingCharges } = await import('../../src/app/api/services/invoiceRunService');

const HPH = 'hphOffice1';
const ACTIVATION = new Date('2026-01-01');

function seedBasics() {
  db.seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0, billingActivatedAt: ACTIVATION });
  db.seed('officeAdminInfo', HPH, { name: 'Harcourts Property Hub', status: 'active', officeAdminUids: ['hphAdmin'] });
  db.seed('users', 'hphAdmin', { firstName: 'Ada', lastName: 'Admin', email: 'ada@hph.test', officeId: HPH, isOfficeAdmin: true });
  db.seed('users', 'phil', { firstName: 'Phil', lastName: 'Agent', email: 'phil@hph.test', officeId: HPH });
  db.seed('users', 'sam', { firstName: 'Sam', lastName: 'Agent', email: 'sam@hph.test', officeId: HPH });
  db.seed('users', 'solo', { firstName: 'Sol', lastName: 'Solo', email: 'sol@solo.test' });
}
const prop = (id, userId, address) => ({ id, userId, address, createdAt: new Date('2026-10-01') });

beforeEach(() => {
  db = makeFakeDb();
  seedBasics();
});

describe('resolveBillingEntity', () => {
  it('office agents resolve to office:{officeId} and carry the office snapshot', () => {
    expect(billing.resolveBillingEntity({ agentUserId: 'phil', officeId: HPH, officeName: 'Harcourts Property Hub' })).toEqual({
      billingEntityType: 'office',
      billingEntityKey: `office:${HPH}`,
      billingEntityName: 'Harcourts Property Hub',
      officeId: HPH,
      officeName: 'Harcourts Property Hub',
    });
  });

  it('independent agents resolve exactly as before: agent:{uid}, no office fields', () => {
    expect(billing.resolveBillingEntity({ agentUserId: 'solo', firstName: 'Sol', lastName: 'Solo' })).toEqual({
      billingEntityType: 'independent',
      billingEntityKey: 'agent:solo',
      billingEntityName: 'Sol Solo',
    });
  });

  it('an agent whose officeId points at a missing or inactive office stays independent', async () => {
    db.seed('users', 'orphan', { firstName: 'Or', lastName: 'Phan', officeId: 'ghostOffice' });
    expect((await billing.resolveBillingEntityForAgent('orphan')).billingEntityKey).toBe('agent:orphan');
    db.seed('officeAdminInfo', 'closedOffice', { name: 'Closed', status: 'disabled' });
    db.seed('users', 'ex', { firstName: 'Ex', lastName: 'Member', officeId: 'closedOffice' });
    expect((await billing.resolveBillingEntityForAgent('ex')).billingEntityKey).toBe('agent:ex');
  });
});

describe('resolveBillingAccessForAgent', () => {
  it('only the office administrator may manage the office billing details', async () => {
    expect((await billing.resolveBillingAccessForAgent('hphAdmin')).canManage).toBe(true);
    const agent = await billing.resolveBillingAccessForAgent('phil');
    expect(agent.canManage).toBe(false);
    expect(agent.entity.billingEntityKey).toBe(`office:${HPH}`);
  });

  it('independent agents manage their own', async () => {
    const solo = await billing.resolveBillingAccessForAgent('solo');
    expect(solo).toMatchObject({ canManage: true, entity: { billingEntityKey: 'agent:solo' } });
  });
});

describe('charge creation', () => {
  it('records an HPH agent\'s $200 charge against the office, with office attribution and the creating agent kept', async () => {
    await billing.recordPropertyCharge(prop('p1', 'phil', '1 Phil St'));
    expect(db._store.propertyCharges.p1).toMatchObject({
      billingEntityType: 'office',
      billingEntityKey: `office:${HPH}`,
      billingEntityName: 'Harcourts Property Hub',
      officeId: HPH,
      officeName: 'Harcourts Property Hub',
      agentUserId: 'phil',
      agentName: 'Phil Agent',
      totalInc: 200,
      subtotalEx: 200,
      status: 'pending',
    });
  });

  it('records an independent agent\'s charge exactly as before (agent:{uid}, no office fields)', async () => {
    await billing.recordPropertyCharge(prop('p2', 'solo', '2 Solo St'));
    const charge = db._store.propertyCharges.p2;
    expect(charge).toMatchObject({ billingEntityType: 'independent', billingEntityKey: 'agent:solo', totalInc: 200 });
    expect(charge).not.toHaveProperty('officeId');
    expect(charge).not.toHaveProperty('officeName');
  });

  it('createPropertyAndChargeAtomically attributes new office campaigns to the office too', async () => {
    const { propertyId } = await billing.createPropertyAndChargeAtomically({ userId: 'sam', address: '3 Sam St', createdAt: new Date() });
    expect(db._store.propertyCharges[propertyId]).toMatchObject({ billingEntityKey: `office:${HPH}`, officeId: HPH });
  });

  it('duplicate protection: recording and reconciling the same property repeatedly never creates a second charge', async () => {
    db.seed('properties', 'p1', { userId: 'phil', address: '1 Phil St', createdAt: new Date('2026-10-01') });
    await billing.recordPropertyCharge(prop('p1', 'phil', '1 Phil St'));
    const again = await billing.recordPropertyCharge(prop('p1', 'phil', '1 Phil St'));
    expect(again).toMatchObject({ created: false, reason: 'already-recorded' });
    await billing.reconcileMissingCharges();
    await billing.reconcileMissingCharges();
    expect(Object.keys(db._store.propertyCharges)).toEqual(['p1']);
  });
});

describe('agents changing offices', () => {
  it('a charge keeps its office attribution after the agent leaves the office', async () => {
    await billing.recordPropertyCharge(prop('p1', 'phil', '1 Phil St'));
    delete db._store.users.phil.officeId; // what removeAgentFromOffice does
    expect(db._store.propertyCharges.p1.billingEntityKey).toBe(`office:${HPH}`);
    // ...and a campaign created AFTER leaving is independent.
    await billing.recordPropertyCharge(prop('p9', 'phil', '9 After St'));
    expect(db._store.propertyCharges.p9.billingEntityKey).toBe('agent:phil');
  });

  it('settling before the agent leaves records unrecorded campaigns under the office, not the independent account', async () => {
    db.seed('properties', 'p1', { userId: 'phil', address: '1 Phil St', createdAt: new Date('2026-10-01') });
    await billing.settleChargesForAgent('phil'); // called by removeAgentFromOffice before unlinking
    delete db._store.users.phil.officeId;
    await billing.reconcileMissingCharges(); // the hourly sweep running afterwards
    expect(db._store.propertyCharges.p1).toMatchObject({ billingEntityKey: `office:${HPH}`, officeId: HPH });
  });

  it('settling before an existing agent joins keeps their earlier campaigns on their own independent account', async () => {
    db.seed('users', 'newJoiner', { firstName: 'New', lastName: 'Joiner' });
    db.seed('properties', 'pOld', { userId: 'newJoiner', address: '5 Old St', createdAt: new Date('2026-10-01') });
    await billing.settleChargesForAgent('newJoiner'); // called by acceptOfficeInvite before linking
    db._store.users.newJoiner.officeId = HPH;
    await billing.reconcileMissingCharges();
    expect(db._store.propertyCharges.pOld.billingEntityKey).toBe('agent:newJoiner');
  });

  it('settleChargesForAgent is idempotent', async () => {
    db.seed('properties', 'p1', { userId: 'phil', address: '1 Phil St', createdAt: new Date('2026-10-01') });
    await billing.settleChargesForAgent('phil');
    await billing.settleChargesForAgent('phil');
    expect(Object.keys(db._store.propertyCharges)).toHaveLength(1);
  });
});

describe('invoice runs — consolidation and approval gating', () => {
  async function seedCharges() {
    await billing.recordPropertyCharge(prop('p1', 'phil', '1 Phil St'));
    await billing.recordPropertyCharge(prop('p2', 'sam', '2 Sam St'));
    await billing.recordPropertyCharge(prop('p3', 'hphAdmin', '3 Ada St'));
    await billing.recordPropertyCharge(prop('p4', 'solo', '4 Solo St'));
  }

  it('HPH campaigns are held until the OFFICE billing contact is confirmed; an agent\'s own contact never releases them', async () => {
    await seedCharges();
    db.seed('billingContacts', 'agent:phil', { status: 'confirmed', email: 'phil@hph.test', name: 'Phil' });
    expect(await createInvoiceRunFromPendingCharges({ createdBy: 'admin' })).toBeNull(); // solo is also unconfirmed
    expect(Object.values(db._store.propertyCharges).every((c) => c.status === 'pending')).toBe(true);
  });

  it('once the office contact is confirmed: ONE HPH item, a $200 line per property, billed to the office contact — no per-agent items', async () => {
    await seedCharges();
    db.seed('billingContacts', `office:${HPH}`, { status: 'confirmed', billingName: 'Harcourts Property Hub', name: 'HPH Accounts', email: 'accounts@hph.test' });
    const result = await createInvoiceRunFromPendingCharges({ createdBy: 'admin' });

    expect(result).toMatchObject({ totalProperties: 3, totalAgencies: 1, totalAmountInc: 600 });
    const items = Object.values(db._store.invoiceRunItems);
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item).toMatchObject({
      billingEntityKey: `office:${HPH}`,
      billingEntityType: 'office',
      agencyName: 'Harcourts Property Hub',
      officeId: HPH,
      agentUserId: null,
      agentEmail: 'accounts@hph.test',
      propertyCount: 3,
      totalInc: 600,
    });
    expect(item.properties.map((p) => [p.address, p.totalInc, p.agentName])).toEqual([
      ['1 Phil St', 200, 'Phil Agent'],
      ['2 Sam St', 200, 'Sam Agent'],
      ['3 Ada St', 200, 'Ada Admin'],
    ]);
    // The independent agent's charge was NOT swept into the office invoice.
    expect(db._store.propertyCharges.p4.status).toBe('pending');
    // The office run is a draft: nothing reaches Xero until an admin approves (send route enforces).
    expect(Object.values(db._store.invoiceRuns)[0].status).toBe('draft');
  });

  it('mixed billing: office and independent agents with confirmed contacts produce two separate items', async () => {
    await seedCharges();
    db.seed('billingContacts', `office:${HPH}`, { status: 'confirmed', name: 'HPH Accounts', email: 'accounts@hph.test' });
    db.seed('billingContacts', 'agent:solo', { status: 'confirmed', name: 'Sol Solo', email: 'sol@solo.test' });
    await createInvoiceRunFromPendingCharges({ createdBy: 'admin' });
    const items = Object.values(db._store.invoiceRunItems);
    expect(items.map((i) => i.billingEntityKey).sort()).toEqual(['agent:solo', `office:${HPH}`]);
    expect(items.find((i) => i.billingEntityKey === 'agent:solo')).toMatchObject({ propertyCount: 1, totalInc: 200, billingEntityType: 'independent', agentUserId: 'solo' });
  });

  it('duplicate invoicing is impossible: queued and invoiced charges are never re-bundled', async () => {
    await seedCharges();
    db.seed('billingContacts', `office:${HPH}`, { status: 'confirmed', name: 'HPH Accounts', email: 'accounts@hph.test' });
    await createInvoiceRunFromPendingCharges({ createdBy: 'admin' });
    // Second run straight away: charges are 'queued', so nothing is picked up.
    expect(await createInvoiceRunFromPendingCharges({ createdBy: 'admin' })).toBeNull();
    // After sending, charges become invoiced and still aren't picked up.
    await billing.markChargesInvoiced(['p1', 'p2', 'p3']);
    expect(await createInvoiceRunFromPendingCharges({ createdBy: 'admin' })).toBeNull();
    expect(Object.keys(db._store.invoiceRuns)).toHaveLength(1);
  });

  it('a new campaign after the first office invoice goes onto the NEXT office invoice only', async () => {
    await seedCharges();
    db.seed('billingContacts', `office:${HPH}`, { status: 'confirmed', name: 'HPH Accounts', email: 'accounts@hph.test' });
    await createInvoiceRunFromPendingCharges({ createdBy: 'admin' });
    await billing.markChargesInvoiced(['p1', 'p2', 'p3']);
    await billing.recordPropertyCharge(prop('p5', 'phil', '5 Phil St'));
    const second = await createInvoiceRunFromPendingCharges({ createdBy: 'admin' });
    expect(second).toMatchObject({ totalProperties: 1, totalAmountInc: 200 });
  });
});

describe('office billing contact', () => {
  it('an admin can confirm the HPH office contact, recorded as an office-type contact', async () => {
    await billing.setBillingContact({ billingEntityKey: `office:${HPH}`, billingName: 'Harcourts Property Hub', name: 'HPH Accounts', email: 'accounts@hph.test', adminUid: 'admin' });
    expect(db._store.billingContacts[`office:${HPH}`]).toMatchObject({ status: 'confirmed', billingEntityType: 'office' });
    expect(await billing.resolveBillingContact(`office:${HPH}`)).toMatchObject({ email: 'accounts@hph.test' });
  });

  it('an independent agent\'s contact is still recorded as independent', async () => {
    await billing.setBillingContact({ billingEntityKey: 'agent:solo', name: 'Sol', email: 'sol@solo.test', adminUid: 'admin' });
    expect(db._store.billingContacts['agent:solo'].billingEntityType).toBe('independent');
  });
});

// ── Agent-facing billing routes ─────────────────────────────────────────
const mockVerifyIdToken = vi.fn();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: (...a) => mockVerifyIdToken(...a) }),
}));

const asUser = (uid) => {
  mockVerifyIdToken.mockResolvedValue({ uid, email: `${uid}@x.test` });
  return new Request('http://localhost/t', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ billingName: 'Harcourts Property Hub', contactName: 'HPH Accounts', contactEmail: 'accounts@hph.test' }),
  });
};

describe('agent billing routes with office accounts', () => {
  it('billing-contact-status: an ordinary office agent is told billing is the office\'s, and is never prompted', async () => {
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const res = await GET(asUser('phil'));
    expect(await res.json()).toEqual({ applicable: false, officeBilling: true, billingEntityName: 'Harcourts Property Hub' });
  });

  it('billing-contact-status: the office administrator sees the OFFICE billing record', async () => {
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    const body = await (await GET(asUser('hphAdmin'))).json();
    expect(body).toMatchObject({ applicable: true, billingEntityType: 'office', billingEntityName: 'Harcourts Property Hub', status: 'unset' });
  });

  it('billing-contact-status: independent agents are unchanged', async () => {
    const { GET } = await import('../../src/app/api/agency/billing-contact-status/route.js');
    expect(await (await GET(asUser('solo'))).json()).toMatchObject({ applicable: true, billingEntityName: 'Sol Solo', status: 'unset' });
  });

  it('propose: an ordinary office agent cannot submit billing details (403) and nothing is written', async () => {
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(asUser('phil'));
    expect(res.status).toBe(403);
    expect(db._store.billingContacts).toBeUndefined();
  });

  it('propose: the office administrator files the OFFICE proposal, which still needs admin approval', async () => {
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    const res = await POST(asUser('hphAdmin'));
    expect(res.status).toBe(200);
    expect(db._store.billingContacts[`office:${HPH}`]).toMatchObject({ status: 'pending', billingEntityType: 'office', proposedEmail: 'accounts@hph.test' });
    // Pending is not confirmed: charges stay held.
    expect(await billing.resolveBillingContact(`office:${HPH}`)).toBeNull();
  });

  it('propose: independent agents still file their own agent:{uid} proposal', async () => {
    const { POST } = await import('../../src/app/api/agency/propose-billing-contact/route.js');
    await POST(asUser('solo'));
    expect(db._store.billingContacts['agent:solo']).toMatchObject({ status: 'pending', billingEntityType: 'independent' });
  });
});
