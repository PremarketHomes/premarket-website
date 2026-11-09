import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { bsoCampaignStats, BSO_TAB_FILTERS } from '../../src/app/utils/bsoDashboard';

const read = (p) => readFileSync(p, 'utf8');
const dash = read('src/app/dashboard/page.js');

const c = (o) => ({ archived: false, visibility: false, status: 'hidden', views: 0, opinions: 0, ...o });
const rows = [
  c({ id: 'a', visibility: true, status: 'live', views: 10, opinions: 3 }),
  c({ id: 'b', views: 5, opinions: 1 }),
  c({ id: 'c', archived: true, status: 'archived', views: 7, opinions: 2 }),
  c({ id: 'd', archived: true, status: 'sold', views: 4, opinions: 4 }),
];

describe('BSO Dashboard figures (same meaning as an agent dashboard)', () => {
  it('counts active managed campaigns, live ones and their views; opinions across all campaigns', () => {
    expect(bsoCampaignStats(rows)).toEqual({ campaigns: 2, live: 1, views: 15, opinions: 10 });
    expect(bsoCampaignStats([])).toEqual({ campaigns: 0, live: 0, views: 0, opinions: 0 });
  });
  it('Dashboard / Sold / Archive split the campaigns like an agent\'s tabs', () => {
    expect(rows.filter(BSO_TAB_FILTERS.overview).map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows.filter(BSO_TAB_FILTERS.sold).map((r) => r.id)).toEqual(['d']);
    expect(rows.filter(BSO_TAB_FILTERS.archived).map((r) => r.id)).toEqual(['c']);
  });
});

describe('BSO sidebar and Dashboard (agents and office admins unchanged)', () => {
  const nav = dash.slice(dash.indexOf('const navItems = ['), dash.indexOf('const sidebarContent'));
  it('BSO: Dashboard, Sold, Archive, Add Property, My Team, Settings — no My Campaigns, no User Manual', () => {
    expect(nav).not.toContain('My Campaigns');
    expect(nav).not.toContain("'/dashboard/bso'");
    expect(nav).toContain("...(isBso ? [] : [{ id: 'user-manual', label: 'User Manual', icon: BookOpen, href: '/dashboard/user-manual' }]),");
    const order = ["label: 'Dashboard'", "label: 'Sold'", "label: 'Archive'", "label: 'Add Property'", "label: 'User Manual'", "label: 'My Team'", "label: 'Settings'"];
    const at = order.map((l) => nav.indexOf(l));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });
  it('agents keep User Manual; office admin, leadership and admin links are untouched', () => {
    for (const s of ["label: 'Office'", "label: 'Agents'", "label: 'Teams'", "label: 'Campaigns'", "label: 'Registrations'", "label: 'Leadership Hub'", "label: 'Admin'"]) expect(nav).toContain(s);
    expect(nav).toContain('userData?.isOfficeAdmin === true');
  });
  it('a BSO is decided by the server (/api/bso/access), and the dashboard waits for that answer (no empty-state flash)', () => {
    expect(dash).toContain("authFetch('/api/bso/access')");
    expect(dash).toContain("const gridLoading = propertiesLoading || bsoStatus === 'unknown'");
    expect(dash).toContain('isBso={isBso}');
  });
  it('BSO figures and list come from their managed campaigns; empty state only when they have none', () => {
    expect(dash).toContain('<StatCard label="Total Managed Campaigns" value={gridLoading ? \'...\' : bsoStats.campaigns} />');
    expect(dash).toContain('<StatCard label="Live Campaigns"');
    expect(dash).toContain("activeTab === 'overview' && bso.campaigns.length === 0 ? (");
    expect(dash).toContain('<BsoCampaignList campaigns={bso.campaigns} tab={activeTab} onChanged={bso.reload} />');
    // agents: the original figures and grid
    expect(dash).toContain('<StatCard label="Total Properties"');
    expect(dash).toContain('<PropertyCard');
  });
  it('the campaign list keeps every existing action and shows the selling agent', () => {
    const list = read('src/app/dashboard/components/BsoCampaigns.js');
    for (const s of ["authFetch('/api/bso/campaigns')", '/campaign-link/resend', "act(c, 'hide'", "act(c, 'show'", "act(c, 'archive'", '/dashboard/edit/${c.id}', '/dashboard/property/${c.id}', 'Copy buyer link', 'data-testid="bso-campaign-agent"', 'Filter by agent']) {
      expect(list).toContain(s);
    }
  });
});

describe('old My Campaigns URLs', () => {
  it('/dashboard/bso redirects to the Dashboard and nothing links to it any more', () => {
    expect(read('next.config.mjs')).toMatch(/source: '\/dashboard\/bso',\s*destination: '\/dashboard',/);
    for (const p of ['src/app/dashboard/add/page.js', 'src/app/dashboard/edit/[id]/page.js', 'src/app/dashboard/property/[id]/page.js', 'src/app/dashboard/page.js']) {
      expect(read(p)).not.toContain("'/dashboard/bso");
    }
  });
});
