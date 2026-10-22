import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { users: {}, offices: {}, officeAdminInfo: {}, officeImports: {}, officeAgentContacts: {}, officeInvites: {} };
const authState = { users: new Map() }; // email (lowercase) -> { uid, email }
let uidCounter = 0;

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
  return {
    doc: (id) => {
      const realId = id || `${name}-auto-${++uidCounter}`;
      return {
        id: realId,
        get: vi.fn().mockImplementation(async () => (
          state[name][realId] ? { exists: true, id: realId, data: () => state[name][realId] } : { exists: false }
        )),
        set: vi.fn().mockImplementation(async (data) => { state[name][realId] = data; }),
        update: vi.fn().mockImplementation(async (patch) => {
          state[name][realId] = { ...(state[name][realId] || {}) };
          for (const [key, value] of Object.entries(patch)) {
            if (value === 'DELETE_SENTINEL') delete state[name][realId][key];
            else state[name][realId][key] = value;
          }
        }),
      };
    },
    where: (field, op, value) =>
      makeQuery(name, [(data) => (op === '==' ? data[field] === value : true)]),
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (!['users', 'offices', 'officeAdminInfo', 'officeImports', 'officeAgentContacts', 'officeInvites'].includes(name)) {
        throw new Error(`Unexpected collection in test: ${name}`);
      }
      return makeCollection(name);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP', delete: () => 'DELETE_SENTINEL' },
}));

const sentEmails = [];
vi.mock('../../src/app/api/services/resendService', () => ({
  sendOfficeInviteEmail: vi.fn().mockImplementation(async (email, firstName, officeName, link) => {
    sentEmails.push({ type: 'activation', email, firstName, officeName, link });
  }),
  sendOfficeJoinInviteEmail: vi.fn().mockImplementation(async (email, firstName, officeName, link) => {
    sentEmails.push({ type: 'join-invite', email, firstName, officeName, link });
  }),
}));

const createUserMock = vi.fn();
const getUserByEmailMock = vi.fn();
const getUsersMock = vi.fn();
const generatePasswordResetLinkMock = vi.fn();

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    createUser: createUserMock,
    getUserByEmail: getUserByEmailMock,
    getUsers: getUsersMock,
    generatePasswordResetLink: generatePasswordResetLinkMock,
  }),
}));

function resetAll() {
  state.users = {};
  state.offices = {};
  state.officeAdminInfo = {};
  state.officeImports = {};
  state.officeAgentContacts = {};
  state.officeInvites = {};
  authState.users = new Map();
  sentEmails.length = 0;
  uidCounter = 0;

  createUserMock.mockReset().mockImplementation(async ({ email }) => {
    const uid = `auth-${++uidCounter}`;
    authState.users.set(email.toLowerCase(), { uid, email });
    return { uid };
  });
  getUserByEmailMock.mockReset().mockImplementation(async (email) => {
    const found = authState.users.get(email.toLowerCase());
    if (!found) {
      const err = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    }
    return found;
  });
  getUsersMock.mockReset().mockImplementation(async (identifiers) => {
    const users = identifiers
      .map((i) => authState.users.get(String(i.email || '').toLowerCase()))
      .filter(Boolean);
    return { users, notFound: [] };
  });
  generatePasswordResetLinkMock.mockReset().mockResolvedValue('https://premarket.homes/__/auth/action?mode=resetPassword&token=abc');
}

describe('parseCsv', () => {
  it('parses a simple 3-column CSV with no header', async () => {
    const { parseCsv } = await import('../../src/app/api/services/officeImportService');
    const rows = parseCsv('Jane Smith,jane@example.com,0412345678\nJohn Doe,john@example.com,0498765432');
    expect(rows).toEqual([
      { name: 'Jane Smith', email: 'jane@example.com', phone: '0412345678' },
      { name: 'John Doe', email: 'john@example.com', phone: '0498765432' },
    ]);
  });

  it('skips a header row when detected', async () => {
    const { parseCsv } = await import('../../src/app/api/services/officeImportService');
    const rows = parseCsv('Name,Email,Phone\nJane Smith,jane@example.com,0412345678');
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('jane@example.com');
  });

  it('handles quoted fields containing commas', async () => {
    const { parseCsv } = await import('../../src/app/api/services/officeImportService');
    const rows = parseCsv('"Smith, Jane",jane@example.com,0412345678');
    expect(rows[0].name).toBe('Smith, Jane');
  });

  it('skips blank lines and normalizes CRLF', async () => {
    const { parseCsv } = await import('../../src/app/api/services/officeImportService');
    const rows = parseCsv('Jane Smith,jane@example.com,0412345678\r\n\r\nJohn Doe,john@example.com,0498765432\r\n');
    expect(rows).toHaveLength(2);
  });

  it('lowercases/trims email', async () => {
    const { parseCsv } = await import('../../src/app/api/services/officeImportService');
    const rows = parseCsv('Jane Smith, JANE@EXAMPLE.COM ,0412345678');
    expect(rows[0].email).toBe('jane@example.com');
  });
});

describe('classifyImportRows', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('flags missing name/email/phone as invalid', async () => {
    const { classifyImportRows } = await import('../../src/app/api/services/officeImportService');
    const { rows } = await classifyImportRows({
      officeId: 'office1',
      rawRows: [
        { name: '', email: 'a@x.com', phone: '0412345678' },
        { name: 'Bob', email: 'not-an-email', phone: '0412345678' },
        { name: 'Bob', email: 'bob@x.com', phone: '123' },
      ],
    });
    expect(rows.every((r) => r.previewStatus === 'invalid')).toBe(true);
  });

  it('DUPLICATE DETECTION: flags the second occurrence of the same email within the CSV', async () => {
    const { classifyImportRows } = await import('../../src/app/api/services/officeImportService');
    const { rows, summary } = await classifyImportRows({
      officeId: 'office1',
      rawRows: [
        { name: 'Bob', email: 'bob@x.com', phone: '0412345678' },
        { name: 'Robert', email: 'BOB@x.com', phone: '0412345678' },
      ],
    });
    expect(rows[0].previewStatus).toBe('new');
    expect(rows[1].previewStatus).toBe('duplicate-in-csv');
    expect(summary['duplicate-in-csv']).toBe(1);
  });

  it('classifies a genuinely new email as new', async () => {
    const { classifyImportRows } = await import('../../src/app/api/services/officeImportService');
    const { rows } = await classifyImportRows({
      officeId: 'office1',
      rawRows: [{ name: 'Bob', email: 'new@x.com', phone: '0412345678' }],
    });
    expect(rows[0].previewStatus).toBe('new');
  });

  it('classifies an email that already has an Auth account but is NOT yet in this office as existing-account', async () => {
    authState.users.set('existing@x.com', { uid: 'uid-existing', email: 'existing@x.com' });
    state.users['uid-existing'] = { officeId: null };
    const { classifyImportRows } = await import('../../src/app/api/services/officeImportService');
    const { rows } = await classifyImportRows({
      officeId: 'office1',
      rawRows: [{ name: 'Bob', email: 'existing@x.com', phone: '0412345678' }],
    });
    expect(rows[0].previewStatus).toBe('existing-account');
  });

  it('classifies an email already a member of THIS office as already-active-member', async () => {
    authState.users.set('member@x.com', { uid: 'uid-member', email: 'member@x.com' });
    state.users['uid-member'] = { officeId: 'office1' };
    const { classifyImportRows } = await import('../../src/app/api/services/officeImportService');
    const { rows } = await classifyImportRows({
      officeId: 'office1',
      rawRows: [{ name: 'Bob', email: 'member@x.com', phone: '0412345678' }],
    });
    expect(rows[0].previewStatus).toBe('already-active-member');
  });

  it('writes nothing — preview only classifies, never creates accounts', async () => {
    const { classifyImportRows } = await import('../../src/app/api/services/officeImportService');
    await classifyImportRows({ officeId: 'office1', rawRows: [{ name: 'Bob', email: 'new@x.com', phone: '0412345678' }] });
    expect(createUserMock).not.toHaveBeenCalled();
    expect(state.users['new@x.com']).toBeUndefined();
  });
});

describe('processOneRow — new agent (brand-new Firebase Auth account)', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('creates a Firebase Auth user with NO password and a full Firestore profile', async () => {
    const { processOneRow } = await import('../../src/app/api/services/officeImportService');
    const result = await processOneRow({
      officeId: 'office1',
      officeName: 'Harcourts Property Hub',
      row: { name: 'Jane Smith', email: 'jane@x.com', phone: '0412345678' },
      actorUid: 'admin1',
    });

    expect(result.outcome).toBe('created');
    expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@x.com', disabled: false }));
    expect(createUserMock.mock.calls[0][0].password).toBeUndefined(); // NEVER sets a password

    const uid = result.uid;
    expect(state.users[uid].officeId).toBe('office1');
    expect(state.users[uid].accountStatus).toBe('invited');
    expect(state.users[uid].companyName).toBe('Harcourts Property Hub');
    expect(state.users[uid].agent).toBe(true);
    expect(state.users[uid].pro).toBe(true);
  });

  it('PRIVACY: the imported phone number is NEVER written onto the public users doc — only officeAgentContacts', async () => {
    const { processOneRow } = await import('../../src/app/api/services/officeImportService');
    const result = await processOneRow({
      officeId: 'office1', officeName: 'X',
      row: { name: 'Jane Smith', email: 'jane@x.com', phone: '0412345678' },
      actorUid: 'admin1',
    });
    const uid = result.uid;
    expect(state.users[uid].phone).toBeUndefined();
    expect(state.officeAgentContacts[uid].phone).toBe('0412345678');
    expect(state.officeAgentContacts[uid].officeId).toBe('office1');
  });

  it('NEVER creates a property or touches billing', async () => {
    const { processOneRow } = await import('../../src/app/api/services/officeImportService');
    const result = await processOneRow({
      officeId: 'office1', officeName: 'X',
      row: { name: 'Jane Smith', email: 'jane@x.com', phone: '0412345678' },
      actorUid: 'admin1',
    });
    expect(result.outcome).toBe('created');
    // The fake adminDb throws on any collection other than the five
    // registered above — properties/propertyCharges were never touched.
  });

  it('sends an activation email via a Firebase Admin SDK generatePasswordResetLink, never a plaintext password', async () => {
    const { processOneRow } = await import('../../src/app/api/services/officeImportService');
    await processOneRow({
      officeId: 'office1', officeName: 'X',
      row: { name: 'Jane Smith', email: 'jane@x.com', phone: '0412345678' },
      actorUid: 'admin1',
    });
    expect(generatePasswordResetLinkMock).toHaveBeenCalledWith('jane@x.com', expect.objectContaining({ url: expect.stringContaining('/login?activated=1') }));
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].type).toBe('activation');
    expect(sentEmails[0].link).not.toContain('password');
  });

  it('a Firebase Auth createUser failure is caught and returned as a failed outcome, not thrown', async () => {
    createUserMock.mockRejectedValueOnce(new Error('Simulated Auth failure'));
    const { processOneRow } = await import('../../src/app/api/services/officeImportService');
    const result = await processOneRow({
      officeId: 'office1', officeName: 'X',
      row: { name: 'Jane Smith', email: 'jane@x.com', phone: '0412345678' },
      actorUid: 'admin1',
    });
    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('Simulated Auth failure');
  });
});

describe('processOneRow — existing Premarket account (never silently transferred)', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('REQUIREMENT: an existing account is never silently linked to the office — officeId is untouched until accepted', async () => {
    authState.users.set('existing@x.com', { uid: 'uid-existing', email: 'existing@x.com' });
    state.users['uid-existing'] = { officeId: null, firstName: 'Bob' };

    const { processOneRow } = await import('../../src/app/api/services/officeImportService');
    const result = await processOneRow({
      officeId: 'office1', officeName: 'Harcourts Property Hub',
      row: { name: 'Bob Jones', email: 'existing@x.com', phone: '0412345678' },
      actorUid: 'admin1',
    });

    expect(result.outcome).toBe('invited-existing');
    expect(state.users['uid-existing'].officeId).toBeNull(); // STILL untouched
    expect(createUserMock).not.toHaveBeenCalled(); // never a second Auth account
    expect(state.officeInvites['office1_uid-existing'].status).toBe('pending');
    expect(sentEmails[0].type).toBe('join-invite');
  });

  it('an agent already a member of a DIFFERENT office is also never auto-transferred', async () => {
    authState.users.set('elsewhere@x.com', { uid: 'uid-elsewhere', email: 'elsewhere@x.com' });
    state.users['uid-elsewhere'] = { officeId: 'some-other-office' };

    const { processOneRow } = await import('../../src/app/api/services/officeImportService');
    const result = await processOneRow({
      officeId: 'office1', officeName: 'X',
      row: { name: 'Bob', email: 'elsewhere@x.com', phone: '0412345678' },
      actorUid: 'admin1',
    });

    expect(result.outcome).toBe('invited-existing');
    expect(state.users['uid-elsewhere'].officeId).toBe('some-other-office'); // unchanged
  });

  it('an agent already active in THIS office is skipped — a no-op', async () => {
    authState.users.set('member@x.com', { uid: 'uid-member', email: 'member@x.com' });
    state.users['uid-member'] = { officeId: 'office1', accountStatus: 'active' };

    const { processOneRow } = await import('../../src/app/api/services/officeImportService');
    const result = await processOneRow({
      officeId: 'office1', officeName: 'X',
      row: { name: 'Member', email: 'member@x.com', phone: '0412345678' },
      actorUid: 'admin1',
    });

    expect(result.outcome).toBe('skipped');
    expect(sentEmails).toHaveLength(0);
  });

  it('self-heals a half-finished prior attempt: already a member of THIS office but never activated gets re-sent an activation, not re-created', async () => {
    authState.users.set('halfdone@x.com', { uid: 'uid-halfdone', email: 'halfdone@x.com' });
    state.users['uid-halfdone'] = { officeId: 'office1', accountStatus: 'invited', firstName: 'Jo', email: 'halfdone@x.com' };

    const { processOneRow } = await import('../../src/app/api/services/officeImportService');
    const result = await processOneRow({
      officeId: 'office1', officeName: 'X',
      row: { name: 'Jo', email: 'halfdone@x.com', phone: '0412345678' },
      actorUid: 'admin1',
    });

    expect(result.outcome).toBe('created');
    expect(createUserMock).not.toHaveBeenCalled(); // never a second Auth account
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].type).toBe('activation');
  });
});

describe('acceptOfficeInvite', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('sets officeId only after the TARGETED agent accepts', async () => {
    state.officeInvites['office1_agentX'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com', status: 'pending',
    };
    state.users.agentX = {};

    const { acceptOfficeInvite } = await import('../../src/app/api/services/officeImportService');
    const result = await acceptOfficeInvite({ token: 'office1_agentX', acceptingUid: 'agentX' });

    expect(result.officeId).toBe('office1');
    expect(state.users.agentX.officeId).toBe('office1');
    expect(state.officeInvites['office1_agentX'].status).toBe('accepted');
  });

  it('SECURITY: rejects acceptance from a different uid than the invite targets', async () => {
    state.officeInvites['office1_agentX'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com', status: 'pending',
    };
    state.users.intruder = {};

    const { acceptOfficeInvite } = await import('../../src/app/api/services/officeImportService');
    await expect(acceptOfficeInvite({ token: 'office1_agentX', acceptingUid: 'intruder' }))
      .rejects.toMatchObject({ status: 403 });
    expect(state.users.intruder.officeId).toBeUndefined();
  });

  it('is idempotent — accepting an already-accepted invite is a safe no-op', async () => {
    state.officeInvites['office1_agentX'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com', status: 'accepted',
    };
    const { acceptOfficeInvite } = await import('../../src/app/api/services/officeImportService');
    const result = await acceptOfficeInvite({ token: 'office1_agentX', acceptingUid: 'agentX' });
    expect(result.alreadyAccepted).toBe(true);
  });

  it('rejects an unknown token', async () => {
    const { acceptOfficeInvite } = await import('../../src/app/api/services/officeImportService');
    await expect(acceptOfficeInvite({ token: 'does-not-exist', acceptingUid: 'agentX' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('REVOCATION: rejects acceptance of a revoked invite', async () => {
    state.officeInvites['office1_agentX'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com', status: 'revoked',
    };
    state.users.agentX = {};
    const { acceptOfficeInvite } = await import('../../src/app/api/services/officeImportService');
    await expect(acceptOfficeInvite({ token: 'office1_agentX', acceptingUid: 'agentX' }))
      .rejects.toMatchObject({ status: 410 });
    expect(state.users.agentX.officeId).toBeUndefined();
  });

  it('EXPIRY: rejects acceptance of an invite older than 7 days', async () => {
    const eightDaysAgo = { toMillis: () => Date.now() - 8 * 24 * 60 * 60 * 1000 };
    state.officeInvites['office1_agentX'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com',
      status: 'pending', createdAt: eightDaysAgo,
    };
    state.users.agentX = {};
    const { acceptOfficeInvite } = await import('../../src/app/api/services/officeImportService');
    await expect(acceptOfficeInvite({ token: 'office1_agentX', acceptingUid: 'agentX' }))
      .rejects.toMatchObject({ status: 410 });
    expect(state.users.agentX.officeId).toBeUndefined();
  });

  it('EXPIRY: a recent invite (within 7 days) is still accepted normally', async () => {
    const oneDayAgo = { toMillis: () => Date.now() - 24 * 60 * 60 * 1000 };
    state.officeInvites['office1_agentX'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com',
      status: 'pending', createdAt: oneDayAgo,
    };
    state.users.agentX = {};
    const { acceptOfficeInvite } = await import('../../src/app/api/services/officeImportService');
    const result = await acceptOfficeInvite({ token: 'office1_agentX', acceptingUid: 'agentX' });
    expect(result.alreadyAccepted).toBe(false);
    expect(state.users.agentX.officeId).toBe('office1');
  });

  it('a resend (fresh createdAt) un-expires a previously-old invite', async () => {
    const eightDaysAgo = { toMillis: () => Date.now() - 8 * 24 * 60 * 60 * 1000 };
    state.officeInvites['office1_agentX'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com',
      status: 'pending', createdAt: eightDaysAgo, createdBy: 'admin1',
    };
    const { resendInvitation, acceptOfficeInvite } = await import('../../src/app/api/services/officeImportService');
    await resendInvitation({ officeId: 'office1', targetUid: 'agentX' });

    state.users.agentX = {};
    const result = await acceptOfficeInvite({ token: 'office1_agentX', acceptingUid: 'agentX' });
    expect(result.alreadyAccepted).toBe(false);
  });
});

describe('getOfficeInviteByToken', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('reports expired: true for an old pending invite', async () => {
    const eightDaysAgo = { toMillis: () => Date.now() - 8 * 24 * 60 * 60 * 1000 };
    state.officeInvites['office1_agentX'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com',
      status: 'pending', createdAt: eightDaysAgo,
    };
    const { getOfficeInviteByToken } = await import('../../src/app/api/services/officeImportService');
    const invite = await getOfficeInviteByToken('office1_agentX');
    expect(invite.expired).toBe(true);
  });

  it('reports expired: false for a recent pending invite', async () => {
    const oneDayAgo = { toMillis: () => Date.now() - 24 * 60 * 60 * 1000 };
    state.officeInvites['office1_agentX'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agentX', targetEmail: 'x@x.com',
      status: 'pending', createdAt: oneDayAgo,
    };
    const { getOfficeInviteByToken } = await import('../../src/app/api/services/officeImportService');
    const invite = await getOfficeInviteByToken('office1_agentX');
    expect(invite.expired).toBe(false);
  });

  it('never reports expired: true for an already-accepted or revoked invite (status already explains it)', async () => {
    const eightDaysAgo = { toMillis: () => Date.now() - 8 * 24 * 60 * 60 * 1000 };
    state.officeInvites['office1_a'] = { officeName: 'X', status: 'accepted', createdAt: eightDaysAgo };
    state.officeInvites['office1_b'] = { officeName: 'X', status: 'revoked', createdAt: eightDaysAgo };
    const { getOfficeInviteByToken } = await import('../../src/app/api/services/officeImportService');
    expect((await getOfficeInviteByToken('office1_a')).expired).toBe(false);
    expect((await getOfficeInviteByToken('office1_b')).expired).toBe(false);
  });

  it('returns null for an unknown token', async () => {
    const { getOfficeInviteByToken } = await import('../../src/app/api/services/officeImportService');
    expect(await getOfficeInviteByToken('nope')).toBeNull();
  });
});

describe('commitImportBatch — retry safety', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('committing the same batch twice never creates a second Firebase Auth user', async () => {
    const { createImportBatch, commitImportBatch } = await import('../../src/app/api/services/officeImportService');
    state.officeAdminInfo.office1 = { name: 'Harcourts Property Hub' };

    const importId = await createImportBatch({
      officeId: 'office1',
      uploadedBy: 'admin1',
      rows: [{ rowIndex: 0, name: 'Jane Smith', email: 'jane@x.com', phone: '0412345678', previewStatus: 'new' }],
    });

    const first = await commitImportBatch({ importId, officeId: 'office1', actorUid: 'admin1' });
    expect(first.summary.created).toBe(1);
    expect(createUserMock).toHaveBeenCalledTimes(1);

    const second = await commitImportBatch({ importId, officeId: 'office1', actorUid: 'admin1' });
    expect(createUserMock).toHaveBeenCalledTimes(1); // still exactly once — retry did not duplicate
    expect(second.summary.created).toBe(1); // row stays recorded as created
  });

  it('ACCESS CONTROL: no amount of retrying/resending ever flips accountStatus to active, and no password is ever set — only a real login (markOfficeAccountActivated) can', async () => {
    const { createImportBatch, commitImportBatch, resendInvitation } = await import('../../src/app/api/services/officeImportService');
    state.officeAdminInfo.office1 = { name: 'X' };

    const importId = await createImportBatch({
      officeId: 'office1', uploadedBy: 'admin1',
      rows: [{ rowIndex: 0, name: 'Jane Smith', email: 'jane@x.com', phone: '0412345678', previewStatus: 'new' }],
    });

    await commitImportBatch({ importId, officeId: 'office1', actorUid: 'admin1' });
    const uid = Object.keys(state.users)[0];

    // Retry the exact same batch, then resend the invitation directly —
    // neither path ever touches accountStatus.
    await commitImportBatch({ importId, officeId: 'office1', actorUid: 'admin1' });
    await resendInvitation({ officeId: 'office1', targetUid: uid });

    expect(state.users[uid].accountStatus).toBe('invited'); // still invited — never auto-activated
    expect(createUserMock.mock.calls.every((call) => call[0].password === undefined)).toBe(true); // never a password, ever
  });

  it('a row that failed on the first attempt is retried on the second commit', async () => {
    createUserMock.mockRejectedValueOnce(new Error('transient failure'));
    const { createImportBatch, commitImportBatch } = await import('../../src/app/api/services/officeImportService');
    state.officeAdminInfo.office1 = { name: 'X' };

    const importId = await createImportBatch({
      officeId: 'office1',
      uploadedBy: 'admin1',
      rows: [{ rowIndex: 0, name: 'Jane Smith', email: 'jane@x.com', phone: '0412345678', previewStatus: 'new' }],
    });

    const first = await commitImportBatch({ importId, officeId: 'office1', actorUid: 'admin1' });
    expect(first.summary.failed).toBe(1);

    const second = await commitImportBatch({ importId, officeId: 'office1', actorUid: 'admin1' });
    expect(second.summary.created).toBe(1);
    expect(second.summary.failed).toBeUndefined();
  });

  it('never processes a batch belonging to a different office', async () => {
    const { createImportBatch, commitImportBatch } = await import('../../src/app/api/services/officeImportService');
    const importId = await createImportBatch({ officeId: 'office1', uploadedBy: 'admin1', rows: [] });
    await expect(commitImportBatch({ importId, officeId: 'office2', actorUid: 'intruder' }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('rows marked invalid/duplicate-in-csv/already-active-member at preview are skipped, never acted on', async () => {
    const { createImportBatch, commitImportBatch } = await import('../../src/app/api/services/officeImportService');
    state.officeAdminInfo.office1 = { name: 'X' };
    const importId = await createImportBatch({
      officeId: 'office1',
      uploadedBy: 'admin1',
      rows: [
        { rowIndex: 0, name: '', email: 'bad@x.com', phone: '123', previewStatus: 'invalid' },
        { rowIndex: 1, name: 'Dup', email: 'dup@x.com', phone: '0412345678', previewStatus: 'duplicate-in-csv' },
      ],
    });
    const result = await commitImportBatch({ importId, officeId: 'office1', actorUid: 'admin1' });
    expect(result.summary.skipped).toBe(2);
    expect(createUserMock).not.toHaveBeenCalled();
  });
});

describe('resendInvitation', () => {
  beforeEach(() => { vi.clearAllMocks(); resetAll(); });

  it('resends the Firebase activation link for a not-yet-activated member', async () => {
    state.officeAdminInfo.office1 = { name: 'X' };
    state.users.agent1 = { officeId: 'office1', accountStatus: 'invited', email: 'a@x.com', firstName: 'Jo' };
    const { resendInvitation } = await import('../../src/app/api/services/officeImportService');
    const result = await resendInvitation({ officeId: 'office1', targetUid: 'agent1' });
    expect(result.type).toBe('activation');
    expect(generatePasswordResetLinkMock).toHaveBeenCalled();
  });

  it('refuses to resend for an already-active member', async () => {
    state.users.agent1 = { officeId: 'office1', accountStatus: 'active' };
    const { resendInvitation } = await import('../../src/app/api/services/officeImportService');
    await expect(resendInvitation({ officeId: 'office1', targetUid: 'agent1' })).rejects.toMatchObject({ status: 400 });
  });

  it('resends the join-invite email for a pending existing-account invite', async () => {
    state.officeInvites['office1_agent2'] = {
      officeId: 'office1', officeName: 'X', targetUid: 'agent2', targetEmail: 'b@x.com', status: 'pending', createdBy: 'admin1',
    };
    const { resendInvitation } = await import('../../src/app/api/services/officeImportService');
    const result = await resendInvitation({ officeId: 'office1', targetUid: 'agent2' });
    expect(result.type).toBe('join-invite');
  });

  it('throws 404 when there is nothing to resend', async () => {
    const { resendInvitation } = await import('../../src/app/api/services/officeImportService');
    await expect(resendInvitation({ officeId: 'office1', targetUid: 'nobody' })).rejects.toMatchObject({ status: 404 });
  });
});
