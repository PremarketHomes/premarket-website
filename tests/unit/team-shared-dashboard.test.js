import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Source-level guards for the shared team dashboard (dashboard/page.js wiring).
const read = (rel) => fs.readFileSync(new URL(`../../src/app/${rel}`, import.meta.url), 'utf-8');
const page = read('dashboard/page.js');
const card = page.slice(page.indexOf('function PropertyCard('), page.indexOf('// --- Billing Announcement Banner ---'));

describe('dashboard: shared team portfolio', () => {
  it('defaults to the All view with Mine / Team filters', () => {
    expect(page).toContain("useState('all'); // 'all' | 'mine' | 'team'");
    for (const label of ["'All'", "'Mine'", "'Team'"]) expect(page).toContain(label);
  });
  it('reads teammates only from the server-authorised team endpoint, for office-linked agents', () => {
    expect(page).toContain("authFetch('/api/teams/properties')");
    expect(page).toContain('const inOffice = !!userData?.officeId;');
    // no client-side query of anyone else's properties
    expect(page.match(/collection\(db, 'properties'\)/g)).toHaveLength(1);
    expect(page).toContain("where('userId', '==', user.uid)");
  });
  it('merges through the de-duplicating helper and computes stats from the merged view', () => {
    expect(page).toContain('teamPropertiesFrom(teamRows, properties, user?.uid)');
    expect(page).toContain('listForView(view, properties, teamProperties)');
    expect(page).toContain('computeStats({');
    expect(page).toContain('stats.properties');
    expect(page).toContain('stats.opinions');
  });
  it('a failed or refused team call falls back to the agent\'s own properties, and membership is re-checked on focus', () => {
    expect(page).toMatch(/catch \(err\) \{[^}]*setTeamRows\(\[\]\)/);
    expect(page).toContain("document.addEventListener('visibilitychange', onVisible)");
    expect(page).toContain("const view = hasTeamListings ? teamView : 'mine';");
  });
  it('the dashboard stays personal: greeting still comes from the signed-in user\'s own data', () => {
    expect(page).toContain("const userName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || user?.displayName || 'there';");
    expect(page).not.toMatch(/teamRows[^\n]*userName|listedBy[^\n]*Welcome/);
  });
});

describe('property card: teammates are read-only, with a "Listed by" label', () => {
  it('labels every card when a team portfolio is shown', () => {
    expect(card).toContain("Listed by {isTeamListing ? property.listedBy : 'you'}");
    expect(card).toContain('{showListedBy && (');
  });
  it('hides Edit and the hide-from-archive action for teammates\' properties, keeping View Report', () => {
    expect(card).toContain('const isTeamListing = property.isTeamListing === true;');
    expect(card).toMatch(/\{!isTeamListing && \(\s*<Link\s+href=\{`\/dashboard\/edit\/\$\{property\.id\}`\}/);
    expect(card).toContain('{!isTeamListing && isArchived && !isSold && onHide && (');
    expect(card).toContain('href={`/dashboard/property/${property.id}`}');
    expect(card).toContain('View Report');
  });
  it('the card never writes anything (visibility/archive handlers are not wired into it)', () => {
    expect(card).not.toMatch(/updateDoc|deleteDoc|setDoc|onToggleVisibility\(|onArchive\(/);
  });
});
