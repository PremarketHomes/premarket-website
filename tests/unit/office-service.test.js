import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { users: {}, offices: {}, officeAdminInfo: {}, officeInvites: {}, officeJoinRequests: [] };

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
// brand-new offices — give each one a distinct, predictable id, and
// make the officeAdminInfo doc with the SAME id resolvable too (the
// real code calls adminDb.collection('offices').doc() once and reuses
// officeRef.id for the paired officeAdminInfo write).
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

const updateUserMock = vi.fn().mockResolvedValue(undefined);
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ updateUser: updateUserMock }),
}));

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'offices') return makeOfficesCollection();
      if (!['users', 'officeAdminInfo', 'officeJoinRequests', 'officeInvites'].includes(name)) {
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

/** Seeds an office split across its two real documents — tests read
 * back through getOfficeById/etc.'s merged shape, never state.offices
 * or state.officeAdminInfo directly, so they'd catch it if the merge
 * itself were ever wrong. */
function seedOffice(id, { name, officeAdminUids, agencyBrandId = null, status = 'active' }) {
  state.offices[id] = { agencyBrandId };
  state.officeAdminInfo[id] = { name, officeAdminUids, status, createdBy: officeAdminUids[0], createdAt: 'TIMESTAMP', updatedAt: 'TIMESTAMP' };
}

function resetState() {
  state.users = {};
  state.offices = {};
  state.officeAdminInfo = {};
  state.officeInvites = {};
  state.officeJoinRequests = [];
  autoIdCounter = 0;
  updateUserMock.mockClear();
}

describe('createOffice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('creates a new office and makes the caller its sole administrator', async () => {
    const { createOffice, getOfficeById } = await import('../../src/app/api/services/officeService');
    state.users.admin1 = { firstName: 'Phil' };

    const result = await createOffice({ adminUid: 'admin1', name: 'Harcourts Property Hub' });

    expect(result.status).toBe('created');
    const office = await getOfficeById(result.officeId);
    expect(office.name).toBe('Harcourts Property Hub');
    expect(office.officeAdminUids).toEqual(['admin1']);
    expect(state.users.admin1.officeId).toBe(result.officeId);
    expect(state.users.admin1.isOfficeAdmin).toBe(true);
    expect(state.users.admin1.accountStatus).toBe('active');
  });

  it('PRIVACY: the public offices doc holds ONLY agencyBrandId — name/officeAdminUids/createdBy never land there', async () => {
    const { createOffice } = await import('../../src/app/api/services/officeService');
    state.users.admin1 = {};
    const result = await createOffice({ adminUid: 'admin1', name: 'Harcourts Property Hub' });

    expect(Object.keys(state.offices[result.officeId])).toEqual(['agencyBrandId']);
    expect(state.officeAdminInfo[result.officeId].name).toBe('Harcourts Property Hub');
    expect(state.officeAdminInfo[result.officeId].officeAdminUids).toEqual(['admin1']);
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
    expect(Object.keys(state.officeAdminInfo)).toHaveLength(1); // never a second office
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
    expect(Object.keys(state.officeAdminInfo)).toHaveLength(2);
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
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    const office = await requireOfficeAdmin({ officeId: 'office1', uid: 'admin1' });
    expect(office.name).toBe('X');
  });

  it('SECURITY: rejects a non-administrator of this office', async () => {
    const { requireOfficeAdmin } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    await expect(requireOfficeAdmin({ officeId: 'office1', uid: 'rando' })).rejects.toMatchObject({ status: 403 });
  });

  it('SECURITY: an administrator of a DIFFERENT office cannot administer this one', async () => {
    const { requireOfficeAdmin } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    seedOffice('office2', { name: 'Y', officeAdminUids: ['admin2'] });
    await expect(requireOfficeAdmin({ officeId: 'office1', uid: 'admin2' })).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a nonexistent office', async () => {
    const { requireOfficeAdmin } = await import('../../src/app/api/services/officeService');
    await expect(requireOfficeAdmin({ officeId: 'nope', uid: 'admin1' })).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an office whose public doc exists but has no paired officeAdminInfo (half-written/corrupt state)', async () => {
    const { requireOfficeAdmin } = await import('../../src/app/api/services/officeService');
    state.offices.office1 = { agencyBrandId: null }; // no officeAdminInfo written
    await expect(requireOfficeAdmin({ officeId: 'office1', uid: 'admin1' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('removeAgentFromOffice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('clears the target\'s officeId and never touches properties/billing fields', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.agent1 = { officeId: 'office1', accountStatus: 'active', firstName: 'Jo', companyName: 'X' };

    await removeAgentFromOffice({ officeId: 'office1', targetUid: 'agent1', actorUid: 'admin1' });

    expect(state.users.agent1.officeId).toBeUndefined();
    expect(state.users.agent1.firstName).toBe('Jo'); // untouched
    expect(state.users.agent1.companyName).toBe('X'); // untouched — billing/properties never keyed off this
  });

  it('also drops a removed agent from officeAdminUids if they were an admin', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1', 'admin2'] });
    state.users.admin2 = { officeId: 'office1', accountStatus: 'active', isOfficeAdmin: true };

    await removeAgentFromOffice({ officeId: 'office1', targetUid: 'admin2', actorUid: 'admin1' });

    expect(state.officeAdminInfo.office1.officeAdminUids).toEqual(['admin1']);
    expect(state.users.admin2.officeId).toBeUndefined();
    expect(state.users.admin2.isOfficeAdmin).toBeUndefined();
  });

  it('SAFETY: refuses to remove the only remaining office administrator', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.admin1 = { officeId: 'office1', accountStatus: 'active', isOfficeAdmin: true };

    await expect(removeAgentFromOffice({ officeId: 'office1', targetUid: 'admin1', actorUid: 'admin1' }))
      .rejects.toMatchObject({ status: 400 });
    expect(state.officeAdminInfo.office1.officeAdminUids).toEqual(['admin1']); // unchanged
  });

  it('SECURITY: a non-admin cannot remove anyone', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.agent1 = { officeId: 'office1' };
    await expect(removeAgentFromOffice({ officeId: 'office1', targetUid: 'agent1', actorUid: 'intruder' }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('rejects removing someone who is not actually a member of this office and has no pending invite either', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.agent1 = { officeId: 'some-other-office' };
    await expect(removeAgentFromOffice({ officeId: 'office1', targetUid: 'agent1', actorUid: 'admin1' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('REVOCATION: disables the Firebase Auth account of a never-activated (accountStatus: invited) agent on removal', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.agent1 = { officeId: 'office1', accountStatus: 'invited' };

    const result = await removeAgentFromOffice({ officeId: 'office1', targetUid: 'agent1', actorUid: 'admin1' });

    expect(result.disabledAccount).toBe(true);
    expect(updateUserMock).toHaveBeenCalledWith('agent1', { disabled: true });
  });

  it('never disables the Auth account of an already-ACTIVE member on removal', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.agent1 = { officeId: 'office1', accountStatus: 'active' };

    const result = await removeAgentFromOffice({ officeId: 'office1', targetUid: 'agent1', actorUid: 'admin1' });

    expect(result.disabledAccount).toBe(false);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('REVOCATION: revokes a pending existing-account invite instead of erroring, when the target is not yet a real member', async () => {
    const { removeAgentFromOffice } = await import('../../src/app/api/services/officeService');
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.officeInvites['office1_agent2'] = { officeId: 'office1', targetUid: 'agent2', status: 'pending' };

    const result = await removeAgentFromOffice({ officeId: 'office1', targetUid: 'agent2', actorUid: 'admin1' });

    expect(result.revokedInvite).toBe(true);
    expect(state.officeInvites['office1_agent2'].status).toBe('revoked');
    expect(updateUserMock).not.toHaveBeenCalled(); // they were never a real account tie-in here
  });
});

describe('markOfficeAccountActivated', () => {
  beforeEach(() => { vi.clearAllMocks(); resetState(); });

  it('flips accountStatus from invited to active', async () => {
    const { markOfficeAccountActivated } = await import('../../src/app/api/services/officeService');
    state.users.agent1 = { accountStatus: 'invited' };
    const result = await markOfficeAccountActivated('agent1');
    expect(result.activated).toBe(true);
    expect(state.users.agent1.accountStatus).toBe('active');
    expect(state.users.agent1.activatedAt).toBe('TIMESTAMP');
  });

  it('is a safe no-op for an ordinary individual agent (no accountStatus at all)', async () => {
    const { markOfficeAccountActivated } = await import('../../src/app/api/services/officeService');
    state.users.agent1 = { firstName: 'Jo' };
    const result = await markOfficeAccountActivated('agent1');
    expect(result.activated).toBe(false);
    expect(state.users.agent1.accountStatus).toBeUndefined();
  });

  it('is a safe no-op for an already-active office account', async () => {
    const { markOfficeAccountActivated } = await import('../../src/app/api/services/officeService');
    state.users.agent1 = { accountStatus: 'active', activatedAt: 'OLD' };
    const result = await markOfficeAccountActivated('agent1');
    expect(result.activated).toBe(false);
    expect(state.users.agent1.activatedAt).toBe('OLD'); // untouched, never re-stamped
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
    seedOffice('office1', { name: 'X', officeAdminUids: ['admin1'] });
    state.users.admin1 = { officeId: 'office1' };
    state.users.member1 = { officeId: 'office1' };

    expect((await getOfficeForUser('admin1')).isOfficeAdmin).toBe(true);
    expect((await getOfficeForUser('member1')).isOfficeAdmin).toBe(false);
  });

  it('merges real members with pending existing-account invites, and computes counts', async () => {
    const { listOfficeAgents, computeOfficeStats } = await import('../../src/app/api/services/officeService');
    state.users.agent1 = { officeId: 'office1', firstName: 'Jo', email: 'jo@x.com', accountStatus: 'active' };
    state.users.agent2 = { officeId: 'office1', firstName: 'Sam', email: 'sam@x.com', accountStatus: 'invited' };
    state.officeInvites.office1_agent3 = {
      officeId: 'office1', targetUid: 'agent3', targetEmail: 'pending@x.com', status: 'pending', createdAt: 'TIMESTAMP',
    };

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

  it('never surfaces a REVOKED invite in the roster (only pending ones)', async () => {
    const { listOfficeAgents } = await import('../../src/app/api/services/officeService');
    state.officeInvites.office1_agent4 = {
      officeId: 'office1', targetUid: 'agent4', targetEmail: 'x@x.com', status: 'revoked',
    };
    const agents = await listOfficeAgents('office1');
    expect(agents.find((a) => a.uid === 'agent4')).toBeUndefined();
  });
});
