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
