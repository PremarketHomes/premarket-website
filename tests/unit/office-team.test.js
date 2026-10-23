import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const state = { users: {}, offices: {}, officeAdminInfo: {}, properties: {} };

function makeQuery(name, filters) {
  return {
    where: (field, op, value) => makeQuery(name, [...filters, (d) => d[field] === value]),
    get: vi.fn().mockImplementation(async () => ({
      docs: Object.entries(state[name]).filter(([, d]) => filters.every((f) => f(d))).map(([id, d]) => ({ id, data: () => d })),
    })),
  };
}
function makeCollection(name) {
  return {
    doc: (id) => ({ get: vi.fn().mockImplementation(async () => (state[name][id] ? { exists: true, id, data: () => state[name][id] } : { exists: false })) }),
    where: (field, op, value) => makeQuery(name, [(d) => d[field] === value]),
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: { collection: (name) => { if (!state[name]) throw new Error(`Unexpected collection: ${name}`); return makeCollection(name); } },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL', arrayRemove: (v) => v } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({}) }));

const ts = (iso) => ({ toDate: () => new Date(iso) });

function seed() {
  state.offices = { A: { agencyBrandId: null }, B: { agencyBrandId: null } };
  state.officeAdminInfo = {
    A: { name: 'Office A', officeAdminUids: ['adminA'], status: 'active' },
    B: { name: 'Office B', officeAdminUids: ['adminB'], status: 'active' },
  };
  state.users = {
    adminA: { officeId: 'A', isOfficeAdmin: true },
    agentA: { officeId: 'A' },
    adminB: { officeId: 'B', isOfficeAdmin: true },
    agentB: { officeId: 'B' },
    outsider: {},
  };
  state.properties = {
    p1: { userId: 'agentA', formattedAddress: '1 Test St', visibility: true, listingStatus: 'on-market', price: 900000, stats: { views: 12 }, imageUrls: ['t.jpg'], createdAt: ts('2026-10-01'),
      // private/extra fields that must never be returned:
      agentPhone: '0400', buyerEmails: ['b@x.com'], billing: { charge: 200 }, agentId: 'agent-profile' },
    p2: { userId: 'agentA', address: '2 Test St', archived: true, archivedReason: 'sold', soldPrice: 950000, price: 900000, createdAt: ts('2026-10-10') },
    p3: { userId: 'agentA', address: '3 Test St', archived: true, createdAt: ts('2026-09-01') },
    p4: { userId: 'agentA', address: '4 Test St', visibility: false, createdAt: ts('2026-08-01') },
    pB: { userId: 'agentB', address: 'Other office St', visibility: true, createdAt: ts('2026-10-02') },
  };
}

describe('listAgentPropertiesForOffice — read-only, same-office only', () => {
  beforeEach(() => { vi.clearAllMocks(); seed(); });

  it('returns the member\'s properties newest first with correct statuses and counts', async () => {
    const { listAgentPropertiesForOffice } = await import('../../src/app/api/services/officeTeamService');
    const r = await listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'agentA', actorUid: 'adminA' });
    expect(r.total).toBe(4);
    expect(r.properties.map((p) => p.id)).toEqual(['p2', 'p1', 'p3', 'p4']);
    expect(Object.fromEntries(r.properties.map((p) => [p.id, p.status]))).toEqual({ p1: 'live', p2: 'sold', p3: 'archived', p4: 'hidden' });
    expect(r.counts).toEqual({ live: 1, sold: 1, archived: 1, hidden: 1 });
    expect(r.properties.find((p) => p.id === 'p1')).toMatchObject({ address: '1 Test St', price: 900000, views: 12, listingStatus: 'on-market', thumbnail: 't.jpg' });
  });

  it('returns ONLY a minimal field set — no phone, buyer data, billing or agent profile ids', async () => {
    const { listAgentPropertiesForOffice } = await import('../../src/app/api/services/officeTeamService');
    const r = await listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'agentA', actorUid: 'adminA' });
    const keys = Object.keys(r.properties[0]).sort();
    expect(keys).toEqual(['address', 'bathrooms', 'bedrooms', 'carSpaces', 'createdAt', 'id', 'listingStatus', 'price', 'soldPrice', 'status', 'thumbnail', 'views']);
    expect(JSON.stringify(r)).not.toMatch(/0400|b@x\.com|billing|agent-profile/);
  });

  it('refuses a non-admin member (403)', async () => {
    const { listAgentPropertiesForOffice } = await import('../../src/app/api/services/officeTeamService');
    await expect(listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'agentA', actorUid: 'agentA' })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses an admin of a DIFFERENT office (403) and never reads other offices\' agents (404)', async () => {
    const { listAgentPropertiesForOffice } = await import('../../src/app/api/services/officeTeamService');
    await expect(listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'agentA', actorUid: 'adminB' })).rejects.toMatchObject({ status: 403 });
    await expect(listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'agentB', actorUid: 'adminA' })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses unlinked accounts and unknown uids (404) — e.g. pending invitees', async () => {
    const { listAgentPropertiesForOffice } = await import('../../src/app/api/services/officeTeamService');
    await expect(listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'outsider', actorUid: 'adminA' })).rejects.toMatchObject({ status: 404 });
    await expect(listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'nobody', actorUid: 'adminA' })).rejects.toMatchObject({ status: 404 });
  });

  it('an admin can view their own properties list too, and a member with none gets an empty list', async () => {
    const { listAgentPropertiesForOffice } = await import('../../src/app/api/services/officeTeamService');
    const r = await listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'adminA', actorUid: 'adminA' });
    expect(r).toEqual({ properties: [], counts: {}, total: 0 });
  });

  it('does not change anything (read-only)', async () => {
    const { listAgentPropertiesForOffice } = await import('../../src/app/api/services/officeTeamService');
    const before = JSON.stringify(state);
    await listAgentPropertiesForOffice({ officeId: 'A', targetUid: 'agentA', actorUid: 'adminA' });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('dashboard greeting and Office Team navigation (source guards)', () => {
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');
  const dash = read('src/app/dashboard/page.js');

  it('greeting always uses the person\'s name — header and sidebar — never companyName', () => {
    expect(dash).toContain('Welcome back, {userName}');
    expect(dash).not.toMatch(/Welcome back, \$\{userData\.companyName\}/);
    expect(dash).toMatch(/Welcome back,<\/p>\s*\{\/\*[\s\S]*?\*\/\}\s*<p className="text-slate-900 font-semibold truncate">\{userName\}<\/p>/);
    expect(dash).toContain("user?.displayName || 'there'");
  });

  it('agency/office name is kept as a separate, secondary line', () => {
    expect(dash).toContain('<p className="text-xs text-slate-500 truncate">{officeBrand.brand?.name || \'Your office\'}</p>');
  });

  it('"Team" opens the office team for office administrators only; everyone else keeps the personal page', () => {
    expect(dash).toContain("href: userData?.isOfficeAdmin === true ? '/dashboard/office/team' : '/dashboard/agents'");
    // no duplicate second item next to it
    expect(dash).not.toContain("id: 'office-team'");
    // the personal listing-agent profiles page stays reachable for admins
    expect(read('src/app/dashboard/office/team/page.js')).toContain('href="/dashboard/agents"');
  });

  it('team page is read-only and uses only the office APIs', () => {
    const t = read('src/app/dashboard/office/team/page.js');
    expect(t).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(t).not.toMatch(/firebase\/firestore/);
    expect(t).toContain('/api/offices/mine');
    expect(t).toContain('/agents/${agent.uid}/properties');
    // loading / error never shows a setup form
    expect(t).toContain('Retry');
    expect(t).toContain("if (authLoading || !uid) return;");
  });
});
