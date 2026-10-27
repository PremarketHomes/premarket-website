// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

// ── mocks ────────────────────────────────────────────────────────────────
const replace = vi.fn();
const push = vi.fn();
let authState;
const stableRouter = { push, replace }; // Next's real router is referentially stable
vi.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
  useParams: () => ({ id: 'prop1abc' }),
}));
vi.mock('../../src/app/context/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../../src/app/hooks/useRequireAgent', () => ({ useRequireAgent: () => {} }));
vi.mock('../../src/app/firebase/clientApp', () => ({ db: {}, auth: { name: 'auth' } }));
const firebaseSignOut = vi.fn(async () => {});
vi.mock('firebase/auth', () => ({ signOut: (...a) => firebaseSignOut(...a) }));
let propertyDoc; let ownOffers; let ownLikes;
let dataGate = Promise.resolve(); // await this before any Firestore read resolves
vi.mock('firebase/firestore', () => ({
  doc: (_db, col, id) => ({ col, id }),
  collection: (_db, name) => ({ name }),
  query: (c) => c,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  getDoc: async () => { await dataGate; return {} && ({ exists: () => !!propertyDoc, id: propertyDoc?.id, data: () => propertyDoc }); },
  getDocs: async (q) => {
    await dataGate;
    const rows = q.name === 'offers' ? ownOffers : q.name === 'likes' ? ownLikes : [];
    return { docs: rows.map((r) => ({ id: r.id, data: () => r })) };
  },
  onSnapshot: () => () => {},
  updateDoc: vi.fn(), deleteDoc: vi.fn(), serverTimestamp: () => 'TS', Timestamp: { now: () => ({}) },
}));
const authFetch = vi.fn();
vi.mock('../../src/app/utils/authFetch', () => ({ authFetch: (...a) => authFetch(...a) }));
vi.mock('next/image', () => ({ default: ({ alt }) => React.createElement('img', { alt }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }) => React.createElement('a', { href, ...r }, children) }));

const assign = vi.fn();
const scrollIntoView = vi.fn();
const PATH = '/dashboard/property/prop1abc';
const setUrl = (search) => Object.defineProperty(window, 'location', { configurable: true, value: { assign, pathname: PATH, search, href: `http://localhost${PATH}${search}` } });

const PROPERTY = { id: 'prop1abc', userId: 'agentA', price: '1000000', formattedAddress: '1 Greenwich Ave', imageUrls: [] };
const OFFERS = [
  { id: 'REG_TARGET1', type: 'opinion', serious: true, userId: 'buyer1', buyerName: 'Target Buyer', buyerEmail: 'target@x.test', offerAmount: 900000, createdAt: '2026-10-02T00:00:00.000Z' },
  { id: 'REG_OTHER22', type: 'opinion', serious: true, buyerName: 'Other Buyer', buyerEmail: 'other@x.test', offerAmount: 950000, createdAt: '2026-10-03T00:00:00.000Z' },
  { id: 'ANON_ONE001', type: 'opinion', serious: false, offerAmount: 850000, createdAt: '2026-10-04T00:00:00.000Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  dataGate = Promise.resolve();
  authState = { user: { uid: 'agentA', email: 'phil@example.com' }, userData: { agent: true }, loading: false };
  propertyDoc = { ...PROPERTY };
  ownOffers = OFFERS; ownLikes = [];
  authFetch.mockImplementation(async (url) => ({ ok: true, status: 200, json: async () => ({ buyers: {} }) }));
  Element.prototype.scrollIntoView = scrollIntoView;
  setUrl('?registration=REG_TARGET1');
});
afterEach(cleanup);

const mount = async () => {
  const Page = (await import('../../src/app/dashboard/property/[id]/page')).default;
  return render(React.createElement(Page));
};

describe('emailed registration link: owner (desktop or mobile browser)', () => {
  it('loads the property report and highlights + scrolls to the exact registration', async () => {
    await mount();
    const row = await waitFor(() => { const r = document.getElementById('registration-REG_TARGET1'); expect(r).toBeTruthy(); return r; });
    expect(row.className).toMatch(/ring-amber/);
    expect(screen.getByText(/the registration from your email/i)).toBeTruthy();
    // the OTHER registration is not highlighted
    expect(document.getElementById('registration-REG_OTHER22').className).not.toMatch(/ring-amber/);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts[0]).toBe(row);
    expect(push).not.toHaveBeenCalledWith('/dashboard');
  });

  it('works when the data is slow to load: spinner first, no flash of a wrong state, then highlight once the list exists', async () => {
    let release;
    dataGate = new Promise((r) => { release = r; });
    await mount();
    // still loading: spinner only — no access panel, no report, no scrolling yet
    expect(document.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.getElementById('registration-REG_TARGET1')).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () => { release(); });
    await waitFor(() => expect(document.getElementById('registration-REG_TARGET1')).toBeTruthy());
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it('re-corrects the scroll after layout shifts, but stops once the person scrolls themselves', async () => {
    await mount();
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(1)); // first, smooth scroll
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ behavior: 'smooth', block: 'center' });
    // later passes correct for images/charts above the list finishing loading (mobile)
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 3000 });
  });

  it('stops re-scrolling the moment the person touches/scrolls (does not fight them)', async () => {
    await mount();
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(1));
    fireEvent(window, new Event('touchmove'));
    const afterTouch = scrollIntoView.mock.calls.length;
    await new Promise((r) => setTimeout(r, 3000));
    expect(scrollIntoView.mock.calls.length).toBe(afterTouch);
  });

  it('an unknown registration id shows a notice and still shows the full report', async () => {
    setUrl('?registration=DOES_NOT_EXIST');
    await mount();
    expect(await screen.findByText(/couldn.t find that specific registration/i)).toBeTruthy();
    expect(document.getElementById('registration-REG_TARGET1')).toBeTruthy();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('a malformed registration param is ignored (never used in a DOM lookup)', async () => {
    setUrl('?registration=%22%3E%3Cscript%3E');
    await mount();
    await waitFor(() => expect(document.getElementById('registration-REG_TARGET1')).toBeTruthy());
    expect(screen.queryByText(/couldn.t find that specific registration/i)).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('without the param the report is unchanged: no highlight, no notice', async () => {
    setUrl('');
    await mount();
    await waitFor(() => expect(document.getElementById('registration-REG_TARGET1')).toBeTruthy());
    expect(document.getElementById('registration-REG_TARGET1').className).not.toMatch(/ring-amber/);
    expect(screen.queryByText(/the registration from your email/i)).toBeNull();
  });
});

describe('emailed registration link: signed in as the WRONG account', () => {
  beforeEach(() => {
    authState = { user: { uid: 'someoneElse', email: 'other-account@example.com' }, userData: { agent: true }, loading: false };
    authFetch.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }));
  });

  it('explains instead of redirecting, shows who is signed in, and exposes NO buyer details', async () => {
    await mount();
    expect(await screen.findByText(/isn.t available to this account/i)).toBeTruthy();
    expect(screen.getByText('other-account@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: /switch account/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /go to my dashboard/i }).getAttribute('href')).toBe('/dashboard');
    const html = document.body.innerHTML;
    for (const leaked of ['Target Buyer', 'target@x.test', 'Other Buyer', 'other@x.test']) expect(html).not.toContain(leaked);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('does NOT sign the person out automatically', async () => {
    await mount();
    await screen.findByText(/isn.t available to this account/i);
    await new Promise((r) => setTimeout(r, 50));
    expect(firebaseSignOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('Switch account signs out only on click, then returns to login with the exact link (incl. ?registration=) preserved', async () => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /switch account/i }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(firebaseSignOut).toHaveBeenCalledTimes(1);
    const dest = assign.mock.calls[0][0];
    expect(dest.startsWith('/login?returnTo=')).toBe(true);
    expect(decodeURIComponent(dest.split('returnTo=')[1])).toBe(`${PATH}?registration=REG_TARGET1`);
  });

  it('property not found shows a clear message', async () => {
    propertyDoc = null;
    await mount();
    expect(await screen.findByText(/couldn.t find that property/i)).toBeTruthy();
  });
});

describe('emailed registration link: office administrator (existing read-only access preserved)', () => {
  beforeEach(() => {
    authState = { user: { uid: 'adminA', email: 'hannah@example.com' }, userData: { agent: true, isOfficeAdmin: true }, loading: false };
    authFetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/report')) {
        return { ok: true, status: 200, json: async () => ({ readOnly: true, access: 'officeAdmin', property: PROPERTY, offers: OFFERS, likes: [], buyers: {} }) };
      }
      return { ok: true, status: 200, json: async () => ({ buyers: {} }) };
    });
  });

  it('sees the same highlighted registration, in read-only mode with the banner and no management actions', async () => {
    await mount();
    const row = await waitFor(() => { const r = document.getElementById('registration-REG_TARGET1'); expect(r).toBeTruthy(); return r; });
    expect(row.className).toMatch(/ring-amber/);
    expect(screen.getByText(/viewing as office admin/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /send report/i })).toBeNull();
    expect(authFetch).toHaveBeenCalledWith('/api/properties/prop1abc/report');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});
