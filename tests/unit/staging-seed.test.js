import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { assertStagingTarget, buildSeedPlan, plusAddress } = require('../../scripts/lib/stagingSeed');
const { parseArgs } = require('../../scripts/seed-staging');

describe('staging seed can never touch the live project', () => {
  it('refuses the live project id, mismatched credentials and live-pointing environment', () => {
    expect(() => assertStagingTarget({ projectId: 'premarket-homes' })).toThrow(/LIVE/);
    expect(() => assertStagingTarget({ projectId: '' })).toThrow();
    expect(() => assertStagingTarget({ projectId: 'premarket-staging', serviceAccountProjectId: 'premarket-homes' })).toThrow(/credentials/);
    expect(() => assertStagingTarget({ projectId: 'premarket-staging', env: { FIREBASE_PROJECT_ID: 'premarket-homes' } })).toThrow(/Refusing/);
    expect(() => assertStagingTarget({ projectId: 'premarket-staging', env: { GOOGLE_CLOUD_PROJECT: 'premarket-homes' } })).toThrow(/Refusing/);
    expect(() => assertStagingTarget({ projectId: 'premarket-staging', env: { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'premarket-homes' } })).toThrow(/live/);
    expect(assertStagingTarget({ projectId: 'premarket-staging', serviceAccountProjectId: 'premarket-staging', env: {} })).toBe(true);
  });
  it('is a dry run unless --execute is passed, and rejects unknown arguments', () => {
    expect(parseArgs(['--project', 'p', '--qa-email', 'a@b.co']).execute).toBe(false);
    expect(parseArgs(['--project', 'p', '--qa-email', 'a@b.co', '--execute']).execute).toBe(true);
    expect(() => parseArgs(['--prod'])).toThrow();
  });
});

describe('staging seed plan is entirely fake and covers the workspace scenarios', () => {
  const plan = buildSeedPlan({ qaEmail: 'qa@premarket.homes' });
  it('contains an office admin, a team creator, a member, an invited-never-logged-in agent, a plain agent and a leader', () => {
    const by = Object.fromEntries(plan.users.map((u) => [u.uid, u]));
    expect(by.stg_admin.isOfficeAdmin).toBe(true);
    expect(plan.office.info.officeAdminUids).toEqual(['stg_admin']);
    expect(plan.teams[0].createdBy).toBe('stg_teamlead');
    expect(by.stg_invited.accountStatus).toBe('invited');
    expect(by.stg_member.teamId).toBe('stg_team1');
    expect(by.stg_plain.teamId).toBeUndefined();
    expect(plan.office.info.leadershipUids).toEqual(['stg_leader']);
  });
  it('sends all test mail to one mailbox via plus-addressing and uses no real-looking agent data', () => {
    expect(plan.users.every((u) => /^qa\+[a-z-]+@premarket\.homes$/.test(u.email))).toBe(true);
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/propertyhubgc|harcourts|@gmail\.com/i);
    expect(plusAddress('QA@Premarket.Homes', 'x')).toBe('qa+x@premarket.homes');
    expect(() => plusAddress('not-an-email', 'x')).toThrow();
    expect(() => plusAddress('a+b@x.com', 'x')).toThrow();
  });
  it('sets its own billing settings (staging only) and a fake registration for the registrations screens', () => {
    expect(plan.settings.invoicing.billingActivatedAt).toBe('NOW');
    expect(plan.offers[0]).toMatchObject({ serious: true, buyerName: 'Fake Buyer' });
    expect(plan.properties[0].userId).toBe('stg_member');
  });
  it('the script never reads or writes anything without --execute and has no live project id as a target', () => {
    const src = readFileSync('scripts/seed-staging.js', 'utf8');
    expect(src).toContain("if (!args.execute) return console.log('\\nDry run only");
    expect(src).not.toMatch(/projectId:\s*['"]premarket-homes['"]/);
    expect(src).toContain("if (app.options.projectId === 'premarket-homes') throw");
  });
});
