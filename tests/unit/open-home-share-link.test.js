import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

// The Open Home concept's private share link (/concepts/open-home/share/<token>): anyone with the link can view the
// concept's demo pages without a Premarket account; nobody else can; and the link grants nothing outside the concept.
// The real token is never in this repository (only its SHA-256), so tests use their own token via the env list.

const cookieJar = vi.hoisted(() => ({ value: undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name) => (name === 'pm_oh_share' && cookieJar.value !== undefined ? { name, value: cookieJar.value } : undefined) }),
}));

const { NextRequest } = await import('next/server');
const share = await import('../../src/app/concepts/open-home/_lib/shareAccess');
const { GET } = await import('../../src/app/concepts/open-home/share/[token]/route');

const TOKEN = randomBytes(24).toString('base64url');
const sha = (t) => createHash('sha256').update(t).digest('hex');
const ROOT = path.resolve(__dirname, '../../src/app/concepts/open-home');

const ENV = { ...process.env };
beforeEach(() => {
  process.env.OPEN_HOME_SHARE_SHA256 = sha(TOKEN);
  cookieJar.value = undefined;
});
afterEach(() => { process.env = { ...ENV }; });

const open = (token, base = 'https://premarket.homes') => GET(new NextRequest(`${base}/concepts/open-home/share/${token}`), { params: Promise.resolve({ token }) });

describe('share tokens', () => {
  it('accepts a listed token and nothing else', () => {
    expect(share.isValidShareToken(TOKEN)).toBe(true);
    expect(share.isValidShareToken(randomBytes(24).toString('base64url'))).toBe(false);
    expect(share.isValidShareToken(TOKEN.slice(0, -1) + (TOKEN.endsWith('A') ? 'B' : 'A'))).toBe(false);
    for (const bad of [undefined, null, '', 'short', 'x'.repeat(200), `${TOKEN}/../x`, `${TOKEN} `, 123]) expect(share.isValidShareToken(bad)).toBe(false);
  });

  it('the repository holds only hashes, never a token', () => {
    const src = fs.readFileSync(path.join(ROOT, '_lib/shareAccess.js'), 'utf8');
    const entries = [...src.matchAll(/sha256: '([^']*)'/g)].map((m) => m[1]);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e).toMatch(/^[0-9a-f]{64}$/);
    expect(src).not.toMatch(/token:\s*'/);
  });

  it('ignores malformed env entries', () => {
    process.env.OPEN_HOME_SHARE_SHA256 = 'not-a-hash, ,ZZ';
    expect(share.isValidShareToken(TOKEN)).toBe(false);
  });
});

describe('opening the share link', () => {
  it('remembers a valid link in an HttpOnly cookie for the concept only, and drops the token from the address', async () => {
    const res = await open(TOKEN);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://premarket.homes/concepts/open-home');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain(`pm_oh_share=${TOKEN}`);
    expect(cookie).toMatch(/Path=\/concepts\/open-home(;|$)/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=7776000/);
  });

  it('a wrong or made-up link gets the same redirect but no cookie (so it shows the private page)', async () => {
    for (const t of [randomBytes(24).toString('base64url'), 'guess', '../../dashboard']) {
      const res = await open(encodeURIComponent(t));
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('https://premarket.homes/concepts/open-home');
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('works on a local http server too (cookie without Secure)', async () => {
    const res = await open(TOKEN, 'http://localhost:3400');
    expect(res.headers.get('location')).toBe('http://localhost:3400/concepts/open-home');
    expect(res.headers.get('set-cookie')).not.toMatch(/Secure/i);
  });
});

describe('who must sign in', () => {
  it('production: signed-out visitors without the link must sign in; with a valid share cookie they need not', async () => {
    process.env.VERCEL_ENV = 'production';
    expect(await share.requireAdminSignIn()).toBe(true);
    cookieJar.value = 'not-the-token-but-the-right-shape-123';
    expect(await share.requireAdminSignIn()).toBe(true);
    cookieJar.value = TOKEN;
    expect(await share.requireAdminSignIn()).toBe(false);
  });

  it('revoking a link (removing its hash) ends access on the next page load', async () => {
    process.env.VERCEL_ENV = 'production';
    cookieJar.value = TOKEN;
    expect(await share.requireAdminSignIn()).toBe(false);
    process.env.OPEN_HOME_SHARE_SHA256 = '';
    expect(await share.requireAdminSignIn()).toBe(true);
  });

  it('previews and local development never ask (previews are behind Vercel’s login)', async () => {
    process.env.VERCEL_ENV = 'preview';
    expect(await share.requireAdminSignIn()).toBe(false);
    delete process.env.VERCEL_ENV;
    expect(await share.requireAdminSignIn()).toBe(false);
  });

  it('every presenter page uses it; the buyer page stays open; nothing else in the app reads the share cookie', () => {
    for (const p of ['page.js', 'demo/page.js', 'agent/page.js', 'sign/page.js']) {
      expect(fs.readFileSync(path.join(ROOT, p), 'utf8')).toMatch(/requireAdmin=\{await requireAdminSignIn\(\)\}/);
    }
    expect(fs.readFileSync(path.join(ROOT, 'visit/page.js'), 'utf8')).not.toMatch(/ConceptGate|requireAdminSignIn/);
    const appRoot = path.resolve(ROOT, '../..');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const users = walk(appRoot).filter((f) => f.endsWith('.js') && /pm_oh_share|shareAccess/.test(fs.readFileSync(f, 'utf8')));
    for (const f of users) expect(path.relative(ROOT, f)).not.toMatch(/^\.\./);
  });
});
