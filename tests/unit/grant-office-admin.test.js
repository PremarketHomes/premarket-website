import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { planGrant, applyGrant, applyRevoke } = require('../../scripts/lib/officeAdminGrant');
const { run, parseArgs } = require('../../scripts/grant-office-admin');

// In-memory Firestore with transactions that apply writes only on success.
function fake(seed) {
  const store = new Map(Object.entries(seed)); let n = 0; const writes = [];
  const FieldValue = { serverTimestamp: () => 'TS', delete: () => ({ __del: true }), arrayUnion: (v) => ({ __union: v }), arrayRemove: (v) => ({ __remove: v }) };
  const apply = (path, patch) => { const cur = { ...(store.get(path) || {}) }; for (const [k, v] of Object.entries(patch)) { if (v && v.__del) delete cur[k]; else if (v && v.__union !== undefined) cur[k] = [...new Set([...(cur[k] || []), v.__union])]; else if (v && v.__remove !== undefined) cur[k] = (cur[k] || []).filter((x) => x !== v.__remove); else cur[k] = v; } store.set(path, cur); };
  const doc = (col, id) => { const path = `${col}/${id || `auto${++n}`}`; return { path, get: async () => ({ exists: store.has(path), id: path.split('/')[1], data: () => store.get(path) }) }; };
  const query = (col, filters = []) => ({ where: (f, op, v) => query(col, [...filters, [f, v]]), get: async () => ({ docs: [...store.entries()].filter(([p, d]) => p.startsWith(col + '/') && filters.every(([f, v]) => d[f] === v)).map(([p, d]) => ({ id: p.split('/')[1], data: () => d })) }) });
  const db = {
    collection: (col) => ({ doc: (id) => doc(col, id), where: (f, op, v) => query(col, [[f, v]]) }),
    runTransaction: async (fn) => { const pending = []; const tx = { get: (r) => r.get(), update: (r, p) => pending.push(() => { writes.push(['update', r.path]); apply(r.path, p); }), set: (r, d) => pending.push(() => { writes.push(['set', r.path]); store.set(r.path, { ...d }); }) }; const out = await fn(tx); pending.forEach((w) => w()); return out; },
  };
  return { db, store, FieldValue, writes };
}
const OFFICE = 'hph';
const seed = (over = {}) => ({
  'officeAdminInfo/hph': { name: 'Harcourts Property Hub', status: 'active', officeAdminUids: ['acct'], leadershipUids: ['lead'] },
  'users/acct': { email: 'accounts@premarket.homes', officeId: OFFICE, isOfficeAdmin: true, superAdmin: true, agent: true, accountStatus: 'active' },
  'users/hannah': { email: 'hannah@hph.com.au', officeId: OFFICE, agent: true, accountStatus: 'active', phone: '0400 000 000', avatar: 'https://x/real.jpg' },
  'users/lead': { email: 'lead@gmail.com', officeId: OFFICE },
  'users/bob': { email: 'bob@hph.com.au', officeId: OFFICE, agent: true, accountStatus: 'active' },
  ...over,
});
const args = (extra = {}) => ({ officeName: 'Harcourts Property Hub', email: 'Hannah@HPH.com.au', execute: false, revoke: false, ...extra });

describe('grant: dry run is the default and writes nothing', () => {
  it('prints a plan only', async () => {
    const f = fake(seed()); const before = JSON.stringify([...f.store]);
    const r = await run({ db: f.db, FieldValue: f.FieldValue, args: args() });
    expect(r.mode).toBe('dry-run'); expect(r.plan.ok).toBe(true); expect(r.plan.target).toMatchObject({ uid: 'hannah', email: 'h***@hph.com.au', alreadyAdmin: false }); expect(r.plan.adminCountBefore).toBe(1);
    expect(JSON.stringify([...f.store])).toBe(before); expect(f.writes).toEqual([]);
  });
  it('parseArgs requires an email and office, rejects unknown flags', () => {
    expect(() => parseArgs(['--office-name', 'x'])).toThrow(); expect(() => parseArgs(['--email', 'a@b.c'])).toThrow(); expect(() => parseArgs(['--email', 'a@b.c', '--office-name', 'x', '--super'])).toThrow();
    expect(parseArgs(['--email', ' A@B.C ', '--office-name', 'x']).execute).toBe(false);
  });
});

describe('grant: exactly the intended change', () => {
  it('adds the uid and sets isOfficeAdmin; the existing admin and every other record are untouched; one audit record', async () => {
    const f = fake(seed()); const before = Object.fromEntries(f.store);
    const r = await run({ db: f.db, FieldValue: f.FieldValue, args: args({ execute: true }) });
    expect(r).toMatchObject({ mode: 'granted', uid: 'hannah', adminCountBefore: 1, adminCountAfter: 2 });
    expect(f.store.get('officeAdminInfo/hph').officeAdminUids).toEqual(['acct', 'hannah']);
    expect(f.store.get('officeAdminInfo/hph').leadershipUids).toEqual(['lead']);
    expect(f.store.get('users/hannah')).toEqual({ ...before['users/hannah'], isOfficeAdmin: true });
    expect(f.store.get('users/hannah').superAdmin).toBeUndefined();
    for (const k of ['users/acct', 'users/bob', 'users/lead']) expect(f.store.get(k)).toEqual(before[k]);
    const audit = [...f.store.entries()].filter(([k]) => k.startsWith('officeTeamAudit/')).map(([, v]) => v); expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'office.adminGranted', targetUid: 'hannah', officeId: OFFICE });
    expect(f.writes.map((w) => w[1]).sort()).toEqual([expect.stringMatching(/^officeAdminInfo\/hph$/), expect.stringMatching(/^officeTeamAudit\//), 'users/hannah'].map((x) => x).sort((a, b) => String(a).localeCompare(String(b))).map((x) => x));
  });
  it('is idempotent: a second run changes nothing further', async () => {
    const f = fake(seed()); await run({ db: f.db, FieldValue: f.FieldValue, args: args({ execute: true }) });
    await run({ db: f.db, FieldValue: f.FieldValue, args: args({ execute: true }) });
    expect(f.store.get('officeAdminInfo/hph').officeAdminUids).toEqual(['acct', 'hannah']);
  });
});

describe('grant: refuses anything that could widen access beyond HPH', () => {
  const refuses = async (over, email, msg) => { const f = fake(seed(over)); const plan = await planGrant({ db: f.db, officeId: OFFICE, email }); expect(plan.ok).toBe(false); expect(plan.reasons.join(' ')).toMatch(msg); await expect(applyGrant({ db: f.db, FieldValue: f.FieldValue, officeId: OFFICE, email })).rejects.toThrow(/Refusing/); expect(f.writes).toEqual([]); };
  it('a Premarket platform address', () => refuses({ 'users/p': { email: 'someone@premarket.homes', officeId: OFFICE, agent: true, accountStatus: 'active' } }, 'someone@premarket.homes', /platform address/));
  it('a platform super-admin', () => refuses({ 'users/s': { email: 's@hph.com.au', officeId: OFFICE, agent: true, accountStatus: 'active', superAdmin: true } }, 's@hph.com.au', /super-admin/));
  it('an account that has not activated (status invited)', () => refuses({ 'users/i': { email: 'i@hph.com.au', officeId: OFFICE, agent: true, accountStatus: 'invited' } }, 'i@hph.com.au', /not been activated/));
  it('a disabled account, or one with no agent role', async () => {
    await refuses({ 'users/d': { email: 'd@hph.com.au', officeId: OFFICE, agent: true, accountStatus: 'active', disabled: true } }, 'd@hph.com.au', /disabled/);
    await refuses({ 'users/n': { email: 'n@hph.com.au', officeId: OFFICE, accountStatus: 'active' } }, 'n@hph.com.au', /no agent role/);
  });
  it('a member of a different office, an unknown email, or an email shared by two members', async () => {
    await refuses({ 'users/o': { email: 'o@other.com', officeId: 'other', agent: true, accountStatus: 'active' } }, 'o@other.com', /found 0/);
    await refuses({}, 'nobody@hph.com.au', /found 0/);
    await refuses({ 'users/dup': { email: 'hannah@hph.com.au', officeId: OFFICE, agent: true, accountStatus: 'active' } }, 'hannah@hph.com.au', /found 2/);
  });
  it('an inactive office', async () => { const s = seed(); s['officeAdminInfo/hph'].status = 'suspended'; const f = fake(s); expect((await planGrant({ db: f.db, officeId: OFFICE, email: 'hannah@hph.com.au' })).ok).toBe(false); });
});

describe('revert', () => {
  it('removes only that account from the administrators and clears the flag; never the last administrator', async () => {
    const f = fake(seed()); await run({ db: f.db, FieldValue: f.FieldValue, args: args({ execute: true }) });
    const r = await run({ db: f.db, FieldValue: f.FieldValue, args: args({ execute: true, revoke: true }) });
    expect(r).toMatchObject({ mode: 'revoked', adminCountAfter: 1 });
    expect(f.store.get('officeAdminInfo/hph').officeAdminUids).toEqual(['acct']); expect(f.store.get('users/hannah').isOfficeAdmin).toBeUndefined();
    expect(f.store.get('users/acct').isOfficeAdmin).toBe(true);
    await expect(run({ db: f.db, FieldValue: f.FieldValue, args: args({ email: 'accounts@premarket.homes', execute: true, revoke: true }) })).rejects.toThrow(/no administrator/);
    await expect(run({ db: f.db, FieldValue: f.FieldValue, args: args({ email: 'bob@hph.com.au', execute: true, revoke: true }) })).rejects.toThrow(/not an administrator/);
  });
});

describe('structural guarantees', () => {
  it('imports no Auth, email or notification code and never mentions superAdmin as something it sets', () => {
    const src = readFileSync('scripts/grant-office-admin.js', 'utf8') + readFileSync('scripts/lib/officeAdminGrant.js', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/firebase-admin\/auth|getAuth|createUser|updateUser|setCustomUserClaims|generatePasswordResetLink|resend|sendEmail|src\/app/i);
    expect(code).not.toMatch(/superAdmin\s*:\s*true|superAdmin:/); // only ever read, never set
    expect(code).not.toMatch(/(?<!FieldValue)\.delete\(/); // never deletes a document (FieldValue.delete() only clears the isOfficeAdmin flag on revert)
  });
});
