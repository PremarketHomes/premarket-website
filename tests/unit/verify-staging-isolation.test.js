import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { evaluate, parseArgs } = require('../../scripts/verify-staging-isolation');

const good = { serverProjectId: 'stg-1', clientProjectId: 'stg-1', clientMatchesServer: true, pointsAtLiveBackend: false, teamRegistrationsEnabled: false, emailGuard: { active: true, allowlistEntries: 1 }, storageZone: 'premarket-staging' };
const ok = (f) => evaluate(f).every((c) => c.ok);

describe('staging isolation verifier', () => {
  it('passes only when credential, browser config and the running deployment all agree on staging', () => {
    expect(ok({ project: 'stg-1', serviceAccountProject: 'stg-1', webConfigProject: 'stg-1', environment: good })).toBe(true);
  });
  it('fails if the target is the live project', () => {
    expect(ok({ project: 'premarket-homes', environment: { ...good, serverProjectId: 'premarket-homes', clientProjectId: 'premarket-homes' } })).toBe(false);
  });
  it('fails on any mismatch: credential, browser config, server project, client project or live backend', () => {
    const base = { project: 'stg-1', serviceAccountProject: 'stg-1', webConfigProject: 'stg-1', environment: good };
    expect(ok({ ...base, serviceAccountProject: 'premarket-homes' })).toBe(false);
    expect(ok({ ...base, webConfigProject: 'premarket-homes' })).toBe(false);
    expect(ok({ ...base, environment: { ...good, serverProjectId: 'premarket-homes' } })).toBe(false);
    expect(ok({ ...base, environment: { ...good, clientProjectId: 'premarket-homes (default)', clientMatchesServer: false } })).toBe(false);
    expect(ok({ ...base, environment: { ...good, pointsAtLiveBackend: true } })).toBe(false);
  });
  it('fails if safeguards are off or the live storage zone is in use', () => {
    const base = { project: 'stg-1', environment: good };
    expect(ok({ ...base, environment: { ...good, teamRegistrationsEnabled: true } })).toBe(false);
    expect(ok({ ...base, environment: { ...good, emailGuard: { active: false } } })).toBe(false);
    expect(ok({ ...base, environment: { ...good, storageZone: 'premarketvideos (default)' } })).toBe(false);
  });
  it('rejects unknown arguments', () => { expect(() => parseArgs(['--seed'])).toThrow(); });
});
