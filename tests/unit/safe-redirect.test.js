import { describe, it, expect, vi } from 'vitest';
import { getSafeReturnTo, resolveLoginRedirect } from '../../src/app/utils/safeRedirect';

describe('getSafeReturnTo — open-redirect protection for login\'s returnTo param', () => {
  it('allows a plain relative path', () => {
    expect(getSafeReturnTo('/dashboard')).toBe('/dashboard');
  });

  it('allows a relative path with a query string (the office-invite use case)', () => {
    const value = '/office-invite?token=abc123';
    expect(getSafeReturnTo(value)).toBe(value);
  });

  it('returns null for empty/missing input', () => {
    expect(getSafeReturnTo('')).toBeNull();
    expect(getSafeReturnTo(null)).toBeNull();
    expect(getSafeReturnTo(undefined)).toBeNull();
  });

  it('SECURITY: rejects an absolute external URL', () => {
    expect(getSafeReturnTo('https://evil.example.com')).toBeNull();
    expect(getSafeReturnTo('http://evil.example.com/phish')).toBeNull();
  });

  it('SECURITY: rejects a protocol-relative URL (//evil.example.com)', () => {
    expect(getSafeReturnTo('//evil.example.com')).toBeNull();
  });

  it('SECURITY: rejects a value embedding an absolute URL anywhere in it', () => {
    expect(getSafeReturnTo('/ok?next=https://evil.example.com')).toBeNull();
  });

  it('SECURITY: rejects javascript: and other non-http(s) schemes', () => {
    expect(getSafeReturnTo('javascript:alert(1)')).toBeNull();
  });

  it('SECURITY: rejects a value containing a backslash (browser URL-normalization bypass)', () => {
    expect(getSafeReturnTo('/\\evil.example.com')).toBeNull();
    expect(getSafeReturnTo('/ok\\..\\evil')).toBeNull();
  });

  it('SECURITY: rejects a value that does not start with a slash', () => {
    expect(getSafeReturnTo('evil.example.com')).toBeNull();
    expect(getSafeReturnTo('dashboard')).toBeNull();
  });

  it('SECURITY: rejects a non-string value', () => {
    expect(getSafeReturnTo(123)).toBeNull();
    expect(getSafeReturnTo({})).toBeNull();
  });
});

describe('resolveLoginRedirect — the one decision login/page.js\'s redirect effect delegates to', () => {
  const defaultDashboardFor = vi.fn(() => '/dashboard');

  it('returns null while auth is still loading, even with user set', () => {
    expect(resolveLoginRedirect({ authLoading: true, user: { uid: '1' }, userData: null, safeReturnTo: null, defaultDashboardFor })).toBeNull();
  });

  it('returns null with no user at all', () => {
    expect(resolveLoginRedirect({ authLoading: false, user: null, userData: null, safeReturnTo: '/office-invite?token=x', defaultDashboardFor })).toBeNull();
  });

  it('REGRESSION (fresh login): redirects to a valid returnTo the INSTANT user is set, without waiting for userData — this is the actual login-submit path, not just "already authenticated on page load"', () => {
    const destination = resolveLoginRedirect({
      authLoading: false,
      user: { uid: '1' }, // just signed in — userData's own Firestore fetch hasn't resolved yet
      userData: null,
      safeReturnTo: '/office-invite?token=abc123',
      defaultDashboardFor,
    });
    expect(destination).toBe('/office-invite?token=abc123');
    expect(defaultDashboardFor).not.toHaveBeenCalled(); // never needed for the returnTo case
  });

  it('also redirects to returnTo when the user was ALREADY authenticated on page load (userData already present) — same destination either way', () => {
    const destination = resolveLoginRedirect({
      authLoading: false,
      user: { uid: '1' },
      userData: { roles: ['agent'] },
      safeReturnTo: '/office-invite?token=abc123',
      defaultDashboardFor,
    });
    expect(destination).toBe('/office-invite?token=abc123');
  });

  it('with no returnTo, waits for userData before deciding (still needed to tell a buyer from an agent)', () => {
    expect(resolveLoginRedirect({ authLoading: false, user: { uid: '1' }, userData: null, safeReturnTo: null, defaultDashboardFor })).toBeNull();
  });

  it('with no returnTo and userData present, defers to defaultDashboardFor', () => {
    const destination = resolveLoginRedirect({ authLoading: false, user: { uid: '1' }, userData: { roles: ['agent'] }, safeReturnTo: null, defaultDashboardFor });
    expect(destination).toBe('/dashboard');
    expect(defaultDashboardFor).toHaveBeenCalledWith({ roles: ['agent'] });
  });
});

describe('REGRESSION: the previously-unvalidated returnTo sink (buyer-dashboard/welcome) and its pass-through (signup) both now route through getSafeReturnTo', () => {
  // Source-inspection, same style already used by brand-style.test.js
  // for its own "default fallback values" guarantees — this doesn't
  // replace getSafeReturnTo's own direct test coverage above; it
  // specifically guards against someone re-introducing a RAW,
  // unvalidated searchParams.get('returnTo') at either call site
  // without that showing up as a behavioural test failure anywhere
  // else (there's no component-test harness in this codebase to
  // exercise router.replace() calls directly).
  it('signup/page.js never uses the raw returnTo param directly — it always goes through getSafeReturnTo first', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/app/signup/page.js', import.meta.url), 'utf-8');
    expect(source).toContain("import { getSafeReturnTo } from '../utils/safeRedirect'");
    expect(source).not.toMatch(/const returnTo = searchParams\.get\('returnTo'\) \|\| ''/);
    expect(source).toMatch(/getSafeReturnTo\(searchParams\.get\('returnTo'\)\)/);
  });

  it('buyer-dashboard/welcome/page.js (the actual router.replace() sink) never uses the raw returnTo param directly either', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/app/buyer-dashboard/welcome/page.js', import.meta.url), 'utf-8');
    expect(source).toContain("import { getSafeReturnTo } from '../../utils/safeRedirect'");
    expect(source).not.toMatch(/const returnTo = searchParams\.get\('returnTo'\) \|\| ''/);
    expect(source).toMatch(/getSafeReturnTo\(searchParams\.get\('returnTo'\)\)/);
    // Still reachable via router.replace(returnTo || '/buyer-dashboard')
    // at two call sites — both now safe because `returnTo` itself can
    // only ever be a validated value or empty string by this point.
    expect(source.match(/router\.replace\(returnTo \|\| '\/buyer-dashboard'\)/g)?.length).toBe(2);
  });
});
