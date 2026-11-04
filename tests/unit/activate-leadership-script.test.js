import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { activateLeadership, evaluateAccount, formatReport, parseArgs, isAgent } = require('../../scripts/activate-leadership');

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
