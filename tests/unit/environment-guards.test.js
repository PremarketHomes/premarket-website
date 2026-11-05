import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const mockVerifyIdToken = vi.fn(async () => ({ uid: 'u1', email: 'u1@x.com' }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mockVerifyIdToken }) }));
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) } }));
const resendSend = vi.fn(async () => ({ data: { id: 'x' } }));
vi.mock('resend', () => ({ Resend: class { constructor() { this.emails = { send: (...a) => resendSend(...a) }; } } }));

import {
  deploymentEnv, backendProjectId, pointsAtLiveBackend, previewWritesBlocked, isBlockedPreviewWrite, filterRecipients,
  teamRegistrationsEnabled, describeEnvironment, PREVIEW_READ_ONLY_MESSAGE,
} from '../../src/app/api/services/environmentGuard';
import { verifyAuth } from '../../src/app/api/middleware/auth';
import { sendEmail } from '../../src/app/api/services/resendService';
import { bunnyUploadUrl, cdnUrlFor, cdnBase, bunnyStorageZone } from '../../src/app/api/services/storageConfig';
import { GET as environmentRoute } from '../../src/app/api/internal/environment/route';

const LIVE_PREVIEW = { VERCEL_ENV: 'preview' };
const STAGING_SA = JSON.stringify({ project_id: 'premarket-staging' });
const req = (method, path) => new Request(`http://localhost${path}`, { method, headers: { authorization: 'Bearer t' } });

describe('which backend and environment', () => {
  it('detects the deployment environment and the server backend project', () => {
    expect(deploymentEnv({ VERCEL_ENV: 'preview' })).toBe('preview');
    expect(deploymentEnv({ NODE_ENV: 'production' })).toBe('production');
    expect(deploymentEnv({})).toBe('development');
    expect(backendProjectId({})).toBe('premarket-homes');
    expect(backendProjectId({ FIREBASE_PROJECT_ID: 'x' })).toBe('x');
    expect(backendProjectId({ FIREBASE_SERVICE_ACCOUNT: STAGING_SA })).toBe('premarket-staging');
  });
  it('treats live, unreadable and unspecified credentials as live; staging and emulators as not live', () => {
    expect(pointsAtLiveBackend({})).toBe(true);
    expect(pointsAtLiveBackend({ FIREBASE_SERVICE_ACCOUNT: '{not json' })).toBe(true);
    expect(pointsAtLiveBackend({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'premarket-homes' }) })).toBe(true);
    expect(pointsAtLiveBackend({ FIREBASE_SERVICE_ACCOUNT: STAGING_SA })).toBe(false);
    expect(pointsAtLiveBackend({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toBe(false);
  });
});

describe('preview deployments on the live backend refuse writes (reads still work)', () => {
  const blocked = (method, pathname, env = LIVE_PREVIEW) => isBlockedPreviewWrite({ method, pathname }, env);
  it('blocks every write on the office, team and managed-campaign routes', () => {
    for (const [m, p] of [['POST', '/api/offices/o1/agents'], ['PATCH', '/api/offices/o1/agent-profile'], ['POST', '/api/offices/o1/agent-profile/photo'],
      ['POST', '/api/offices/o1/teams'], ['DELETE', '/api/offices/o1/teams/members/u1'], ['POST', '/api/offices/o1/import/commit'],
      ['POST', '/api/properties/managed'], ['PATCH', '/api/properties/abc123/managed'], ['POST', '/api/properties/abc123/campaign-link/resend'],
      ['POST', '/api/teams/invites'], ['POST', '/api/offices']]) {
      expect(blocked(m, p), `${m} ${p}`).toBe(true);
    }
  });
  it('never blocks reads, other routes, production, staging or emulators', () => {
    for (const [m, p] of [['GET', '/api/offices/o1/agent-directory'], ['GET', '/api/offices/o1/campaigns'], ['GET', '/api/registrations/managed'], ['GET', '/api/properties/managed/agents']]) expect(blocked(m, p)).toBe(false);
    expect(blocked('POST', '/api/upload-image')).toBe(false);
    expect(blocked('POST', '/api/offers/notify-interest')).toBe(false);
    expect(blocked('POST', '/api/offices/o1/teams', { VERCEL_ENV: 'production' })).toBe(false);
    expect(blocked('POST', '/api/offices/o1/teams', { VERCEL_ENV: 'preview', FIREBASE_SERVICE_ACCOUNT: STAGING_SA })).toBe(false);
    expect(blocked('POST', '/api/offices/o1/teams', { VERCEL_ENV: 'preview', FIRESTORE_EMULATOR_HOST: 'x' })).toBe(false);
    expect(blocked('POST', '/api/offices/o1/teams', {})).toBe(false);
  });
  it('the shared auth gate enforces it before any token is checked', async () => {
    const saved = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = 'preview';
    try {
      mockVerifyIdToken.mockClear();
      const r = await verifyAuth(req('POST', '/api/offices/o1/teams'));
      expect(r).toEqual({ authenticated: false, error: PREVIEW_READ_ONLY_MESSAGE, status: 403 });
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
      expect((await verifyAuth(req('GET', '/api/offices/o1/agent-directory'))).authenticated).toBe(true);
    } finally { if (saved === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = saved; }
  });
});

describe('outbound email on a preview deployment', () => {
  const ENV = { VERCEL_ENV: 'preview', EMAIL_ALLOWLIST: ' QA@premarket.homes, @test.example ' };
  it('allows only allowlisted addresses or domains (case-insensitive), including "Name <addr>" form', () => {
    expect(filterRecipients(['qa@premarket.homes', 'x@test.example', 'agent@hph.com', 'Jo <JO@Test.Example>', 'qa@premarket.homes.evil.com'], ENV))
      .toEqual({ allowed: ['qa@premarket.homes', 'x@test.example', 'Jo <JO@Test.Example>'], blocked: ['agent@hph.com', 'qa@premarket.homes.evil.com'] });
    expect(filterRecipients('anyone@hph.com', { VERCEL_ENV: 'preview' }).allowed).toEqual([]); // default: nobody
  });
  it('is inactive in production and local development (nothing changes there)', () => {
    expect(filterRecipients('agent@hph.com', { VERCEL_ENV: 'production' }).allowed).toEqual(['agent@hph.com']);
    expect(filterRecipients('agent@hph.com', {}).allowed).toEqual(['agent@hph.com']);
  });
  describe('sendEmail', () => {
    const saved = { ...process.env };
    beforeEach(() => { resendSend.mockClear(); process.env.RESEND_API_KEY = 're_test'; });
    afterEach(() => { for (const k of ['VERCEL_ENV', 'EMAIL_ALLOWLIST']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
    it('a preview sends nothing to an HPH agent and does not throw (flows keep working)', async () => {
      process.env.VERCEL_ENV = 'preview';
      const r = await sendEmail({ to: 'agent@hph.com', subject: 's', html: '<p>x</p>' });
      expect(r).toMatchObject({ suppressed: true });
      expect(resendSend).not.toHaveBeenCalled();
    });
    it('a preview sends to an allowlisted inbox and strips everyone else from a multi-recipient send', async () => {
      process.env.VERCEL_ENV = 'preview'; process.env.EMAIL_ALLOWLIST = 'qa@premarket.homes';
      await sendEmail({ to: ['qa@premarket.homes', 'agent@hph.com'], subject: 's', html: '<p>x</p>' });
      expect(resendSend).toHaveBeenCalledTimes(1);
      expect(resendSend.mock.calls[0][0].to).toEqual(['qa@premarket.homes']);
      await sendEmail({ to: 'qa@premarket.homes', subject: 's', html: '<p>x</p>' });
      expect(resendSend.mock.calls[1][0].to).toBe('qa@premarket.homes');
    });
    it('production sends exactly as before', async () => {
      process.env.VERCEL_ENV = 'production';
      await sendEmail({ to: 'agent@hph.com', subject: 's', html: '<p>x</p>' });
      expect(resendSend.mock.calls[0][0].to).toBe('agent@hph.com');
    });
  });
  it('every Resend send path in the app goes through the guard', () => {
    const svc = readFileSync('src/app/api/services/resendService.js', 'utf8');
    expect(svc).toContain('filterRecipients(to)');
    expect(readFileSync('src/app/api/admin/users/[id]/reset-password/route.js', 'utf8')).toContain('filterRecipients(email)');
  });
});

describe('storage and Firebase configuration defaults', () => {
  it('uploads default to the production zone and CDN, and move wholesale to staging when configured', () => {
    expect(bunnyUploadUrl('a.jpg', {})).toBe('https://syd.storage.bunnycdn.com/premarketvideos/a.jpg');
    expect(cdnUrlFor('a.jpg', {})).toBe('https://premarketvideos.b-cdn.net/a.jpg');
    const staging = { BUNNY_STORAGE_ZONE: 'premarket-staging', BUNNY_CDN_BASE: 'https://premarket-staging.b-cdn.net' };
    expect(bunnyUploadUrl('a.jpg', staging)).toBe('https://syd.storage.bunnycdn.com/premarket-staging/a.jpg');
    expect(cdnUrlFor('a.jpg', staging)).toBe('https://premarket-staging.b-cdn.net/a.jpg');
  });
  it('rejects unsafe values and falls back to production defaults', () => {
    expect(cdnBase({ BUNNY_CDN_BASE: 'http://insecure.example' })).toBe('https://premarketvideos.b-cdn.net/');
    expect(cdnBase({ BUNNY_CDN_BASE: 'javascript:alert(1)' })).toBe('https://premarketvideos.b-cdn.net/');
    expect(bunnyStorageZone({ BUNNY_STORAGE_ZONE: '../evil/zone' })).toBe('evilzone');
  });
  it('the browser Firebase config keeps production as the default and emulators are opt-in', () => {
    const c = readFileSync('src/app/firebase/clientApp.js', 'utf8');
    expect(c).toContain('process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "premarket-homes"');
    expect(c).toContain("process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === '1'");
    expect(c).not.toMatch(/connectAuthEmulator\([^)]*\);\s*connectFirestoreEmulator\([^)]*\);\s*\n\s*\n?export/); // never unconditional
  });
});

describe('Google Maps key', () => {
  it('the Add Property wizard uses a configurable key, defaulting to the existing one', () => {
    const add = readFileSync('src/app/dashboard/add/page.js', 'utf8');
    expect(add).toContain('process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||');
    expect(add.match(/googleMapsApiKey:/g)).toHaveLength(1);
  });
});

describe('environment status route and managed campaign flag', () => {
  it('reports the backend and safeguards without secrets', async () => {
    const saved = { ...process.env };
    process.env.VERCEL_ENV = 'preview';
    delete process.env.FIREBASE_SERVICE_ACCOUNT; delete process.env.FIREBASE_PROJECT_ID;
    process.env.EMAIL_ALLOWLIST = 'a@b.com,@c.com';
    try {
      const body = await (await environmentRoute()).json();
      expect(body).toMatchObject({ deploymentEnv: 'preview', serverProjectId: 'premarket-homes', pointsAtLiveBackend: true, previewWritesBlocked: true, teamRegistrationsEnabled: false, clientMatchesServer: true });
      expect(body.emailGuard).toEqual({ active: true, allowlistEntries: 2 });
      expect(JSON.stringify(body)).not.toMatch(/a@b\.com|@c\.com|private_key|AIza|re_/);
    } finally { for (const k of ['VERCEL_ENV', 'EMAIL_ALLOWLIST', 'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_PROJECT_ID']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  });
  it('team registrations default to off', () => {
    expect(teamRegistrationsEnabled({})).toBe(false);
    expect(teamRegistrationsEnabled({ TEAM_REGISTRATIONS_ENABLED: '1' })).toBe(true);
    expect(describeEnvironment({}).teamRegistrationsEnabled).toBe(false);
  });
  it('managed campaigns do not trigger the legacy "property added" Cloud Function', async () => {
    const { MANAGED_VENDOR_UPLOADED } = await import('../../src/app/api/services/managedCampaignService');
    expect(MANAGED_VENDOR_UPLOADED).toBe(false);
    expect(readFileSync('src/app/api/services/managedCampaignService.js', 'utf8')).toContain('vendorUploaded: MANAGED_VENDOR_UPLOADED');
  });
});
