// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }) => React.createElement('a', { href, ...r }, children) }));
vi.mock('../../src/app/context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'me' }, loading: false }) }));
vi.mock('../../src/app/hooks/useRequireAgent', () => ({ useRequireAgent: () => {} }));
vi.mock('../../src/app/firebase/clientApp', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), where: () => ({}), query: () => ({}),
  getDocs: async () => ({ docs: [{ id: 'mine1', data: () => ({ formattedAddress: '5 My St', visibility: true, price: 1200000, stats: { views: 3 } }) }] }),
}));

const routes = {};
const calls = [];
vi.mock('../../src/app/utils/authFetch', () => ({
  authFetch: async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    const h = routes[`${opts.method || 'GET'} ${url}`] || routes[url];
    if (!h) throw new Error(`unmocked ${url}`);
    const { status = 200, json } = typeof h === 'function' ? h() : h;
    return { ok: status < 400, status, json: async () => json };
  },
}));

const member = (uid, name, extra = {}) => ({ uid, name, email: `${uid}@a.test`, isYou: false, isCreator: false, canRemove: false, ...extra });
const teamOverview = (over = {}) => ({
  eligible: true, office: { id: 'A', name: 'Office A' }, incoming: [], outgoing: [],
  team: { id: 'T1', createdBy: 'me', members: [member('me', 'Me Myself', { isYou: true, isCreator: true }), member('bob', 'Bob Test', { canRemove: true }), member('carol', 'Carol Test', { canRemove: true })] },
  ...over,
});
const teamProps = {
  total: 2, counts: {},
  properties: [
    { id: 'p1', address: '1 Bob St', status: 'live', listingStatus: 'pre-market', price: 900000, views: 7, createdAt: '2026-09-01T00:00:00Z', owner: { uid: 'bob', name: 'Bob Test' } },
    { id: 'p2', address: '2 Carol Ave', status: 'sold', listingStatus: 'on-market', price: 1, soldPrice: 1500000, views: 2, createdAt: '2026-08-01T00:00:00Z', owner: { uid: 'carol', name: 'Carol Test' } },
  ],
};

const load = async () => (await import('../../src/app/dashboard/team/page')).default;
const show = async (overview, props = teamProps) => {
  routes['GET /api/teams/mine'] = { json: overview };
  routes['/api/teams/mine'] = { json: overview };
  routes['/api/teams/properties'] = { json: props };
  const Page = await load();
  return render(React.createElement(Page));
};

beforeEach(() => { calls.length = 0; });
afterEach(cleanup);

describe('My Team page', () => {
  it('agents without an office see a plain explanation, not a team UI', async () => {
    await show({ eligible: false, office: null, team: null, incoming: [], outgoing: [] });
    expect(await screen.findByText(/Teams are for agents in a verified agency/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/colleague@/i)).toBeNull();
  });

  it('no team yet: explains how to start one and offers the invite field', async () => {
    await show({ eligible: true, office: { id: 'A', name: 'Office A' }, team: null, incoming: [], outgoing: [] });
    expect(await screen.findByText(/not in a team yet/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/colleague@/i)).toBeTruthy();
    expect(screen.queryByText(/Leave team/i)).toBeNull();
  });

  it('shows members, who owns each team property, and read-only report links', async () => {
    await show(teamOverview());
    expect(await screen.findByText('1 Bob St')).toBeTruthy();
    expect(screen.getByText('Bob Test', { selector: 'span' })).toBeTruthy(); // owner label on the row
    const links = screen.getAllByText(/View report \(read-only\)/i).map((n) => n.closest('a').getAttribute('href'));
    expect(links).toEqual(['/dashboard/property/p1', '/dashboard/property/p2']);
    expect(screen.queryByText(/Creator|Team admin/i)).toBeNull(); // Team Admin badge retired
    expect(screen.getByText(/hide buyer names and contact details/i)).toBeTruthy();
  });

  it('Remove controls appear only where the server says canRemove', async () => {
    await show(teamOverview({ team: { id: 'T1', createdBy: 'bob', members: [member('me', 'Me', { isYou: true }), member('bob', 'Bob Test', { isCreator: true })] } }));
    await screen.findByText('1 Bob St');
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('creator removal asks for confirmation, then calls DELETE for that member only', async () => {
    await show(teamOverview());
    await screen.findByText('1 Bob St');
    routes['DELETE /api/teams/members/bob'] = { json: { removed: true } };
    fireEvent.click(screen.getAllByText('Remove')[0]);
    expect(screen.getByText(/Remove Bob Test\?/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false); // nothing yet
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Remove'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/teams/members/bob')).toBe(true));
  });

  it('leaving is confirmed and posts to /api/teams/leave', async () => {
    await show(teamOverview());
    await screen.findByText('1 Bob St');
    routes['POST /api/teams/leave'] = { json: { left: true } };
    fireEvent.click(screen.getByText('Leave team'));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Leave team'));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/teams/leave' && c.method === 'POST')).toBe(true));
  });

  it('invitations: accept / decline are offered, and Accept is disabled with a "leave first" note when already in a team', async () => {
    const inv = { id: 'i1', fromName: 'Dave Test', officeName: 'Office A', expiresAt: '2026-12-01T00:00:00Z', blocked: false };
    await show({ eligible: true, office: { id: 'A', name: 'Office A' }, team: null, outgoing: [], incoming: [inv] });
    expect(await screen.findByText(/Dave Test invited you/)).toBeTruthy();
    expect(screen.getByText('Accept').closest('button').disabled).toBe(false);
    expect(screen.getByText('Decline')).toBeTruthy();
    cleanup();
    await show(teamOverview({ incoming: [{ ...inv, blocked: true }] }));
    await screen.findByText(/Dave Test invited you/);
    expect(screen.getByText('Accept').closest('button').disabled).toBe(true);
    expect(screen.getByText(/Leave it first to join this one/i)).toBeTruthy();
  });

  it('sending an invitation posts the typed email and shows the server’s neutral message', async () => {
    await show({ eligible: true, office: { id: 'A', name: 'Office A' }, team: null, incoming: [], outgoing: [] });
    routes['POST /api/teams/invites'] = { json: { ok: true, message: "If that email belongs to an active agent in your office, they'll receive an invitation.", emailSent: true } };
    fireEvent.change(await screen.findByPlaceholderText(/colleague@/i), { target: { value: 'Bob@A.test' } });
    fireEvent.click(screen.getByText('Invite'));
    expect(await screen.findByText(/they'll receive an invitation/i)).toBeTruthy();
    const post = calls.find((c) => c.url === '/api/teams/invites');
    expect(JSON.parse(post.body)).toEqual({ email: 'Bob@A.test' });
  });

  it('server refusals are shown to the user, not swallowed', async () => {
    await show({ eligible: true, office: { id: 'A', name: 'Office A' }, team: null, incoming: [], outgoing: [] });
    routes['POST /api/teams/invites'] = { status: 409, json: { error: 'Carol is already in a team. They need to leave their current team before they can join yours.' } };
    fireEvent.change(await screen.findByPlaceholderText(/colleague@/i), { target: { value: 'carol@a.test' } });
    fireEvent.click(screen.getByText('Invite'));
    expect(await screen.findByText(/need to leave their current team/i)).toBeTruthy();
  });

  it('switching to "My properties" shows your own listings, labelled as yours, without the read-only wording', async () => {
    await show(teamOverview());
    await screen.findByText('1 Bob St');
    fireEvent.click(screen.getByRole('tab', { name: 'My properties' }));
    expect(await screen.findByText('5 My St')).toBeTruthy();
    expect(screen.queryByText('1 Bob St')).toBeNull();
    expect(screen.getByText('You', { selector: 'span.font-semibold' })).toBeTruthy();
    expect(screen.queryByText(/View report \(read-only\)/)).toBeNull();
  });
});
