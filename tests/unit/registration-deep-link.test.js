// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { render, cleanup, waitFor } from '@testing-library/react';

const sentEmails = [];
vi.mock('resend', () => ({
  Resend: class {
    get emails() { return { send: vi.fn(async (payload) => { sentEmails.push(payload); return { id: 'mock-id' }; }) }; }
  },
}));

const replace = vi.fn();
const stableRouter = { push: vi.fn(), replace };
vi.mock('next/navigation', () => ({ useRouter: () => stableRouter }));
let authState;
vi.mock('../../src/app/context/AuthContext', () => ({ useAuth: () => authState }));

import { buildRegistrationPath } from '../../src/app/utils/registrationLink';
import { buildLoginUrl, loginUrlForCurrentPage } from '../../src/app/utils/loginRedirect';
import { getSafeReturnTo, resolveLoginRedirect } from '../../src/app/utils/safeRedirect';
import { getRegistrationIdFromSearch, findRegistration, registrationElementId, HIGHLIGHT_SCROLL_DELAYS } from '../../src/app/utils/registrationHighlight';
import { useRequireAgent } from '../../src/app/hooks/useRequireAgent';

const setLocation = (pathname, search = '') =>
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname, search } });

afterEach(cleanup);

describe('"View Registration" email link', () => {
  beforeEach(() => { sentEmails.length = 0; });

  it('points at the property report AND the exact registration, in the HTML and plain-text bodies', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'phil@example.com', agentFirstName: 'Phil', propertyAddress: '1 Greenwich Ave',
      propertyId: 'prop1abc', offerId: 'OFFER_ID_123', buyerName: 'Jane Buyer', buyerEmail: 'jane@example.com',
      buyerPhone: '0400 000 000', nextAction: 'contact',
    });
    const url = 'https://premarket.homes/dashboard/property/prop1abc?registration=OFFER_ID_123';
    expect(sentEmails[0].html).toContain(url);
    expect(sentEmails[0].text).toContain(url);
  });

  it('puts only opaque ids in the URL — no buyer name, email or phone', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'a@example.com', propertyAddress: 'X', propertyId: 'prop1abc', offerId: 'OFFER_ID_123',
      buyerName: 'Jane Buyer', buyerEmail: 'jane@example.com', buyerPhone: '0400000000', nextAction: 'contact',
    });
    const link = sentEmails[0].text.split('\n').find((l) => l.includes('/dashboard/property/'));
    for (const pii of ['Jane', 'jane@', '0400', 'Buyer']) expect(link).not.toContain(pii);
  });

  it('still produces a working report link if no offer id is available (never a broken URL)', () => {
    expect(buildRegistrationPath('prop1abc')).toBe('/dashboard/property/prop1abc');
    expect(buildRegistrationPath('prop1abc', 'OFFER_ID_123')).toBe('/dashboard/property/prop1abc?registration=OFFER_ID_123');
  });

  it('encodes ids so a crafted value cannot alter the path or add parameters', () => {
    expect(buildRegistrationPath('p/../x', 'a&admin=1')).toBe('/dashboard/property/p%2F..%2Fx?registration=a%26admin%3D1');
  });
});

describe('login keeps the destination (all dashboard deep links)', () => {
  it('buildLoginUrl round-trips the exact path + query through the login page\'s returnTo handling', () => {
    const dest = '/dashboard/property/prop1abc?registration=OFFER_ID_123';
    const loginUrl = buildLoginUrl(dest);
    expect(loginUrl.startsWith('/login?returnTo=')).toBe(true);
    const returned = new URL(loginUrl, 'https://premarket.homes').searchParams.get('returnTo');
    expect(returned).toBe(dest);
    expect(getSafeReturnTo(returned)).toBe(dest);
    // after a successful sign-in the login page sends them exactly there, not to a default dashboard
    expect(resolveLoginRedirect({ authLoading: false, user: { uid: 'u' }, userData: { agent: true }, safeReturnTo: getSafeReturnTo(returned), defaultDashboardFor: () => '/dashboard' })).toBe(dest);
  });

  it.each([
    ['//evil.example/phish'], ['https://evil.example'], ['javascript:alert(1)'], ['/\\evil.example'], ['relative/path'], [''], [null],
  ])('never builds an open-redirect returnTo for %s', (bad) => {
    expect(buildLoginUrl(bad)).toBe('/login');
  });

  it('never loops back to an auth page', () => {
    for (const p of ['/login', '/login?x=1', '/join', '/signup']) expect(buildLoginUrl(p)).toBe('/login');
  });

  it('loginUrlForCurrentPage uses the live path and query (works the same on mobile and desktop browsers)', () => {
    setLocation('/dashboard/property/prop1abc', '?registration=OFFER_ID_123');
    expect(decodeURIComponent(loginUrlForCurrentPage().split('returnTo=')[1])).toBe('/dashboard/property/prop1abc?registration=OFFER_ID_123');
    setLocation('/dashboard/crm', '');
    expect(decodeURIComponent(loginUrlForCurrentPage().split('returnTo=')[1])).toBe('/dashboard/crm');
  });
});

describe('useRequireAgent (guard used by every agent dashboard page)', () => {
  const Probe = () => { useRequireAgent(); return null; };
  beforeEach(() => { replace.mockClear(); setLocation('/dashboard/property/prop1abc', '?registration=OFFER_ID_123'); });

  it('logged out: sends the visitor to LOGIN (never the sign-up form) with the page to return to', async () => {
    authState = { user: null, userData: null, loading: false };
    render(React.createElement(Probe));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const dest = replace.mock.calls[0][0];
    expect(dest.startsWith('/login?returnTo=')).toBe(true);
    expect(dest).not.toContain('/join');
    expect(decodeURIComponent(dest.split('returnTo=')[1])).toBe('/dashboard/property/prop1abc?registration=OFFER_ID_123');
  });

  it('does nothing while auth is still loading (no premature redirect on slow mobile connections)', () => {
    authState = { user: null, userData: null, loading: true };
    render(React.createElement(Probe));
    expect(replace).not.toHaveBeenCalled();
  });

  it('a signed-in agent is left alone; a buyer-only account is still sent to the buyer dashboard', async () => {
    authState = { user: { uid: 'a' }, userData: { agent: true }, loading: false };
    render(React.createElement(Probe));
    expect(replace).not.toHaveBeenCalled();
    cleanup();
    authState = { user: { uid: 'b' }, userData: { isBuyer: true, roles: ['buyer'] }, loading: false };
    render(React.createElement(Probe));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/buyer-dashboard'));
  });
});

describe('every dashboard page keeps the destination', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk('src/app/dashboard').filter((f) => f.endsWith('.js'));

  it('no /dashboard/* page redirects a logged-out visitor to a bare /login or the /join sign-up form', () => {
    const offenders = files.filter((f) => /router\.(push|replace)\(['"]\/(login|join)['"]\)/.test(fs.readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });
  it('the shared guard hook uses the helper', () => {
    const hook = fs.readFileSync('src/app/hooks/useRequireAgent.js', 'utf-8');
    expect(hook).toContain('loginUrlForCurrentPage()');
    expect(hook).not.toMatch(/router\.replace\(['"]\/login['"]\)/);
  });
});

describe('registration highlight helpers', () => {
  it('reads only well-formed opaque ids from the query string', () => {
    expect(getRegistrationIdFromSearch('?registration=OFFER_ID_123')).toBe('OFFER_ID_123');
    expect(getRegistrationIdFromSearch('?x=1&registration=abc-DEF_123456')).toBe('abc-DEF_123456');
    for (const bad of ['', '?registration=', '?registration=ab', '?registration="><script>', '?registration=a b c d e f', null, undefined]) {
      expect(getRegistrationIdFromSearch(bad)).toBeNull();
    }
  });
  it('only a registered (serious) buyer on THIS listing can be highlighted', () => {
    const ops = [{ id: 'A_REG_0001', serious: true }, { id: 'B_ANON_001', serious: false }];
    expect(findRegistration(ops, 'A_REG_0001')).toBe(ops[0]);
    expect(findRegistration(ops, 'B_ANON_001')).toBeNull();
    expect(findRegistration(ops, 'NOT_THERE_1')).toBeNull();
    expect(findRegistration(ops, null)).toBeNull();
  });
  it('rescrolls a few times for layout shifts, starting immediately', () => {
    expect(HIGHLIGHT_SCROLL_DELAYS[0]).toBe(0);
    expect(HIGHLIGHT_SCROLL_DELAYS.length).toBeGreaterThanOrEqual(3);
    expect(registrationElementId('X')).toBe('registration-X');
  });
});
