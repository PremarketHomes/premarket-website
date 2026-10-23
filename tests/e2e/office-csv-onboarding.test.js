// @vitest-environment jsdom
/**
 * END-TO-END SIMULATION of the Harcourts CSV onboarding workflow.
 *
 * Runs the REAL Office Management page, the REAL route handlers and the REAL services against the local
 * Firebase emulators (Firestore + Auth). Only two things are faked: the signed-in user (verifyAuth) and
 * the email provider (captured in memory — nothing can be sent). Run with `npm run test:e2e`.
 *
 * It refuses to run unless the emulator hosts are set, so it can never touch production.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react';

const FS = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const ON = Boolean(FS && AUTH && /^(localhost|127\.0\.0\.1)/.test(FS) && /^(localhost|127\.0\.0\.1)/.test(AUTH) && !process.env.FIREBASE_SERVICE_ACCOUNT);

// ── fakes ────────────────────────────────────────────────────────────────────────────────────
const outbox = []; // every email "sent"
const emailFailures = new Set();
vi.mock('../../src/app/api/services/resendService', () => ({
  sendOfficeInviteEmail: async (email, firstName, officeName, link) => {
    if (emailFailures.has(email)) throw new Error('simulated provider outage');
    outbox.push({ type: 'activation', email, link });
  },
  sendOfficeJoinInviteEmail: async (email, firstName, officeName, link) => {
    if (emailFailures.has(email)) throw new Error('simulated provider outage');
    outbox.push({ type: 'join-invite', email, link });
  },
}));
vi.mock('../../src/app/api/middleware/auth', () => ({
  verifyAuth: async (req) => {
    const uid = (req.headers.get('authorization') || '').replace('Bearer ', '');
    return uid ? { authenticated: true, uid } : { authenticated: false, error: 'Unauthorized', status: 401 };
  },
}));

const session = { uid: 'admin1' };
vi.mock('../../src/app/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: session.uid }, userData: { agent: true, officeId: 'office1', isOfficeAdmin: true }, loading: false, refreshUserData: async () => true }),
}));
vi.mock('../../src/app/hooks/useRequireAgent', () => ({ useRequireAgent: () => {} }));
vi.mock('../../src/app/firebase/clientApp', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({ collection: () => ({}), doc: () => ({}), getDoc: async () => ({ exists: () => false }), query: () => ({}), where: () => ({}), orderBy: () => ({}), limit: () => ({}), getDocs: async () => ({ docs: [] }) }));
vi.mock('../../src/app/components/PropertyPageClient', () => ({ default: () => null }));

// authFetch → the real route handlers (as the signed-in session user)
const handlers = {
  mine: () => import('../../src/app/api/offices/mine/route'),
  agents: () => import('../../src/app/api/offices/[officeId]/agents/route'),
  preview: () => import('../../src/app/api/offices/[officeId]/import/preview/route'),
  stage: () => import('../../src/app/api/offices/[officeId]/import/stage/route'),
  send: () => import('../../src/app/api/offices/[officeId]/import/send/route'),
  activation: () => import('../../src/app/api/office-activation/route'),
  invite: () => import('../../src/app/api/office-invites/[token]/route'),
};
async function callRoute(url, options = {}, uid = session.uid) {
  let m; let params = {};
  if ((m = url.match(/^\/api\/offices\/mine$/))) m = [handlers.mine];
  else if ((m = url.match(/^\/api\/offices\/([^/]+)\/agents$/))) { params = { officeId: m[1] }; m = [handlers.agents]; }
  else if ((m = url.match(/^\/api\/offices\/([^/]+)\/import\/(preview|stage|send)$/))) { params = { officeId: m[1] }; m = [handlers[m[2]]]; }
  else if ((m = url.match(/^\/api\/office-activation$/))) m = [handlers.activation];
  else if ((m = url.match(/^\/api\/office-invites\/([^/]+)$/))) { params = { token: m[1] }; m = [handlers.invite]; }
  else throw new Error(`E2E router: unmapped ${url}`);
  const mod = await m[0]();
  const method = (options.method || 'GET').toUpperCase();
  const req = new Request(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json', authorization: `Bearer ${uid}` }, body: method === 'GET' ? undefined : options.body });
  return mod[method](req, { params: Promise.resolve(params) });
}
vi.mock('../../src/app/utils/authFetch', () => ({ authFetch: (url, options) => globalThis.__e2eCall(url, options) }));

// ── data ─────────────────────────────────────────────────────────────────────────────────────
const OFFICE = 'office1';
const newAgents = Array.from({ length: 45 }, (_, i) => ({ name: `New Agent ${i}`, email: `new${i}@harcourts-test.com`, phone: '0412345678' }));
const CSV = [
  'name,email,phone',
  'Member One,member1@harcourts-test.com,0411111111',
  'Member Two,member2@harcourts-test.com,0422222222',
  'Existing Solo,solo@harcourts-test.com,0433333333',
  'Other Office,rival@harcourts-test.com,0444444444',
  ...newAgents.map((a) => `${a.name},${a.email},${a.phone}`),
  'Dup Of First,new0@harcourts-test.com,0455555555',
  'Bad Email,not-an-email,0466666666',
].join('\n');
const NEW_EMAILS = newAgents.map((a) => a.email);
const ELIGIBLE = 46; // 45 new + 1 existing Premarket user

let admin; // { auth, db }
const authCount = async () => { let n = 0; let token; do { const r = await admin.auth.listUsers(1000, token); n += r.users.length; token = r.pageToken; } while (token); return n; };

describe.skipIf(!ON)('Harcourts CSV onboarding — end to end (emulators + real page)', () => {
  let Page;
  const open = async () => {
    cleanup();
    render(React.createElement(Page));
    await screen.findByText(/Bulk Import via CSV/i, {}, { timeout: 10000 });
  };

  beforeAll(async () => {
    globalThis.__e2eCall = (url, options) => callRoute(url, options);
    const { initializeApp } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');
    let app;
    try { app = initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-premarket-e2e' }); } catch { app = (await import('firebase-admin/app')).getApp(); }
    admin = { auth: getAuth(app), db: getFirestore(app) };

    // office + admin + 2 active members + 1 independent Premarket user + 1 user in another office
    await admin.db.collection('offices').doc(OFFICE).set({ agencyBrandId: null });
    await admin.db.collection('officeAdminInfo').doc(OFFICE).set({ name: 'Harcourts Property Hub', officeAdminUids: ['admin1'], status: 'active' });
    const seed = async (uid, email, data) => { await admin.auth.createUser({ uid, email, password: 'Passw0rd!seed' }); await admin.db.collection('users').doc(uid).set({ email, firstName: uid, ...data }); };
    await seed('admin1', 'admin@harcourts-test.com', { officeId: OFFICE, isOfficeAdmin: true, accountStatus: 'active' });
    await seed('member1', 'member1@harcourts-test.com', { officeId: OFFICE, accountStatus: 'active' });
    await seed('member2', 'member2@harcourts-test.com', { officeId: OFFICE, accountStatus: 'active' });
    await seed('solo', 'solo@harcourts-test.com', { agent: true });
    await seed('rival', 'rival@harcourts-test.com', { officeId: 'another-office', accountStatus: 'active' });
    Page = (await import('../../src/app/dashboard/office/page.js')).default;
  }, 60000);

  afterEach(() => { vi.useRealTimers(); });

  let usersBefore;

  it('1. validating shows what will happen to every row, and creates nothing', async () => {
    usersBefore = await authCount();
    await open();
    const input = document.querySelector('input[type=file]');
    fireEvent.change(input, { target: { files: [new File([CSV], 'harcourts.csv', { type: 'text/csv' })] } });
    fireEvent.click(await screen.findByRole('button', { name: /Preview Import/i }));
    await screen.findByText(/What will happen/i, {}, { timeout: 15000 });

    expect(screen.getAllByText(/Already an active member — skipped/)).toHaveLength(2);       // 4. existing members skipped
    expect(screen.getAllByText(/Existing Premarket user — will get a join invitation/)).toHaveLength(1);
    expect(screen.getAllByText(/Belongs to another office — skipped/)).toHaveLength(1);
    expect(screen.getAllByText(/Duplicate email in this file — skipped/)).toHaveLength(1);
    expect(screen.getAllByText(/Invalid/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('New account')).toHaveLength(45);
    expect(await authCount()).toBe(usersBefore);
    expect(outbox).toHaveLength(0);
  }, 60000);

  it('2. staging saves the list: NO accounts created, NO emails sent; agents show as Pending Invitation', async () => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Stage ${ELIGIBLE} agents \\(no emails sent\\)`) }));
    await screen.findByText(/agents staged with “Pending Invitation”/, {}, { timeout: 15000 });

    expect(await authCount()).toBe(usersBefore);
    expect(outbox).toHaveLength(0);
    const invites = await admin.db.collection('officeInvites').get();
    expect(invites.size).toBe(0);

    await waitFor(() => expect(screen.getAllByText('Pending Invitation').length).toBeGreaterThanOrEqual(ELIGIBLE), { timeout: 15000 });
    expect(screen.getByRole('button', { name: `Send All Invitations (${ELIGIBLE})` })).toBeTruthy();
    // the roster API (what Office Team reads) reports them as staged, with no phone numbers
    const roster = await (await callRoute(`/api/offices/${OFFICE}/agents`)).json();
    expect(roster.agents.filter((a) => a.status === 'staged')).toHaveLength(ELIGIBLE);
    expect(JSON.stringify(roster)).not.toMatch(/04\d{8}/);
    expect(roster.agents.filter((a) => a.status === 'active').map((a) => a.email).sort()).toEqual(['admin@harcourts-test.com', 'member1@harcourts-test.com', 'member2@harcourts-test.com']);

    // the Team page (Office Team roster) shows the same staged agents as Pending Invitation
    cleanup();
    const Team = (await import('../../src/app/dashboard/office/team/page.js')).default;
    render(React.createElement(Team));
    await screen.findByText(new RegExp(`${ELIGIBLE} pending invitation`), {}, { timeout: 15000 });
    expect(screen.getAllByText('Pending Invitation').length).toBe(ELIGIBLE);
    expect(screen.getByText('member1')).toBeTruthy();
    cleanup();
  }, 60000);

  it('8. staged agents survive a refresh and a log-out / log-in', async () => {
    await open(); // fresh render == page refresh
    expect(await screen.findByRole('button', { name: `Send All Invitations (${ELIGIBLE})` }, { timeout: 15000 })).toBeTruthy();
    cleanup();
    session.uid = 'someone-else'; // logged out / another person: cannot see or send
    expect((await callRoute(`/api/offices/${OFFICE}/agents`, {}, 'someone-else')).status).toBe(403);
    expect((await callRoute(`/api/offices/${OFFICE}/import/send`, { method: 'POST', body: '{}' }, 'someone-else')).status).toBe(403);
    session.uid = 'admin1'; // admin logs back in
    await open();
    expect(await screen.findByRole('button', { name: `Send All Invitations (${ELIGIBLE})` }, { timeout: 15000 })).toBeTruthy();
    expect(outbox).toHaveLength(0);
  }, 60000);

  it('3. Send All shows the right count in a confirmation dialog; cancelling sends nothing', async () => {
    fireEvent.click(await screen.findByRole('button', { name: `Send All Invitations (${ELIGIBLE})` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(new RegExp(`about to email ${ELIGIBLE} invitations`))).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: `Yes, send ${ELIGIBLE} invitations` })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(outbox).toHaveLength(0);
  }, 60000);

  it('5+6. confirming sends each invitation exactly once; failures are listed and retried without resending the rest', async () => {
    emailFailures.add('new3@harcourts-test.com');
    emailFailures.add('new17@harcourts-test.com');

    fireEvent.click(screen.getByRole('button', { name: `Send All Invitations (${ELIGIBLE})` }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: `Yes, send ${ELIGIBLE} invitations` }));
    await screen.findByRole('button', { name: 'Retry failed (2)' }, { timeout: 90000 });

    expect(outbox).toHaveLength(ELIGIBLE - 2);
    expect(new Set(outbox.map((e) => e.email)).size).toBe(ELIGIBLE - 2);      // nobody emailed twice
    expect(outbox.filter((e) => e.type === 'join-invite').map((e) => e.email)).toEqual(['solo@harcourts-test.com']);
    const mailed = new Set(outbox.map((e) => e.email));
    for (const skipped of ['member1@harcourts-test.com', 'member2@harcourts-test.com', 'rival@harcourts-test.com', 'admin@harcourts-test.com']) expect(mailed.has(skipped)).toBe(false);
    expect(screen.queryByRole('button', { name: /Send All Invitations/ })).toBeNull();

    // the provider recovers; Retry resends ONLY the two failures
    emailFailures.clear();
    const accountsAfterFirstPass = await authCount();
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed (2)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Yes, retry 2' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, retry 2' }));
    await waitFor(() => expect(outbox).toHaveLength(ELIGIBLE), { timeout: 60000 });

    expect(new Set(outbox.map((e) => e.email)).size).toBe(ELIGIBLE);
    expect(await authCount()).toBe(accountsAfterFirstPass);                     // no duplicate accounts
    expect(await authCount()).toBe(usersBefore + 45);                           // exactly the 45 brand-new agents
    // pressing anything again sends nothing more
    const again = await (await callRoute(`/api/offices/${OFFICE}/import/send`, { method: 'POST', body: JSON.stringify({ mode: 'new' }) })).json();
    expect(again.processed).toBe(0);
    expect(outbox).toHaveLength(ELIGIBLE);

    await waitFor(() => expect(within(document.querySelector('table')).queryByText('Pending Invitation')).toBeNull(), { timeout: 15000 });
    const roster = await (await callRoute(`/api/offices/${OFFICE}/agents`)).json();
    expect(roster.agents.filter((a) => a.status === 'invited')).toHaveLength(45);          // new agents: Invited
    expect(roster.agents.filter((a) => a.status === 'pending-acceptance')).toHaveLength(1); // the existing user: invited, awaiting acceptance
    expect(roster.agents.filter((a) => a.status === 'staged' || a.status === 'send-failed')).toHaveLength(0);
  }, 180000);

  it('7a. activation links work, are reusable until activated, and stop working once the account is active', async () => {
    const mail = outbox.find((e) => e.email === 'new1@harcourts-test.com');
    const token = new URL(mail.link).searchParams.get('t');
    expect(mail.link).toMatch(/^https:\/\/premarket\.homes\/activate\?t=/);

    const first = await (await callRoute('/api/office-activation', { method: 'POST', body: JSON.stringify({ token }) })).json();
    expect(first.url).toContain('oobCode=');
    const second = await (await callRoute('/api/office-activation', { method: 'POST', body: JSON.stringify({ token }) })).json();
    expect(second.url).toContain('oobCode=');                                     // a retry mints a fresh link

    // set the password through Firebase's own flow (emulator), then the agent signs in for the first time
    const oob = new URL(second.url).searchParams.get('oobCode');
    const reset = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=fake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode: oob, newPassword: 'N3w-Passw0rd!' }),
    });
    expect(reset.ok, `reset failed: ${reset.status} ${await reset.clone().text()} ${second.url}`).toBe(true);
    const uid = (await admin.auth.getUserByEmail('new1@harcourts-test.com')).uid;
    const { markOfficeAccountActivated } = await import('../../src/app/api/services/officeService');
    expect(await markOfficeAccountActivated(uid)).toEqual({ activated: true });

    expect(await (await callRoute('/api/office-activation', { method: 'POST', body: JSON.stringify({ token }) })).json()).toEqual({ alreadyActive: true });
    const roster = await (await callRoute(`/api/offices/${OFFICE}/agents`)).json();
    expect(roster.agents.find((a) => a.email === 'new1@harcourts-test.com').status).toBe('active'); // Invited -> Active
  }, 60000);

  it('7b. activation links last 14 days, then expire; the existing-account invitation expires after 14 days too', async () => {
    const token = new URL(outbox.find((e) => e.email === 'new2@harcourts-test.com').link).searchParams.get('t');
    const redeem = () => callRoute('/api/office-activation', { method: 'POST', body: JSON.stringify({ token }) });
    const inviteToken = new URL(outbox.find((e) => e.type === 'join-invite').link).searchParams.get('token');
    const accept = () => callRoute(`/api/office-invites/${inviteToken}`, { method: 'POST' }, 'solo');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 13 * 24 * 3600 * 1000));
    expect((await redeem()).status).toBe(200);                 // day 13: still valid

    vi.setSystemTime(new Date(Date.now() + 2 * 24 * 3600 * 1000)); // day 15
    const expired = await redeem();
    expect(expired.status).toBe(410);
    expect((await expired.json()).error).toMatch(/expired/);
    expect((await accept()).status).toBe(410);                 // join invitation expired as well
    vi.useRealTimers();

    // back in real time the same invitation is valid again, and accepting it links the existing account
    expect((await accept()).status).toBe(200);
    expect((await admin.db.collection('users').doc('solo').get()).data().officeId).toBe(OFFICE);
  }, 60000);
});
