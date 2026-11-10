import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const calls = [];
vi.mock('../../src/app/utils/authFetch', () => ({ authFetch: vi.fn(async (url) => { calls.push(url); return { ok: true, status: 200, url }; }) }));
const { startOfficeRequest, officeResponse } = await import('../../src/app/utils/officePrefetch');
const read = (p) => readFileSync(p, 'utf8');

describe('office pages: data request starts alongside /api/offices/mine', () => {
  beforeEach(() => { calls.length = 0; });
  it('uses the early answer only when /mine confirms the same office', async () => {
    const early = startOfficeRequest('off1', '/campaigns');
    const res = await officeResponse(early, 'off1', 'off1', '/campaigns');
    expect(res.url).toBe('/api/offices/off1/campaigns');
    expect(calls).toEqual(['/api/offices/off1/campaigns']); // one request, not two
  });
  it('a stale or missing office id falls back to fetching for the confirmed office', async () => {
    const early = startOfficeRequest('oldOffice', '/campaigns');
    const res = await officeResponse(early, 'oldOffice', 'newOffice', '/campaigns');
    expect(res.url).toBe('/api/offices/newOffice/campaigns');
    expect(startOfficeRequest(null, '/agents')).toBeNull();
  });
  it('wired into Office, Agents (directory + BSOs together) and Campaigns, with one id per load', () => {
    for (const p of ['src/app/dashboard/office/page.js', 'src/app/dashboard/office/agents/page.js', 'src/app/dashboard/office/campaigns/page.js']) {
      const s = read(p);
      expect(s).toContain('const known = knownOfficeIdRef.current;');
      expect(s).toMatch(/startOfficeRequest\(known, '\/(agents|agent-directory|campaigns)'\)/);
      expect(s).not.toMatch(/\}, \[knownOfficeId\]\);/); // loaders keep their identity
    }
    expect(read('src/app/dashboard/office/agents/page.js')).toContain("const earlyBsos = startOfficeRequest(known, '/bsos');");
  });
});

describe('signed-in session: profile reuse is safe', () => {
  const ctx = read('src/app/context/AuthContext.js');
  it('the cached profile is used only after Firebase confirms the user, and only for the same uid', () => {
    const onAuth = ctx.slice(ctx.indexOf('onAuthStateChanged(auth'), ctx.indexOf('return () => unsubscribe();'));
    expect(onAuth.indexOf('if (firebaseUser) {')).toBeLessThan(onAuth.indexOf('readCachedProfile(firebaseUser.uid)'));
    expect(ctx).toContain('return v && v.uid === uid && v.data');
    expect(ctx).toContain('window.sessionStorage'); // gone when the browser session ends
  });
  it('the fresh profile always replaces it; sign-out and signed-out state clear it', () => {
    expect(ctx).toContain('writeCachedProfile(firebaseUser.uid, data);');
    expect(ctx).toContain('writeCachedProfile(uid, data);'); // refreshUserData too
    expect(ctx.match(/clearCachedProfile\(\);/g).length).toBeGreaterThanOrEqual(2);
  });
});

describe('login form shows immediately', () => {
  const login = read('src/app/login/page.js');
  it('the server sends a disabled copy of the form; no spinner while Firebase starts', () => {
    expect(login).toContain('<Suspense fallback={<LoginFormPlaceholder />}>');
    const placeholder = login.slice(login.indexOf('function LoginFormPlaceholder'), login.indexOf('function LoginPageContent'));
    expect(placeholder.match(/disabled/g).length).toBeGreaterThanOrEqual(3); // both inputs and the button
    expect(placeholder).toContain('onSubmit={(e) => e.preventDefault()}');
    expect(login).not.toMatch(/if \(authLoading\) \{\s*return \(/);
    expect(login).toContain('subtitle="Signing you in…"');
  });
});

describe('fewer repeated requests', () => {
  it('sidebar flags are remembered for the page session', () => {
    const dash = read('src/app/dashboard/page.js');
    expect(dash).toContain("rememberForSession('features', () => fetch('/api/features')");
    expect(dash).toContain('rememberForSession(`leadership:${userData.id}`, loadLeader)');
  });
  it('edit page starts the role check alongside the property read only for likely managers', () => {
    const edit = read('src/app/dashboard/edit/[id]/page.js');
    expect(edit).toContain("const likelyManager = userData?.isOfficeAdmin === true || readDashboardRoleHint(user.uid) === 'bso';");
    expect(edit).toContain('const earlyRole = likelyManager ? checkRole() : null;');
    expect(edit).toContain('const role = await (earlyRole || checkRole());');
    expect(edit).toContain("if (role !== 'bso' && role !== 'officeAdmin') {"); // the server still decides
  });
});
