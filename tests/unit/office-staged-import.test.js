import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { users: {}, officeAdminInfo: {}, officeImports: {}, officeAgentContacts: {}, officeInvites: {}, officeActivations: {}, offices: {} };
const authState = { users: new Map() };
let uidCounter = 0;

function makeQuery(name, filters) {
  return {
    where: (field, op, value) => makeQuery(name, [...filters, (d) => d[field] === value]),
    get: vi.fn().mockImplementation(async () => ({
      docs: Object.entries(state[name]).filter(([, d]) => filters.every((f) => f(d))).map(([id, d]) => ({ id, data: () => d })),
    })),
  };
}
function makeCollection(name) {
  return {
    doc: (id) => {
      const realId = id || `${name}-auto-${++uidCounter}`;
      return {
        id: realId,
        get: vi.fn().mockImplementation(async () => (state[name][realId] ? { exists: true, id: realId, data: () => state[name][realId] } : { exists: false })),
        set: vi.fn().mockImplementation(async (data) => { state[name][realId] = data; }),
        update: vi.fn().mockImplementation(async (patch) => { state[name][realId] = { ...state[name][realId], ...patch }; }),
      };
    },
    where: (field, op, value) => makeQuery(name, [(d) => d[field] === value]),
  };
}

// Transactions are serialised (like Firestore's isolation outcome) so the claim logic is exercised realistically.
let txChain = Promise.resolve();
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    runTransaction: (fn) => {
      const run = txChain.then(async () => {
        const writes = [];
        const tx = { get: (ref) => ref.get(), update: (ref, patch) => { writes.push(() => ref.update(patch)); } };
        const result = await fn(tx);
        for (const w of writes) await w();
        return result;
      });
      txChain = run.catch(() => {});
      return run;
    },
    collection: (name) => { if (!state[name]) throw new Error(`Unexpected collection: ${name}`); return makeCollection(name); },
  },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));

const sentEmails = [];
let failEmailFor = new Set();
vi.mock('../../src/app/api/services/resendService', () => ({
  sendOfficeInviteEmail: vi.fn(async (email, firstName, officeName, link) => {
    if (failEmailFor.has(email)) throw new Error('smtp down');
    sentEmails.push({ type: 'activation', email, link });
  }),
  sendOfficeJoinInviteEmail: vi.fn(async (email, firstName, officeName, link) => {
    if (failEmailFor.has(email)) throw new Error('smtp down');
    sentEmails.push({ type: 'join-invite', email, link });
  }),
}));

const createUserMock = vi.fn();
const getUserMock = vi.fn();
const resetLinkMock = vi.fn();
let failCreateFor = new Set();
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    createUser: createUserMock,
    getUserByEmail: async (email) => { const u = authState.users.get(email.toLowerCase()); if (!u) { const e = new Error('nf'); e.code = 'auth/user-not-found'; throw e; } return u; },
    getUsers: async (ids) => ({ users: ids.map((i) => authState.users.get(String(i.email).toLowerCase())).filter(Boolean), notFound: [] }),
    getUser: getUserMock,
    generatePasswordResetLink: resetLinkMock,
  }),
}));

const OFFICE = 'office1';
function reset() {
  for (const k of Object.keys(state)) state[k] = {};
  state.officeAdminInfo[OFFICE] = { name: 'Harcourts Property Hub', officeAdminUids: ['admin1'], status: 'active' };
  authState.users = new Map();
  sentEmails.length = 0;
  failEmailFor = new Set();
  failCreateFor = new Set();
  uidCounter = 0;
  txChain = Promise.resolve();
  createUserMock.mockReset().mockImplementation(async ({ email }) => {
    if (failCreateFor.has(email)) throw new Error('auth outage');
    const uid = `new-${++uidCounter}`;
    authState.users.set(email.toLowerCase(), { uid, email });
    return { uid };
  });
  getUserMock.mockReset().mockImplementation(async (uid) => ({ uid, email: `${uid}@x.com`, disabled: false }));
  resetLinkMock.mockReset().mockResolvedValue('https://firebase.example/__/auth/action?mode=resetPassword&oobCode=fresh&apiKey=k');
}
const svc = () => import('../../src/app/api/services/officeImportService');
const act = () => import('../../src/app/api/services/officeActivationService');
const addAuthUser = (email, uid, data = {}) => { authState.users.set(email, { uid, email }); state.users[uid] = { email, ...data }; };

describe('classification — duplicates and existing members are never invited unnecessarily', () => {
  beforeEach(reset);

  it('labels every kind of row correctly', async () => {
    addAuthUser('active@x.com', 'u-active', { officeId: OFFICE, accountStatus: 'active' });
    addAuthUser('invited@x.com', 'u-invited', { officeId: OFFICE, accountStatus: 'invited' });
    addAuthUser('other@x.com', 'u-other', { officeId: 'some-other-office' });
    addAuthUser('solo@x.com', 'u-solo', {}); // existing independent account
    addAuthUser('pending@x.com', 'u-pending', {});
    state.officeInvites[`${OFFICE}_u-pending`] = { officeId: OFFICE, targetUid: 'u-pending', status: 'pending' };
    const { classifyImportRows } = await svc();
    const { rows, summary } = await classifyImportRows({
      officeId: OFFICE,
      rawRows: [
        { name: 'A', email: 'brand-new@x.com', phone: '0412345678' },
        { name: 'B', email: 'ACTIVE@x.com', phone: '0412345678' },
        { name: 'C', email: 'invited@x.com', phone: '0412345678' },
        { name: 'D', email: 'other@x.com', phone: '0412345678' },
        { name: 'E', email: 'solo@x.com', phone: '0412345678' },
        { name: 'F', email: 'pending@x.com', phone: '0412345678' },
        { name: 'G', email: 'brand-new@x.com', phone: '0412345678' },
        { name: '', email: 'noname@x.com', phone: '0412345678' },
        { name: 'H', email: 'not-an-email', phone: '0412345678' },
        { name: 'I', email: 'i@x.com', phone: '12' },
      ],
    });
    expect(rows.map((r) => r.previewStatus)).toEqual([
      'new', 'already-active-member', 'already-invited', 'in-other-office', 'existing-account', 'already-invited',
      'duplicate-in-csv', 'invalid', 'invalid', 'invalid',
    ]);
    expect(summary).toMatchObject({ new: 1, 'existing-account': 1, 'in-other-office': 1, 'already-invited': 2, 'duplicate-in-csv': 1, invalid: 3 });
  });

  it('an email already waiting in another staged batch is flagged already-staged', async () => {
    const { classifyImportRows, createImportBatch, stageImportBatch } = await svc();
    const first = await classifyImportRows({ officeId: OFFICE, rawRows: [{ name: 'A', email: 'a@x.com', phone: '0412345678' }] });
    const id = await createImportBatch({ officeId: OFFICE, uploadedBy: 'admin1', rows: first.rows });
    await stageImportBatch({ importId: id, officeId: OFFICE });
    const second = await classifyImportRows({ officeId: OFFICE, rawRows: [{ name: 'A', email: 'a@x.com', phone: '0412345678' }] });
    expect(second.rows[0].previewStatus).toBe('already-staged');
  });
});

describe('staging sends nothing and creates nothing', () => {
  beforeEach(reset);

  async function stage(rawRows) {
    const { classifyImportRows, createImportBatch, stageImportBatch } = await svc();
    const { rows } = await classifyImportRows({ officeId: OFFICE, rawRows });
    const importId = await createImportBatch({ officeId: OFFICE, uploadedBy: 'admin1', rows });
    const r = await stageImportBatch({ importId, officeId: OFFICE });
    return { importId, ...r };
  }
  const people = (n, prefix = 'p') => Array.from({ length: n }, (_, i) => ({ name: `Person ${i}`, email: `${prefix}${i}@x.com`, phone: '0412345678' }));

  it('staging creates no accounts, no invitations and sends no email; staged agents show as staged without phone numbers', async () => {
    addAuthUser('solo@x.com', 'u-solo', {});
    const { staged } = await stage([...people(3), { name: 'Solo', email: 'solo@x.com', phone: '0499999999' }]);
    expect(staged).toBe(4);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(sentEmails).toHaveLength(0);
    expect(Object.keys(state.officeInvites)).toHaveLength(0);
    expect(Object.keys(state.officeActivations)).toHaveLength(0);
    const { listStagedAgents } = await svc();
    const list = await listStagedAgents(OFFICE);
    expect(list).toHaveLength(4);
    expect(list.every((a) => a.status === 'staged' && a.uid === null)).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/0412345678|0499999999/);
  });

  it('refuses to stage another office\'s batch, or a batch with nothing eligible', async () => {
    const { classifyImportRows, createImportBatch, stageImportBatch } = await svc();
    const { rows } = await classifyImportRows({ officeId: OFFICE, rawRows: [{ name: '', email: 'x', phone: '' }] });
    const id = await createImportBatch({ officeId: OFFICE, uploadedBy: 'admin1', rows });
    await expect(stageImportBatch({ importId: id, officeId: OFFICE })).rejects.toMatchObject({ status: 400 });
    await expect(stageImportBatch({ importId: id, officeId: 'other' })).rejects.toMatchObject({ status: 403 });
  });

  it('SEND ALL: 50 agents (mixed new + existing) are each invited exactly once, in short chunks', async () => {
    for (let i = 0; i < 15; i++) addAuthUser(`exist${i}@x.com`, `u-exist${i}`, {});
    const raw = [...people(35), ...Array.from({ length: 15 }, (_, i) => ({ name: `Ex ${i}`, email: `exist${i}@x.com`, phone: '0412345678' }))];
    await stage(raw);
    const { sendStagedChunk, listStagedAgents } = await svc();

    let calls = 0; let remaining = 50; const per = [];
    while (remaining > 0 && calls < 20) {
      const r = await sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1', mode: 'new' });
      per.push(r.processed); remaining = r.remaining; calls++;
    }
    expect(remaining).toBe(0);
    expect(Math.max(...per)).toBeLessThanOrEqual(10);
    expect(sentEmails).toHaveLength(50);
    expect(new Set(sentEmails.map((e) => e.email)).size).toBe(50); // no one emailed twice
    expect(sentEmails.filter((e) => e.type === 'activation')).toHaveLength(35);
    expect(sentEmails.filter((e) => e.type === 'join-invite')).toHaveLength(15);
    expect(createUserMock).toHaveBeenCalledTimes(35); // existing accounts are NEVER recreated
    expect(await listStagedAgents(OFFICE)).toHaveLength(0);

    // pressing the button again does nothing
    const again = await sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1', mode: 'new' });
    expect(again).toMatchObject({ processed: 0, remaining: 0 });
    expect(sentEmails).toHaveLength(50);
  });

  it('two overlapping sends can never email the same agent twice', async () => {
    await stage(people(20));
    const { sendStagedChunk } = await svc();
    await Promise.all([
      sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1', mode: 'new', maxRows: 10 }),
      sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1', mode: 'new', maxRows: 10 }),
      sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1', mode: 'new', maxRows: 10 }),
    ]);
    expect(new Set(sentEmails.map((e) => e.email)).size).toBe(sentEmails.length);
    expect(sentEmails).toHaveLength(20);
  });

  it('PARTIAL FAILURE: failed rows are retried on demand; successful ones are never resent', async () => {
    await stage(people(6));
    failCreateFor = new Set(['p1@x.com']);       // account creation fails
    failEmailFor = new Set(['p3@x.com']);        // account created but email fails
    const { sendStagedChunk, listStagedAgents } = await svc();

    const first = await sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1', mode: 'new', maxRows: 50 });
    expect(first).toMatchObject({ processed: 6, sent: 4, failed: 2 });
    expect(sentEmails.map((e) => e.email).sort()).toEqual(['p0@x.com', 'p2@x.com', 'p4@x.com', 'p5@x.com']);
    const failedList = await listStagedAgents(OFFICE);
    expect(failedList.map((a) => [a.email, a.status]).sort()).toEqual([['p1@x.com', 'send-failed'], ['p3@x.com', 'send-failed']]);

    // "Send All" does NOT touch failed rows
    const notRetry = await sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1', mode: 'new' });
    expect(notRetry.processed).toBe(0);

    // outages over -> retry sends only the two that failed
    failCreateFor = new Set(); failEmailFor = new Set();
    const retry = await sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1', mode: 'retry' });
    expect(retry).toMatchObject({ processed: 2, sent: 2, failed: 0, remaining: 0 });
    expect(sentEmails).toHaveLength(6);
    expect(new Set(sentEmails.map((e) => e.email)).size).toBe(6);
    expect(createUserMock).toHaveBeenCalledTimes(7); // p1 attempted twice; p3's account was NOT recreated
  });

  it('an existing account that joined ANOTHER office after staging is skipped, not invited', async () => {
    addAuthUser('late@x.com', 'u-late', {});
    await stage([{ name: 'Late', email: 'late@x.com', phone: '0412345678' }]);
    state.users['u-late'].officeId = 'competitor-office';
    const { sendStagedChunk } = await svc();
    const r = await sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1' });
    expect(r).toMatchObject({ processed: 1, skipped: 1 });
    expect(sentEmails).toHaveLength(0);
    expect(state.users['u-late'].officeId).toBe('competitor-office');
  });

  it('a staged batch can be discarded only while nothing has been sent', async () => {
    const { importId } = await stage(people(2));
    const { discardImportBatch, listStagedAgents, sendStagedChunk } = await svc();
    await discardImportBatch({ importId, officeId: OFFICE });
    expect(await listStagedAgents(OFFICE)).toHaveLength(0);

    const second = await stage(people(2, 'q'));
    await sendStagedChunk({ officeId: OFFICE, actorUid: 'admin1' });
    await expect(discardImportBatch({ importId: second.importId, officeId: OFFICE })).rejects.toMatchObject({ status: 409 });
  });
});

describe('activation links — long-lived, single-purpose, safe', () => {
  beforeEach(reset);
  const seedInvited = (uid = 'u1') => { state.users[uid] = { email: `${uid}@x.com`, accountStatus: 'invited', officeId: OFFICE }; };

  it('stores only a hash, replaces earlier links, and lasts 14 days', async () => {
    seedInvited();
    const { createActivationLink, hashToken } = await act();
    const l1 = await createActivationLink({ uid: 'u1', email: 'u1@x.com', officeId: OFFICE });
    const t1 = new URL(l1).searchParams.get('t');
    expect(Object.keys(state.officeActivations)).toEqual([hashToken(t1)]);
    expect(JSON.stringify(state.officeActivations)).not.toContain(t1);
    const ttl = state.officeActivations[hashToken(t1)].expiresAtMs - Date.now();
    expect(ttl).toBeGreaterThan(13.9 * 24 * 3600 * 1000);
    expect(ttl).toBeLessThanOrEqual(14 * 24 * 3600 * 1000);

    const l2 = await createActivationLink({ uid: 'u1', email: 'u1@x.com', officeId: OFFICE });
    const { redeemActivationToken } = await act();
    await expect(redeemActivationToken(t1)).rejects.toMatchObject({ status: 410 }); // replaced
    await expect(redeemActivationToken(new URL(l2).searchParams.get('t'))).resolves.toEqual({ oobCode: 'fresh' });
  });

  it('mints a FRESH Firebase code only when the agent submits — never on page load — and retries keep working', async () => {
    seedInvited();
    const { createActivationLink, redeemActivationToken, inspectActivationToken } = await act();
    const t = new URL(await createActivationLink({ uid: 'u1', email: 'u1@x.com', officeId: OFFICE })).searchParams.get('t');
    expect(resetLinkMock).not.toHaveBeenCalled();
    await redeemActivationToken(t); await redeemActivationToken(t);
    expect(resetLinkMock).toHaveBeenCalledTimes(2);
  });

  it('REGRESSION (first-tap "expired link"): scanners / iOS previews opening the page can never mint or consume anything', async () => {
    state.users.u1 = { email: 'u1@x.com', firstName: 'Sam', accountStatus: 'invited', officeId: OFFICE };
    const { createActivationLink, inspectActivationToken, hashToken } = await act();
    const t = new URL(await createActivationLink({ uid: 'u1', email: 'u1@x.com', officeId: OFFICE })).searchParams.get('t');
    const before = JSON.stringify(state.officeActivations);
    for (let i = 0; i < 5; i += 1) {
      await expect(inspectActivationToken(t)).resolves.toEqual({ firstName: 'Sam', officeName: 'Harcourts Property Hub' });
    }
    expect(resetLinkMock).not.toHaveBeenCalled();
    expect(JSON.stringify(state.officeActivations)).toBe(before); // uses/lastUsedAt untouched
    expect(state.officeActivations[hashToken(t)].uses).toBe(0);
  });

  it('inspect applies the same safety rules (expired, replaced, active, unknown)', async () => {
    seedInvited();
    const { createActivationLink, inspectActivationToken, hashToken } = await act();
    await expect(inspectActivationToken('nope')).rejects.toMatchObject({ status: 404 });
    const t = new URL(await createActivationLink({ uid: 'u1', email: 'u1@x.com', officeId: OFFICE })).searchParams.get('t');
    state.officeActivations[hashToken(t)].expiresAtMs = Date.now() - 1;
    await expect(inspectActivationToken(t)).rejects.toMatchObject({ status: 410 });
    state.officeActivations[hashToken(t)].expiresAtMs = Date.now() + 1000;
    state.users.u1.accountStatus = 'active';
    await expect(inspectActivationToken(t)).resolves.toEqual({ alreadyActive: true });
  });

  it('rejects unknown, malformed, expired and over-used tokens; and disabled accounts', async () => {
    seedInvited();
    const { createActivationLink, redeemActivationToken, hashToken } = await act();
    await expect(redeemActivationToken('nope')).rejects.toMatchObject({ status: 404 });
    await expect(redeemActivationToken('x'.repeat(40))).rejects.toMatchObject({ status: 404 });
    const t = new URL(await createActivationLink({ uid: 'u1', email: 'u1@x.com', officeId: OFFICE })).searchParams.get('t');
    state.officeActivations[hashToken(t)].uses = 25;
    await expect(redeemActivationToken(t)).rejects.toMatchObject({ status: 429 });
    state.officeActivations[hashToken(t)].uses = 0;
    state.officeActivations[hashToken(t)].expiresAtMs = Date.now() - 1;
    await expect(redeemActivationToken(t)).rejects.toMatchObject({ status: 410 });
    state.officeActivations[hashToken(t)].expiresAtMs = Date.now() + 1000;
    getUserMock.mockResolvedValueOnce({ uid: 'u1', email: 'u1@x.com', disabled: true });
    await expect(redeemActivationToken(t)).rejects.toMatchObject({ status: 404 });
    expect(resetLinkMock).not.toHaveBeenCalled();
  });

  it('an already-activated account is told to sign in — no new password link is minted', async () => {
    state.users.u1 = { email: 'u1@x.com', accountStatus: 'active', officeId: OFFICE };
    const { createActivationLink, redeemActivationToken } = await act();
    const t = new URL(await createActivationLink({ uid: 'u1', email: 'u1@x.com', officeId: OFFICE })).searchParams.get('t');
    await expect(redeemActivationToken(t)).resolves.toEqual({ alreadyActive: true });
    expect(resetLinkMock).not.toHaveBeenCalled();
  });
});

describe('Office page workflow (source guards)', () => {
  const fs = require('node:fs');
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');
  const page = read('src/app/dashboard/office/page.js');

  it('uploading/validating only stages — the old one-click "Confirm & Invite" commit is gone from the UI', () => {
    expect(page).toContain('/import/stage');
    expect(page).not.toContain('/import/commit');
    expect(page).toContain('(no emails sent)');
  });

  it('prominent green "Send All Invitations (X)" button opens a confirmation dialog before anything is sent', () => {
    expect(page).toContain('Send All Invitations ({staged})');
    expect(page).toContain('bg-emerald-600');
    expect(page).toMatch(/onClick=\{\(\) => setConfirm\(\{ mode: 'new', count: staged \}\)\}/);
    expect(page).toContain('role="dialog"');
    expect(page).toContain('You are about to email ${confirm.count} invitation');
    // the only caller of the send endpoint is the dialog's confirm button
    expect((page.match(/import\/send/g) || [])).toHaveLength(1);
    expect(page).toContain('onClick={() => run(confirm.mode, confirm.count)}');
  });

  it('statuses read Pending Invitation -> Invited -> Active, and failed rows can be retried', () => {
    expect(page).toContain("staged: { text: 'Pending Invitation'");
    expect(page).toContain("invited: { text: 'Invited'");
    expect(page).toContain("active: { text: 'Active'");
    expect(page).toContain('Retry failed ({failed})');
  });
});
