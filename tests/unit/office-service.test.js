import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { users: {}, offices: {}, officeInvites: {}, officeJoinRequests: [] };

function makeQuery(name, filters) {
  return {
    where: (field, op, value) =>
      makeQuery(name, [...filters, (data) => (op === '==' ? data[field] === value : true)]),
    get: vi.fn().mockImplementation(async () => {
      const docs = Object.entries(state[name])
        .filter(([, data]) => filters.every((f) => f(data)))
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs };
    }),
  };
}

function makeCollection(name) {
  if (name === 'officeJoinRequests') {
    return {
      add: vi.fn().mockImplementation(async (data) => {
        state.officeJoinRequests.push(data);
        return { id: `req-${state.officeJoinRequests.length}` };
      }),
    };
  }
  return {
    doc: (id) => ({
      id,
      get: vi.fn().mockImplementation(async () => (
        state[name][id] ? { exists: true, id, data: () => state[name][id] } : { exists: false }
      )),
      set: vi.fn().mockImplementation(async (data) => { state[name][id] = data; }),
      update: vi.fn().mockImplementation(async (patch) => {
        state[name][id] = { ...(state[name][id] || {}) };
        for (const [key, value] of Object.entries(patch)) {
          if (value === 'DELETE_SENTINEL') delete state[name][id][key];
          else if (value && value.__arrayRemove) {
            state[name][id][key] = (state[name][id][key] || []).filter((v) => v !== value.__arrayRemove);
          } else state[name][id][key] = value;
        }
      }),
    }),
    where: (field, op, value) =>
      makeQuery(name, [(data) => (op === '==' ? data[field] === value : true)]),
  };
}

// officeService.js uses a Firestore auto-ID doc() call (no arg) for
// brand-new offices — give each one a distinct, predictable id.
let autoIdCounter = 0;
function makeOfficesCollection() {
  const base = makeCollection('offices');
  return {
    ...base,
    doc: (id) => {
      const realId = id || `office-auto-${++autoIdCounter}`;
      return base.doc(realId);
    },
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'offices') return makeOfficesCollection();
      if (!['users', 'officeJoinRequests', 'officeInvites'].includes(name)) {
        throw new Error(`Unexpected collection in test: ${name}`);
      }
      return makeCollection(name);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'TIMESTAMP',
    delete: () => 'DELETE_SENTINEL',
    arrayRemove: (v) => ({ __arrayRemove: v }),
  },
}));

function resetState() {
  state.users = {};
  state.offices = {};
  state.officeInvites = {};
  state.officeJoinRequests = [];
  autoIdCounter = 0;
}

describe('createOffice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('creates a new office and makes the caller its sole administrator', async () => {
    const { createOffice } = await import('../../src/app/api/services/officeService');
    state.users.admin1 = { firstName: 'Phil' };

    const result = await createOffice({ adminUid: 'admin1', name: 'Harcourts Property Hub' });

    expect(result.status).toBe('created');
    expect(state.offices[result.officeId].name).toBe('Harcourts Property Hub');
    expect(state.offices[result.officeId].officeAdminUids).toEqual(['admin1']);
    expect(state.users.admin1.officeId).toBe(result.officeId);
    expect(state.users.admin1.isOfficeAdmin).toBe(true);
    expect(state.users.admin1.accountStatus).toBe('active');
  });

  it('never sets superAdmin on the registering account', async () => {
    const { createOffice } = await import('../../src/app/api/services/officeService');
    state.users.admin1 = {};
    await createOffice({ adminUid: 'admin1', name: 'A New Office' });
    expect(state.users.admin1.superAdmin).toBeUndefined();
  });

  it('SECURITY: an exact-name collision never creates a duplicate office or grants membership — files a join request instead', async () => {
    const { createOffice } = await import('../../src/app/api/services/officeService');
    state.users.admin1 = {};
    state.users.admin2 = {};

    const first = await createOffice({ adminUid: 'admin1', name: 'Harcourts Property Hub' });
    const second = await createOffice({ adminUid: 'admin2', name: 'harcourts   property hub' });

    expect(second.status).toBe('exists');
    expect(second.officeId).toBe(first.officeId);
    expect(Object.keys(state.offices)).toHaveLength(1); // never a second office
    expect(state.users.admin2.officeId).toBeUndefined(); // never silently granted membership
    expect(state.officeJoinRequests).toHaveLength(1);
    expect(state.officeJoinRequests[0].requestedByUid).toBe('admin2');
  });

  it('a different, non-colliding office name still creates successfully', async () => {
    const { createOffice } = await import('../../src/app/api/services/officeService');
    state.users.admin1 = {};
    state.users.admin2 = {};
    await createOffice({ adminUid: 'admin1', name: 'Harcourts Property Hub' });
    const second = await createOffice({ adminUid: 'admin2', name: 'Ray White Brisbane' });
    expect(second.status).toBe('created');
    expect(Object.keys(state.offices)).toHaveLength(2);
  });

  it('rejects an empty office name', async () => {
    const { createOffice } = await import('../../src/app/api/services/officeService');
    await expect(createOffice({ adminUid: 'admin1', name: '   ' })).rejects.toThrow();
  });
});

describe('requireOfficeAdmin / isOfficeAdminUid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('allows an office\'s own administrator', async () => {
    const { requireOfficeAdmin } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { name: 'X', officeAdminUids: ['admin1'] };
    const office = await requireOfficeAdmin({ officeId: 'office1', uid: 'admin1' });
    expect(office.name).toBe('X');
  });

  it('SECURITY: rejects a non-administrator of this office', async () => {
    const { requireOfficeAdmin } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { name: 'X', officeAdminUids: ['admin1'] };
    await expect(requireOfficeAdmin({ officeId: 'office1', uid: 'rando' })).rejects.toMatchObject({ status: 403 });
  });

  it('SECURITY: an administrator of a DIFFERENT office cannot administer this one', async () => {
    const { requireOfficeAdmin } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { name: 'X', officeAdminUids: ['admin1'] };
    state.offices.office2 = { name: 'Y', officeAdminUids: ['admin2'] };
    await expect(requireOfficeAdmin({ officeId: 'office1', uid: 'admin2' })).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a nonexistent office', async () => {
    const { requireOfficeAdmin } = await import('../../src/app/api/services/officeService');
    await expect(requireOfficeAdmin({ officeId: 'nope', uid: 'admin1' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('removeAgentFromOffice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('clears the target\'s officeId and never touches properties/billing fields', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { name: 'X', officeAdminUids: ['admin1'] };
    state.users.agent1 = { officeId: 'office1', firstName: 'Jo', companyName: 'X' };

    await removeAgentFromOffice({ officeId: 'office1', targetUid: 'agent1', actorUid: 'admin1' });

    expect(state.users.agent1.officeId).toBeUndefined();
    expect(state.users.agent1.firstName).toBe('Jo'); // untouched
    expect(state.users.agent1.companyName).toBe('X'); // untouched — billing/properties never keyed off this
  });

  it('also drops a removed agent from officeAdminUids if they were an admin', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { name: 'X', officeAdminUids: ['admin1', 'admin2'] };
    state.users.admin2 = { officeId: 'office1', isOfficeAdmin: true };

    await removeAgentFromOffice({ officeId: 'office1', targetUid: 'admin2', actorUid: 'admin1' });

    expect(state.offices.office1.officeAdminUids).toEqual(['admin1']);
    expect(state.users.admin2.officeId).toBeUndefined();
    expect(state.users.admin2.isOfficeAdmin).toBeUndefined();
  });

  it('SAFETY: refuses to remove the only remaining office administrator', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { name: 'X', officeAdminUids: ['admin1'] };
    state.users.admin1 = { officeId: 'office1', isOfficeAdmin: true };

    await expect(removeAgentFromOffice({ officeId: 'office1', targetUid: 'admin1', actorUid: 'admin1' }))
      .rejects.toMatchObject({ status: 400 });
    expect(state.offices.office1.officeAdminUids).toEqual(['admin1']); // unchanged
  });

  it('SECURITY: a non-admin cannot remove anyone', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { name: 'X', officeAdminUids: ['admin1'] };
    state.users.agent1 = { officeId: 'office1' };
    await expect(removeAgentFromOffice({ officeId: 'office1', targetUid: 'agent1', actorUid: 'intruder' }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('rejects removing someone who is not actually a member of this office', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { name: 'X', officeAdminUids: ['admin1'] };
    state.users.agent1 = { officeId: 'some-other-office' };
    await expect(removeAgentFromOffice({ officeId: 'office1', targetUid: 'agent1', actorUid: 'admin1' }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('getOfficeForUser / listOfficeAgents / computeOfficeStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('returns null for an agent with no office', async () => {
    const { getOfficeForUser } = await import('../../src/app/api/services/officeService');
    state.users.agent1 = {};
    expect(await getOfficeForUser('agent1')).toBeNull();
  });

  it('reports isOfficeAdmin correctly for an admin vs an ordinary member', async () => {
    const { getOfficeForUser } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { name: 'X', officeAdminUids: ['admin1'] };
    state.users.admin1 = { officeId: 'office1' };
    state.users.member1 = { officeId: 'office1' };

    expect((await getOfficeForUser('admin1')).isOfficeAdmin).toBe(true);
    expect((await getOfficeForUser('member1')).isOfficeAdmin).toBe(false);
  });

  it('merges real members with pending existing-account invites, and computes counts', async () => {
    const { listOfficeAgents, computeOfficeStats } = await import('../../src/app/api/services/officeService');
    state.users.agent1 = { officeId: 'office1', firstName: 'Jo', email: 'jo@x.com', accountStatus: 'active' };
    state.users.agent2 = { officeId: 'office1', firstName: 'Sam', email: 'sam@x.com', accountStatus: 'invited' };

    const adminApp = await import('../../src/app/firebase/adminApp');
    await adminApp.adminDb.collection('officeInvites').doc('office1_agent3').set({
      officeId: 'office1',
      targetUid: 'agent3',
      targetEmail: 'pending@x.com',
      status: 'pending',
      createdAt: 'TIMESTAMP',
    });

    const agents = await listOfficeAgents('office1');
    expect(agents).toHaveLength(3);
    const byUid = Object.fromEntries(agents.map((a) => [a.uid, a]));
    expect(byUid.agent1.status).toBe('active');
    expect(byUid.agent2.status).toBe('invited');
    expect(byUid.agent3.status).toBe('pending-acceptance');
    expect(byUid.agent3.email).toBe('pending@x.com');

    const stats = computeOfficeStats(agents);
    expect(stats).toEqual({ total: 3, active: 1, invited: 1, pendingAcceptance: 1 });
  });
});
