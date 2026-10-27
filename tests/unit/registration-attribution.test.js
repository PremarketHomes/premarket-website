// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { shouldLinkAccount, resolveBuyerIdentity, profileForRegistration, normalizeEmail } from '../../src/app/utils/registrationIdentity';

// ── pure rules ───────────────────────────────────────────────────────────
describe('shouldLinkAccount (attribution)', () => {
  it('links when the typed email is the account email', () => {
    expect(shouldLinkAccount({ typedEmail: 'luke@example.com', accountEmail: 'luke@example.com' })).toBe(true);
  });
  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(shouldLinkAccount({ typedEmail: '  Luke@Example.COM ', accountEmail: 'luke@example.com' })).toBe(true);
    expect(shouldLinkAccount({ typedEmail: 'luke@example.com', accountEmail: ' LUKE@EXAMPLE.COM\n' })).toBe(true);
  });
  it('does NOT link a different email (the Hannah/Luke case)', () => {
    expect(shouldLinkAccount({ typedEmail: 'lukejwilson15@gmail.com', accountEmail: 'hannah@premarket.homes' })).toBe(false);
  });
  it('does not link on a near-match (only exact, normalised equality counts)', () => {
    expect(shouldLinkAccount({ typedEmail: 'luke+1@example.com', accountEmail: 'luke@example.com' })).toBe(false);
    expect(shouldLinkAccount({ typedEmail: 'luke@example.co', accountEmail: 'luke@example.com' })).toBe(false);
  });
  it.each([['', 'a@b.c'], ['a@b.c', ''], ['', ''], [null, 'a@b.c'], ['a@b.c', undefined], ['   ', '   ']])(
    'never links when either email is missing (%j vs %j)', (typedEmail, accountEmail) => {
      expect(shouldLinkAccount({ typedEmail, accountEmail })).toBe(false);
    });
  it('normalizeEmail tolerates non-strings', () => { expect(normalizeEmail(undefined)).toBe(''); expect(normalizeEmail(42)).toBe(''); });
});

describe('resolveBuyerIdentity (display precedence)', () => {
  const hannah = { firstName: 'Hannah', lastName: 'Loadsman', email: 'hannah@premarket.homes', phone: '0411 111 111', buyerPreferences: { locations: ['Gold Coast'] } };

  it('REGRESSION: typed details win over a mismatched linked account (the reported bug)', () => {
    const offer = { buyerName: 'Luke Wilson', buyerEmail: 'lukejwilson15@gmail.com', buyerPhone: '0400 000 000', userId: 'hannah' };
    expect(resolveBuyerIdentity(offer, hannah)).toEqual({ name: 'Luke Wilson', email: 'lukejwilson15@gmail.com', phone: '0400 000 000' });
  });
  it('a mismatched account never fills a missing field (no Hannah phone on Luke)', () => {
    const offer = { buyerName: 'Luke Wilson', buyerEmail: 'luke@example.com', userId: 'hannah' }; // no phone typed
    expect(resolveBuyerIdentity(offer, hannah)).toEqual({ name: 'Luke Wilson', email: 'luke@example.com', phone: null });
    expect(profileForRegistration(offer, hannah)).toBeNull(); // so Hannah's buyer preferences are not shown either
  });
  it('the SAME person: typed details win, the profile fills the gaps (missing fields)', () => {
    const buyer = { firstName: 'Bea', lastName: 'Buyer', email: 'bea@example.com', phone: '0422 222 222' };
    const offer = { buyerName: 'Bea B', buyerEmail: 'BEA@example.com', userId: 'b' }; // no phone typed, email differs only by case
    expect(resolveBuyerIdentity(offer, buyer)).toEqual({ name: 'Bea B', email: 'BEA@example.com', phone: '0422 222 222' });
    expect(profileForRegistration(offer, buyer)).toBe(buyer);
  });
  it('account-only registration (nothing typed): the profile is used, as before', () => {
    const buyer = { firstName: 'Bea', lastName: 'Buyer', email: 'bea@example.com', phone: '0422 222 222' };
    expect(resolveBuyerIdentity({ userId: 'b' }, buyer)).toEqual({ name: 'Bea Buyer', email: 'bea@example.com', phone: '0422 222 222' });
    expect(resolveBuyerIdentity({ userId: 'b' }, { firstName: 'Bea' }).name).toBe('Bea');
  });
  it('logged-out registration (no profile): typed details only; blank/whitespace fields are missing', () => {
    expect(resolveBuyerIdentity({ buyerName: '  ', buyerEmail: 'x@y.z', buyerPhone: '' , userName: 'Fallback'}, null))
      .toEqual({ name: 'Fallback', email: 'x@y.z', phone: null });
    expect(resolveBuyerIdentity({}, null)).toEqual({ name: null, email: null, phone: null });
  });
});

// ── vendor "Send Report" email ───────────────────────────────────────────
function makeDb(seed) {
  const col = (name) => ({
    doc: (id) => ({ id, async get() { const d = seed[name]?.[id]; return { exists: !!d, id, data: () => d }; } }),
    where() {
      const q = { where: () => q, orderBy: () => q, limit: () => q,
        async get() { const rows = Object.entries(seed[name] || {}); return { docs: rows.map(([id, d]) => ({ id, data: () => d })), size: rows.length, empty: !rows.length }; } };
      return q;
    },
    async get() { const rows = Object.entries(seed[name] || {}); return { docs: rows.map(([id, d]) => ({ id, data: () => d })), size: rows.length }; },
  });
  return { collection: col };
}
let reportDb;
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, p) => reportDb[p] }) }));
vi.mock('resend', () => ({ Resend: class { get emails() { return { send: vi.fn(async () => ({ id: 'x' })) }; } } }));

describe('vendor Send Report: serious buyer details', () => {
  const seed = {
    properties: { p1: { userId: 'agent1', price: '1000000', formattedAddress: '1 Greenwich Ave' } },
    users: { hannah: { firstName: 'Hannah', lastName: 'Loadsman', email: 'hannah@premarket.homes', phone: '0411 111 111', buyerPreferences: { locations: ['Gold Coast'] } } },
    offers: { o1: { propertyId: 'p1', type: 'opinion', serious: true, userId: 'hannah', buyerName: 'Luke Wilson', buyerEmail: 'lukejwilson15@gmail.com', buyerPhone: '0400 000 000', offerAmount: 900000 } },
    likes: {},
  };
  it('REGRESSION: the vendor report shows the typed buyer (Luke), not the logged-in account (Hannah)', async () => {
    reportDb = makeDb(seed);
    const { buildReport } = await import('../../src/app/api/services/reportService');
    const report = await buildReport('p1');
    expect(report.seriousBuyerDetails).toHaveLength(1);
    const b = report.seriousBuyerDetails[0];
    expect(b).toMatchObject({ name: 'Luke Wilson', email: 'lukejwilson15@gmail.com', phone: '0400 000 000' });
    expect(JSON.stringify(report.seriousBuyerDetails)).not.toMatch(/Hannah|premarket\.homes|0411/);
    expect(b.preferredLocations).toEqual([]);
  });
  it('a genuine logged-in buyer (same email) still gets their profile preferences', async () => {
    reportDb = makeDb({ ...seed, offers: { o1: { ...seed.offers.o1, buyerName: 'Hannah L', buyerEmail: 'HANNAH@premarket.homes', buyerPhone: undefined } } });
    const { buildReport } = await import('../../src/app/api/services/reportService');
    const b = (await buildReport('p1')).seriousBuyerDetails[0];
    expect(b.name).toBe('Hannah L');
    expect(b.phone).toBe('0411 111 111'); // missing typed phone filled from the SAME person's profile
    expect(b.preferredLocations).toEqual(['Gold Coast']);
  });
});

// ── the real form: what gets written to Firestore ────────────────────────
const writes = { add: [], update: [] };
let authState;
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('propertyId=prop1'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/find-property',
  useParams: () => ({ id: 'prop1' }),
}));
vi.mock('../../src/app/context/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../../src/app/firebase/clientApp', () => ({ db: {}, auth: {} }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: null }) }));
const DELETE = Symbol('deleteField');
vi.mock('firebase/firestore', () => ({
  doc: (_d, col, id) => ({ col, id }), collection: (_d, name) => ({ name }),
  getDoc: async () => ({ exists: () => true, id: 'prop1', data: () => ({ userId: 'agent1', price: '1000000', formattedAddress: '1 Greenwich Ave', visibility: true, active: true }) }),
  addDoc: async (c, data) => { writes.add.push({ col: c.name, data }); return { id: 'newOffer1' }; },
  updateDoc: async (ref, data) => { writes.update.push({ ref, data }); },
  serverTimestamp: () => 'TS', deleteField: () => DELETE,
  getDocs: async () => ({ docs: [] }), query: (c) => c, where: () => ({}), orderBy: () => ({}), limit: () => ({}),
  setDoc: vi.fn(), onSnapshot: () => () => {}, increment: (n) => n, arrayUnion: (...a) => a, Timestamp: { now: () => ({}) },
}));
vi.mock('../../src/app/utils/previewEnvironment', () => ({ isPreviewDeployment: () => false }));
vi.mock('../../src/app/utils/fetchAgentProfiles', () => ({ fetchAgentProfiles: async () => ({ agent1: { firstName: 'Phil', lastName: 'Chillemi', phone: '0400 123 456' } }) }));
vi.mock('next/font/google', () => { const f = () => ({ className: 'font', variable: 'font-var', style: {} }); return { Playfair_Display: f }; });
vi.mock('next/image', () => ({ default: ({ alt }) => React.createElement('img', { alt }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }) => React.createElement('a', { href, ...r }, children) }));
vi.mock('framer-motion', () => {
  const passthrough = new Proxy({}, { get: (_, tag) => ({ children, ...p }) => React.createElement(tag === 'create' ? 'div' : tag, Object.fromEntries(Object.entries(p).filter(([k]) => !/^(initial|animate|exit|transition|variants|whileHover|whileTap|layout)/.test(k))), children) });
  return { motion: passthrough, AnimatePresence: ({ children }) => children };
});

describe('registration form: when is the signed-in account linked?', () => {
  beforeEach(() => {
    writes.add.length = 0; writes.update.length = 0;
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ offerId: null, offerAmount: null, count: 0, sent: true }) }));
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/find-property', search: '?propertyId=prop1', href: 'http://localhost/find-property?propertyId=prop1' } });
    Element.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn();
  });
  afterEach(cleanup);

  const open = async () => {
    const Page = (await import('../../src/app/components/PropertyPageClient')).default;
    render(React.createElement(Page, { propertyId: 'prop1', initialProperty: null }));
  };

  const fillAndSubmit = async ({ first = 'Luke', last = 'Wilson', mail = 'lukejwilson15@gmail.com', phone = '0400 000 000' } = {}) => {
    // "Already know this is for you? Register your interest" — opens the registration form directly
    fireEvent.click(await screen.findByRole('button', { name: /already know this is for you/i }));
    const emailInput = await screen.findByPlaceholderText('john@example.com');
    const form = emailInput.closest('form');
    fireEvent.change(screen.getByPlaceholderText('John'), { target: { value: first } });
    fireEvent.change(screen.getByPlaceholderText('Doe'), { target: { value: last } });
    fireEvent.change(emailInput, { target: { value: mail } });
    fireEvent.change(form.querySelector('input[placeholder="0400 000 000"]'), { target: { value: phone } });
    fireEvent.submit(form);
  };

  it('REGRESSION: signed in as Hannah, typing Luke\'s details saves them WITHOUT Hannah\'s userId', async () => {
    authState = { user: { uid: 'hannah', email: 'hannah@premarket.homes' }, userData: { agent: true }, loading: false };
    await open(); await fillAndSubmit();
    await waitFor(() => expect(writes.add.length + writes.update.length).toBeGreaterThan(0));
    const data = (writes.add[0] || writes.update[0]).data;
    expect(data.buyerEmail).toBe('lukejwilson15@gmail.com');
    expect(data.buyerName).toBe('Luke Wilson');
    expect(data.serious).toBe(true);
    expect('userId' in data).toBe(false);
  });

  it('a genuine logged-in buyer registering with their own email is still linked (case/whitespace insensitive)', async () => {
    authState = { user: { uid: 'buyer1', email: 'Bea@Example.com' }, userData: { isBuyer: true }, loading: false };
    await open(); await fillAndSubmit({ first: 'Bea', last: 'Buyer', mail: '  bea@example.com ', phone: '0422 222 222' });
    await waitFor(() => expect(writes.add.length + writes.update.length).toBeGreaterThan(0));
    expect((writes.add[0] || writes.update[0]).data.userId).toBe('buyer1');
  });

  it('a logged-out registration is unchanged: typed details, no userId', async () => {
    authState = { user: null, userData: null, loading: false };
    await open(); await fillAndSubmit();
    await waitFor(() => expect(writes.add.length + writes.update.length).toBeGreaterThan(0));
    const data = (writes.add[0] || writes.update[0]).data;
    expect(data.buyerEmail).toBe('lukejwilson15@gmail.com');
    expect('userId' in data).toBe(false);
  });
});

describe('guard rails', () => {
  it('anonymous opinions are untouched: the opinion write path never sets userId', () => {
    const src = fs.readFileSync('src/app/components/PropertyPageClient.js', 'utf-8');
    const opinion = src.slice(src.indexOf("const offerData = {\n        type: 'opinion',"), src.indexOf("const offerData = {\n        type: 'opinion',") + 400);
    expect(opinion).not.toContain('userId');
  });
  it('the CRM contact computation still keys on the typed email (not touched)', () => {
    const src = fs.readFileSync('src/app/api/v1/contactComputation.js', 'utf-8');
    expect(src).toContain('data.email || data.buyerEmail');
  });
});
