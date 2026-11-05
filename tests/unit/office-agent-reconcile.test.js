import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { reconcile } = require('../../scripts/lib/officeAgentReconcile');

describe('officeAgents reconciliation dry run', () => {
  const base = {
    officeId: 'hph',
    users: [
      { uid: 'u1', firstName: 'A', lastName: 'One', email: 'a@x.com', avatar: 'p', accountStatus: 'active' },
      { uid: 'u2', firstName: 'B', lastName: 'Two', email: 'b@x.com', accountStatus: 'invited' },
      { uid: 'u3', firstName: 'Jo', lastName: 'Smith', email: 'jo1@x.com' },
      { uid: 'u4', firstName: 'Jo', lastName: 'Smith', email: 'jo2@x.com' },
    ],
    invites: [{ targetUid: 'u2', targetEmail: 'B@x.com' }],
    staged: [{ name: 'S', email: 's@x.com' }, { name: 'A One', email: 'A@X.com' }],
    profiles: [{ id: 'p1', linkedUid: 'u1', emailKey: 'a@x.com' }],
  };
  it('reports exact, missing and duplicate-name cases without merging on name', () => {
    const r = reconcile(base);
    expect(r.exact.map((x) => x.uid)).toEqual(['u1']);
    expect(r.missing.map((x) => x.email).sort()).toEqual(['b@x.com', 'jo1@x.com', 'jo2@x.com', 's@x.com']);
    expect(r.duplicates.some((d) => d.reason.startsWith('same name'))).toBe(true);
    expect(r.counts.people).toBe(5);
  });
  it('flags a profile matched to a different account, and double matches, as ambiguous', () => {
    const r = reconcile({ ...base, profiles: [
      { id: 'p1', linkedUid: 'someone-else', emailKey: 'a@x.com' },
      { id: 'p2', linkedUid: 'u2' }, { id: 'p3', linkedUid: 'u2' },
    ] });
    expect(r.ambiguous.map((x) => x.uid).sort()).toEqual(['u1', 'u2']);
  });
  it('flags the same email on two different accounts as a duplicate', () => {
    const r = reconcile({ officeId: 'hph', users: [{ uid: 'u1', email: 'a@x.com' }], invites: [{ targetUid: 'u9', targetEmail: 'a@x.com' }] });
    expect(r.duplicates[0].reason).toMatch(/same email/);
  });
  it('the script has no write path or execute flag', () => {
    const src = readFileSync('scripts/reconcile-office-agents.js', 'utf8'); // the only file that touches Firestore
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\.(set|update|delete|add|create|batch|runTransaction)\(/);
    expect(() => require('../../scripts/reconcile-office-agents').parseArgs(['--office', 'x', '--execute'])).toThrow();
  });
});

describe('reconciliation script is read-only, notification-free and minimises personal data', () => {
  const { readOnlyDb, redactReport, maskEmail, maskName } = require('../../scripts/lib/officeAgentReconcile');
  const script = require('../../scripts/reconcile-office-agents');

  const fakeDb = (data) => {
    const writes = [];
    const col = (name) => {
      const mk = (filters) => ({
        where: (f, op, v) => mk([...filters, [f, op, v]]),
        get: async () => ({ docs: Object.entries(data[name] || {}).filter(([, d]) => filters.every(([f, op, v]) => (op === 'in' ? v.includes(d[f]) : d[f] === v))).map(([id, d]) => ({ id, data: () => d })) }),
        doc: (id) => ({ get: async () => ({ exists: !!(data[name] || {})[id], id, data: () => (data[name] || {})[id] }), set: async () => writes.push('set'), update: async () => writes.push('update'), delete: async () => writes.push('delete') }),
        add: async () => writes.push('add'), set: async () => writes.push('set'),
      });
      return mk([]);
    };
    return { db: { collection: col, batch: () => writes.push('batch'), runTransaction: async () => writes.push('tx') }, writes };
  };

  it('any write-like call throws, on the database, a collection, or a document', async () => {
    const { db, writes } = fakeDb({ users: { u1: { officeId: 'o' } } });
    const ro = readOnlyDb(db);
    expect(() => ro.collection('users').add({})).toThrow(/not allowed/);
    expect(() => ro.collection('users').doc('u1').set({})).toThrow(/not allowed/);
    expect(() => ro.collection('users').doc('u1').update({})).toThrow(/not allowed/);
    expect(() => ro.collection('users').doc('u1').delete()).toThrow(/not allowed/);
    expect(() => ro.collection('users').where('officeId', '==', 'o').add({})).toThrow(/not allowed/);
    expect(writes).toEqual([]);
    expect((await ro.collection('users').doc('u1').get()).exists).toBe(true);
  });
  it('only the allowlisted collections can be opened — never offers, properties, billing or buyers', () => {
    const { db } = fakeDb({});
    const ro = readOnlyDb(db);
    for (const c of ['offers', 'properties', 'propertyCharges', 'settings', 'notifications', 'emailLog', 'buyerProfiles', 'likes']) expect(() => ro.collection(c)).toThrow(/allowlist/);
    for (const c of ['users', 'officeInvites', 'officeAgents', 'officeImports', 'agents', 'officeAdminInfo']) expect(() => ro.collection(c)).not.toThrow();
  });
  it('the script imports no service, email or notification code', () => {
    const src = readFileSync('scripts/reconcile-office-agents.js', 'utf8');
    const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    expect(requires.sort()).toEqual(['./activate-leadership', './lib/officeAgentReconcile', 'firebase-admin/app', 'firebase-admin/firestore']);
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/resend|sendEmail|notification|src\/app/i);
  });
  it('end to end against a fake database: writes nothing, reads only allowlisted collections, prints no names, phones or full emails', async () => {
    const { db, writes } = fakeDb({
      officeAdminInfo: { hph: { name: 'Harcourts Property Hub', status: 'active' } },
      users: { u1: { officeId: 'hph', firstName: 'Ann', lastName: 'Active', email: 'ann.active@hph.com', phone: '0411 111 111', avatar: 'https://cdn/x.jpg' }, u2: { officeId: 'hph', firstName: 'Bob', lastName: 'Builder', email: 'bob@hph.com', accountStatus: 'invited' } },
      officeAgents: { p1: { officeId: 'hph', linkedUid: 'u1', fullName: 'Ann Active', phone: '0411 111 111', contactEmail: 'ann.pro@elsewhere.com' } },
      officeInvites: {}, officeImports: {}, agents: {},
    });
    const { office, report } = await script.run(db, { officeName: '  harcourts   PROPERTY hub ' });
    const text = JSON.stringify({ office, report });
    expect(office.id).toBe('hph');
    expect(writes).toEqual([]);
    expect(report.counts).toMatchObject({ people: 2, exact: 1, missing: 1 });
    expect(text).not.toMatch(/Ann|Bob|Active|Builder|0411|cdn\/x|ann\.active@|bob@hph|ann\.pro|elsewhere/);
    expect(text).toMatch(/a\*\*\*@hph\.com/);
  });
  it('stops unless exactly one active office matches the name', async () => {
    const two = fakeDb({ officeAdminInfo: { a: { name: 'Twin Realty', status: 'active' }, b: { name: 'twin realty', status: 'active' } } });
    await expect(script.run(two.db, { officeName: 'Twin Realty' })).rejects.toThrow(/exactly one/);
    const none = fakeDb({ officeAdminInfo: { a: { name: 'Someone Else', status: 'active' } } });
    await expect(script.run(none.db, { officeName: 'Twin Realty' })).rejects.toThrow(/found 0/);
    await expect(script.run(none.db, { office: 'missing-id' })).rejects.toThrow(/No office/);
    expect(() => script.parseArgs([])).toThrow();
    expect(() => script.parseArgs(['--office', 'a', '--office-name', 'b'])).toThrow();
  });
  it('masking helpers', () => {
    expect(maskEmail('jane.doe@harcourts.com.au')).toBe('j***@harcourts.com.au');
    expect(maskEmail('')).toBeNull();
    expect(maskName('jo smith')).toBe('J. S.');
    const r = redactReport({ officeId: 'o', counts: {}, exact: [], missing: [], ambiguous: [], duplicates: [{ reason: 'same name', name: 'jo smith', emails: ['a@x.com'], uids: ['1'] }], notes: [] });
    expect(JSON.stringify(r)).not.toMatch(/jo smith|a@x\.com/);
  });
});
