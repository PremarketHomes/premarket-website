import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const {
  activateLeadership, evaluateAccount, formatReport, parseArgs, isAgent, resolveFirebaseTarget, initFirebase, EXPECTED_PROJECT_ID,
} = require('../../scripts/activate-leadership');

const OFFICE = 'hph';
const AUTH = {
  'david@x.test': { uid: 'david' },
  'trevor@x.test': { uid: 'trevor' },
  'member@x.test': { uid: 'member' },
  'buyer@x.test': { uid: 'buyer' },
  'dual@x.test': { uid: 'dual' },
  'norole@x.test': { uid: 'norole' },
  'nodoc@x.test': { uid: 'nodoc' },
  'other@x.test': { uid: 'other' },
  'off@x.test': { uid: 'off', disabled: true },
};
const USERS = {
  david: { firstName: 'David', roles: ['agent'] },
  trevor: { firstName: 'Trevor', isAgent: true },
  member: { officeId: OFFICE, agent: true },
  buyer: { roles: ['buyer'], isBuyer: true },
  dual: { roles: ['agent', 'buyer'] },
  norole: { firstName: 'Nobody' },
  other: { officeId: 'elsewhere', isAgent: true },
  off: { isAgent: true },
};

function makeDeps({ office = { name: 'HPH', status: 'active', leadershipUids: [] } } = {}) {
  return {
    getOffice: vi.fn(async (id) => (id === OFFICE ? office : null)),
    getAuthUserByEmail: vi.fn(async (e) => { if (!AUTH[e]) throw new Error('no such user'); return AUTH[e]; }),
    getUserDoc: vi.fn(async (uid) => USERS[uid] || null),
    writeLeadership: vi.fn(async () => {}),
  };
}
const run = (emails, opts = {}, deps = makeDeps()) =>
  activateLeadership({ officeId: OFFICE, emails, ...opts }, deps).then((r) => ({ r, deps }));

describe('eligibility', () => {
  it('accepts agent accounts with no office, and office members', async () => {
    const { r } = await run(['david@x.test', 'trevor@x.test', 'member@x.test']);
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.eligible)).toEqual([true, true, true]);
    expect(r.rows[0]).toMatchObject({ email: 'david@x.test', uid: 'david', role: 'agent', office: 'none' });
    expect(r.rows[2].office).toBe('this office (member)');
  });
  it('accepts an account that is both agent and buyer', async () => {
    const { r } = await run(['dual@x.test']);
    expect(r.ok).toBe(true);
    expect(r.rows[0].role).toBe('agent + buyer');
  });
  it.each([
    ['nodoc@x.test', /no matching users document/],
    ['buyer@x.test', /buyer-only account.*redirect/],
    ['norole@x.test', /no agent role/],
    ['other@x.test', /different office \(elsewhere\)/],
    ['off@x.test', /disabled/],
    ['ghost@x.test', /no Firebase Auth account/],
  ])('refuses %s with a clear reason', async (email, reason) => {
    const { r } = await run([email]);
    expect(r.ok).toBe(false);
    expect(r.rows[0].eligible).toBe(false);
    expect(r.rows[0].reason).toMatch(reason);
  });
  it('uses the same agent rule as the app', () => {
    expect(isAgent({ roles: ['agent'] })).toBe(true);
    expect(isAgent({ isAgent: true })).toBe(true);
    expect(isAgent({ agent: true })).toBe(true);
    expect(isAgent({ isBuyer: true })).toBe(false);
    expect(isAgent({})).toBe(false);
  });
  it('never creates or edits anything while evaluating', async () => {
    const deps = makeDeps();
    await evaluateAccount('david@x.test', { officeId: OFFICE }, deps);
    expect(Object.keys(deps).sort()).toEqual(['getAuthUserByEmail', 'getOffice', 'getUserDoc', 'writeLeadership']);
    expect(deps.writeLeadership).not.toHaveBeenCalled();
  });
});

describe('dry run by default; only --execute writes', () => {
  it('writes nothing without --execute, even when everyone is eligible', async () => {
    const { r, deps } = await run(['david@x.test', 'trevor@x.test']);
    expect(r).toMatchObject({ ok: true, written: false });
    expect(deps.writeLeadership).not.toHaveBeenCalled();
  });
  it('--execute writes exactly the eligible uids once', async () => {
    const { r, deps } = await run(['david@x.test', 'trevor@x.test'], { execute: true });
    expect(r.written).toBe(true);
    expect(deps.writeLeadership).toHaveBeenCalledTimes(1);
    expect(deps.writeLeadership).toHaveBeenCalledWith({ officeId: OFFICE, uids: ['david', 'trevor'], remove: false });
  });
  it('--remove is allowed for accounts that would no longer be eligible (e.g. now disabled or buyer-only)', async () => {
    const { r, deps } = await run(['off@x.test', 'buyer@x.test'], { execute: true, remove: true });
    expect(r.ok).toBe(true);
    expect(deps.writeLeadership).toHaveBeenCalledWith({ officeId: OFFICE, uids: ['off', 'buyer'], remove: true });
  });
  it('the script defaults to a dry run on the command line', () => {
    expect(parseArgs(['--office', 'x', '--email', 'A@X.test']).execute).toBe(false);
    expect(parseArgs(['--office', 'x', '--email', 'A@X.test', '--execute']).execute).toBe(true);
  });
});

describe('a mixed valid/invalid batch never partially writes', () => {
  it.each([
    ['other-office account', 'other@x.test'],
    ['buyer-only account', 'buyer@x.test'],
    ['account without a users document', 'nodoc@x.test'],
    ['disabled account', 'off@x.test'],
    ['unknown email', 'ghost@x.test'],
  ])('one valid + one %s, with --execute: nothing is written', async (_n, bad) => {
    const { r, deps } = await run(['david@x.test', bad, 'trevor@x.test'], { execute: true });
    expect(r.ok).toBe(false);
    expect(r.written).toBe(false);
    expect(deps.writeLeadership).not.toHaveBeenCalled();
    expect(r.rows.filter((x) => x.eligible).map((x) => x.email)).toEqual(['david@x.test', 'trevor@x.test']);
  });
  it('refuses an inactive or missing office before looking at any account', async () => {
    await expect(activateLeadership({ officeId: 'nope', emails: ['david@x.test'], execute: true }, makeDeps())).rejects.toThrow(/No office/);
    const deps = makeDeps({ office: { name: 'X', status: 'disabled' } });
    await expect(activateLeadership({ officeId: OFFICE, emails: ['david@x.test'], execute: true }, deps)).rejects.toThrow(/not active/);
    expect(deps.getAuthUserByEmail).not.toHaveBeenCalled();
    expect(deps.writeLeadership).not.toHaveBeenCalled();
  });
});

describe('dry-run report', () => {
  it('shows email, uid, role, office membership and eligibility for each account, with reasons', async () => {
    const { r } = await run(['david@x.test', 'member@x.test', 'buyer@x.test', 'other@x.test']);
    const out = formatReport(r.rows);
    for (const h of ['EMAIL', 'UID', 'ROLE', 'OFFICE', 'ELIGIBLE']) expect(out).toContain(h);
    expect(out).toMatch(/david@x.test\s+david\s+agent\s+none\s+YES/);
    expect(out).toMatch(/member@x.test\s+member\s+agent\s+this office \(member\)\s+YES/);
    expect(out).toMatch(/buyer@x.test\s+buyer\s+buyer only\s+none\s+NO/);
    expect(out).toMatch(/other@x.test\s+other\s+agent\s+DIFFERENT office \(elsewhere\)\s+NO/);
    expect(out).toContain('-> this is a buyer-only account');
  });
});

describe('the script file itself', () => {
  const src = fs.readFileSync('scripts/activate-leadership.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('can only write the leadershipUids field of one office document, and nothing else', () => {
    expect(src.match(/\.update\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/\.(set|add|delete)\(|createUser|updateUser|setCustomUserClaims|generatePasswordResetLink|officeAdminUids|isOfficeAdmin|FieldValue\.delete/);
    expect(src).toMatch(/leadershipUids: rm \? FieldValue\.arrayRemove/);
  });
  it('does not run when imported (only when executed directly)', () => {
    expect(src).toMatch(/require\.main === module/);
  });
});


describe('Firebase project selection and credentials', () => {
  const PK = '-----BEGIN PRIVATE KEY-----\\nFAKEKEYMATERIAL\\n-----END PRIVATE KEY-----\\n';
  const sa = (over = {}) => JSON.stringify({ type: 'service_account', project_id: 'premarket-homes', client_email: 'svc@premarket-homes.iam.gserviceaccount.com', private_key: 'FAKE-KEY', ...over });
  const fakeAdmin = (apps = []) => {
    const calls = { init: [], cert: [], adc: 0 };
    return {
      calls,
      getApps: () => apps,
      cert: (spec) => { calls.cert.push(spec); return { kind: 'cert' }; },
      applicationDefault: () => { calls.adc += 1; return { kind: 'adc' }; },
      initializeApp: (opts) => { calls.init.push(opts); return { options: { projectId: opts.projectId } }; },
    };
  };

  it('always targets premarket-homes', () => {
    expect(EXPECTED_PROJECT_ID).toBe('premarket-homes');
    expect(resolveFirebaseTarget({})).toEqual({ projectId: 'premarket-homes', kind: 'application-default' });
  });

  it('with no credential variables it uses the signed-in Google credentials and names the project explicitly', () => {
    const admin = fakeAdmin();
    const { app, target } = initFirebase({}, admin);
    expect(target.kind).toBe('application-default');
    expect(admin.calls.adc).toBe(1);
    expect(admin.calls.cert).toHaveLength(0);
    expect(admin.calls.init).toEqual([{ credential: { kind: 'adc' }, projectId: 'premarket-homes' }]);
    expect(app.options.projectId).toBe('premarket-homes');
  });

  it('uses the application\'s own service-account variable when present (premarket-homes only)', () => {
    const admin = fakeAdmin();
    initFirebase({ FIREBASE_SERVICE_ACCOUNT: sa() }, admin);
    expect(admin.calls.cert).toHaveLength(1);
    expect(admin.calls.init[0].projectId).toBe('premarket-homes');
    expect(admin.calls.adc).toBe(0);
  });

  it('supports the application\'s split FIREBASE_* variables, restoring newlines in the key', () => {
    const admin = fakeAdmin();
    initFirebase({ FIREBASE_PROJECT_ID: 'premarket-homes', FIREBASE_CLIENT_EMAIL: 'svc@premarket-homes.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: PK }, admin);
    expect(admin.calls.cert[0]).toMatchObject({ projectId: 'premarket-homes', clientEmail: 'svc@premarket-homes.iam.gserviceaccount.com' });
    expect(admin.calls.cert[0].privateKey).toContain('\n');
    expect(admin.calls.cert[0].privateKey).not.toContain('\\n');
  });

  it.each([
    ['a service account for another project', { FIREBASE_SERVICE_ACCOUNT: sa({ project_id: 'some-other-project' }) }, /not "premarket-homes"/],
    ['FIREBASE_PROJECT_ID for another project', { FIREBASE_PROJECT_ID: 'some-other-project', FIREBASE_CLIENT_EMAIL: 'a@b', FIREBASE_PRIVATE_KEY: 'k' }, /not "premarket-homes"/],
    ['GOOGLE_CLOUD_PROJECT naming another project', { GOOGLE_CLOUD_PROJECT: 'staging-project' }, /GOOGLE_CLOUD_PROJECT.*not "premarket-homes"/],
    ['GCLOUD_PROJECT naming another project', { GCLOUD_PROJECT: 'staging-project' }, /GCLOUD_PROJECT/],
    ['malformed service-account JSON', { FIREBASE_SERVICE_ACCOUNT: '{not json' }, /not valid JSON/],
    ['a service account missing its key', { FIREBASE_SERVICE_ACCOUNT: sa({ private_key: undefined }) }, /missing client_email or private_key/],
    ['FIREBASE_PROJECT_ID without a key or email', { FIREBASE_PROJECT_ID: 'premarket-homes' }, /missing/],
  ])('stops safely for %s, before starting Firebase', (_n, env, message) => {
    const admin = fakeAdmin();
    expect(() => initFirebase(env, admin)).toThrow(message);
    expect(admin.calls.init).toHaveLength(0);
    expect(admin.calls.cert).toHaveLength(0);
  });

  it('accepts GOOGLE_CLOUD_PROJECT when it names premarket-homes', () => {
    expect(() => resolveFirebaseTarget({ GOOGLE_CLOUD_PROJECT: 'premarket-homes' })).not.toThrow();
  });

  it('error messages never echo credential values', () => {
    const secrets = { FIREBASE_SERVICE_ACCOUNT: sa({ project_id: 'other', private_key: 'SUPERSECRETKEY' }) };
    try { resolveFirebaseTarget(secrets); } catch (e) { expect(e.message).not.toContain('SUPERSECRETKEY'); expect(e.message).not.toContain('svc@'); }
    try { resolveFirebaseTarget({ FIREBASE_SERVICE_ACCOUNT: '{"private_key":"SUPERSECRETKEY"' }); } catch (e) { expect(e.message).not.toContain('SUPERSECRETKEY'); }
  });

  it('refuses to run if the SDK reports a different project, or was already initialised', () => {
    const wrong = fakeAdmin();
    wrong.initializeApp = () => ({ options: { projectId: 'surprise' } });
    expect(() => initFirebase({}, wrong)).toThrow(/"surprise", not "premarket-homes"/);
    expect(() => initFirebase({}, fakeAdmin([{}]))).toThrow(/already initialised/);
  });

  it('the script passes the explicit app to Firestore and Auth, and has no private keys or project ids hard-coded beyond premarket-homes', () => {
    const raw = fs.readFileSync('scripts/activate-leadership.js', 'utf8');
    expect(raw).toMatch(/getFirestore\(app\)/);
    expect(raw).toMatch(/getAuth\(app\)\.getUserByEmail/);
    expect(raw).not.toMatch(/BEGIN (RSA )?PRIVATE KEY|serviceAccountKey|\.json['"]/);
    expect(raw.match(/premarket-[a-z]+/g).every((m) => m === 'premarket-homes')).toBe(true);
  });
});
