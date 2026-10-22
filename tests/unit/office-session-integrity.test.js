import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Source-inspection guards (no component-test harness exists) for the
 * office session / roster / branding-prompt integrity fixes. The
 * service-level behaviour (createOffice refusing to re-home an
 * existing member, getOfficeForUser failing loudly, roster stability)
 * is covered with real logic in office-service.test.js.
 */
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');

describe('dashboard/office/page.js — never shows setup on loading or error', () => {
  const src = read('src/app/dashboard/office/page.js');

  it('waits for auth to finish initializing before loading (reload during auth init)', () => {
    expect(src).toMatch(/if \(authLoading \|\| !uid\) return;\s*loadAll\(\);/);
    expect(src).toMatch(/if \(authLoading \|\| loading\)/);
  });

  it('only a successful response with office:null reaches the setup form; failures show a retry state', () => {
    expect(src).toContain('if (officeRes.ok)');
    expect(src).toContain("throw new Error('office-load-failed')");
    expect(src.indexOf('if (loadFailed)')).toBeLessThan(src.indexOf('if (!office)'));
    expect(src).toContain('>Retry<');
  });

  it('a failed roster load keeps the previous roster instead of emptying it', () => {
    expect(src).toMatch(/else \{\s*\/\/ Keep whatever roster[\s\S]*?setError\('Could not load your agent roster/);
    expect(src).not.toMatch(/setAgents\(\[\]\)/);
  });
});

describe('dashboard/page.js — office members never get the agency-logo prompts (desktop or mobile)', () => {
  const src = read('src/app/dashboard/page.js');

  it('auto-opening logo modal skips office members', () => {
    expect(src).toMatch(/\(userData\.isAgent \|\| userData\.agent\) && !userData\.officeId && !userData\.logoUrl && !localStorage/);
  });

  it('floating logo nudge skips office members', () => {
    expect(src).toMatch(/\(userData\?\.isAgent \|\| userData\?\.agent\) && !userData\?\.officeId && !userData\?\.logoUrl && !showLogoModal/);
  });
});
