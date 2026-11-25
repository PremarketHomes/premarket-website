// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';

// The Open Home Experience concept (src/app/concepts/open-home): a demo that must never touch live data, and whose
// privacy design (identity and opinion kept apart, aggregates only for agents) is the blueprint for production.

const mockAuth = vi.hoisted(() => ({ value: { user: null, userData: null, loading: false } }));
vi.mock('../../src/app/context/AuthContext', () => ({ useAuth: () => mockAuth.value }));

const { demoLatency, readJson, clearDemoData, DEMO_NAMESPACE } = await import('../../src/app/concepts/open-home/_lib/demoStorage');
const { validateCheckIn } = await import('../../src/app/concepts/open-home/_lib/checkInForm');
const { checkIn, registerInterest, listAttendance } = await import('../../src/app/concepts/open-home/_lib/attendanceStore');
const { submitOpinion, opinionResults } = await import('../../src/app/concepts/open-home/_lib/opinionStore');
const { summarizeOpinions, liveCountLabel, MIN_OPINIONS_TO_SHOW } = await import('../../src/app/concepts/open-home/_lib/opinionSummary');
const { startSession, endSession, getSession, activeSessionFor, ensureVisitSession, seedDemoHistory, listSessions } = await import('../../src/app/concepts/open-home/_lib/sessionStore');
const { DEMO_PROPERTIES, partnerFor, opinionRangeFor } = await import('../../src/app/concepts/open-home/_lib/demoProperties');
const { isSessionCode, visitUrl } = await import('../../src/app/concepts/open-home/_lib/links');
const { computePriceOpinionRange } = await import('../../src/app/utils/priceOpinionRange');
const { OFFICES } = await import('../../src/app/components/office-landing/offices');
const ConceptGate = (await import('../../src/app/concepts/open-home/_components/ConceptGate')).default;

const ROOT = path.resolve(__dirname, '../../src/app/concepts/open-home');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const allFiles = (dir = ROOT) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? allFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]));

const PROPERTY = DEMO_PROPERTIES[0];
const RANGE = opinionRangeFor(PROPERTY);
const BUYER = { fullName: 'Olivia Bennett', mobile: '0491 570 006', email: 'Olivia.Bennett@Example.com' };

beforeEach(() => {
  demoLatency.ms = 0;
  window.localStorage.clear();
  cleanup();
});

describe('check-in validation', () => {
  it('accepts a name, an Australian mobile and an email, normalising them', () => {
    const v = validateCheckIn({ fullName: '  Olivia   Bennett ', mobile: '0491 570 006', email: ' Olivia@Example.COM ' });
    expect(v.ok).toBe(true);
    expect(v.value).toEqual({ fullName: 'Olivia Bennett', mobile: '+61491570006', email: 'olivia@example.com' });
  });
  it('explains each problem', () => {
    const v = validateCheckIn({ fullName: 'O', mobile: '12', email: 'nope' });
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors).sort()).toEqual(['email', 'fullName', 'mobile']);
    expect(validateCheckIn({}).errors).toEqual({
      fullName: 'Please enter your name.',
      mobile: 'Please enter your mobile number.',
      email: 'Please enter your email address.',
    });
  });
});

describe('identity and opinion are stored apart', () => {
  it('a check-in stores identity only, to the minute, and nothing invalid is stored', async () => {
    const s = startSession(PROPERTY.id);
    expect((await checkIn(s.id, { fullName: '', mobile: '', email: '' })).ok).toBe(false);
    expect(listAttendance(s.id)).toEqual([]);
    const res = await checkIn(s.id, BUYER, { now: Date.parse('2026-11-29T00:04:37.123Z') });
    expect(res.ok).toBe(true);
    const [rec] = listAttendance(s.id);
    expect(Object.keys(rec).sort()).toEqual(['checkedInAt', 'email', 'fullName', 'interest', 'mobile', 'ref', 'updatesOptIn']);
    expect(rec.checkedInAt).toBe('2026-11-29T00:04:00.000Z');
    expect(rec.ref).toBe(res.ref);
  });

  it('an opinion stores the amount and nothing else, sorted so arrival order is gone', async () => {
    const s = startSession(PROPERTY.id);
    const { ref } = await checkIn(s.id, BUYER);
    const a = RANGE.min + 200000;
    const b = RANGE.min + 50000;
    expect((await submitOpinion(s.id, a, RANGE)).ok).toBe(true);
    expect((await submitOpinion(s.id, b, RANGE)).ok).toBe(true);
    const stored = readJson(`opinions:${s.id}`, null);
    expect(stored).toEqual([b, a]);
    const raw = window.localStorage.getItem(`${DEMO_NAMESPACE}opinions:${s.id}`);
    expect(raw).not.toContain(ref);
    expect(raw).not.toMatch(/Olivia|example\.com|0491|T\d\d:/);
    // and the identity side never learns about it
    expect(JSON.stringify(listAttendance(s.id))).not.toContain(String(a));
  });

  it('refuses opinions outside the property range or off the $10,000 steps', async () => {
    const s = startSession(PROPERTY.id);
    expect((await submitOpinion(s.id, RANGE.max + 10000, RANGE)).ok).toBe(false);
    expect((await submitOpinion(s.id, RANGE.min + 5000, RANGE)).ok).toBe(false);
    expect((await submitOpinion(s.id, 'abc', RANGE)).ok).toBe(false);
    expect(readJson(`opinions:${s.id}`, [])).toEqual([]);
  });

  it('registering interest touches only the identity record', async () => {
    const s = startSession(PROPERTY.id);
    const { ref } = await checkIn(s.id, BUYER);
    await submitOpinion(s.id, RANGE.min, RANGE);
    expect((await registerInterest(s.id, ref, { wants: ['call', 'bogus'] })).ok).toBe(true);
    expect(listAttendance(s.id)[0].interest).toEqual({ wants: ['call'] });
    expect(readJson(`opinions:${s.id}`, [])).toEqual([RANGE.min]);
    expect((await registerInterest(s.id, 'NOPE', {})).ok).toBe(false);
  });

  it('the code keeps the two flows apart: no shared imports, and the opinion call sends no reference', () => {
    const att = read('_lib/attendanceStore.js');
    const op = read('_lib/opinionStore.js');
    expect(att).not.toMatch(/from '\.\/opinion/);
    expect(op).not.toMatch(/from '\.\/(attendance|visitState|sessionStore)/);
    const journey = read('_components/BuyerJourney.js');
    // The journey sends the amount alone through its data service (demo stores here, the live API in the pilot).
    expect(journey).toMatch(/await service\.submitOpinion\(value\)/);
    expect(journey).not.toMatch(/submitOpinion\([^)]*(ref|visit|firstName|fullName|Date)/);
    expect(read('_lib/demoService.js')).toMatch(/submitOpinion: \(amount\) => submitOpinion\(sessionId, amount, range\)/);
    // The agent side never reads the buyer's own phone state.
    expect(read('_components/AgentDashboard.js')).not.toMatch(/visitState/);
    // The buyer's phone state never holds an amount.
    expect(journey).not.toMatch(/update\(\{[^}]*[{,]\s*(value|amount)\b/);
  });
});

describe('what the agent may see about opinions', () => {
  it('while live: a count in steps of 5, never a price', () => {
    expect([0, 1, 4, 5, 9, 10, 14, 23].map((n) => liveCountLabel(n).label)).toEqual(['Fewer than 5', 'Fewer than 5', 'Fewer than 5', '5+', '5+', '10+', '10+', '20+']);
    const live = summarizeOpinions([RANGE.min, RANGE.max, RANGE.min + 100000, RANGE.min + 20000, RANGE.min + 30000, RANGE.min + 40000], { range: RANGE, ended: false });
    expect(Object.keys(live)).toEqual(['state', 'live']);
    expect(JSON.stringify(live)).not.toMatch(/\d{5,}/);
  });

  it(`after it ends: nothing below ${MIN_OPINIONS_TO_SHOW} opinions, then aggregates only`, () => {
    expect(summarizeOpinions([RANGE.min, RANGE.max, RANGE.min, RANGE.max], { range: RANGE, ended: true })).toEqual({ state: 'too-few', minimum: 5 });
    const amounts = [1200000, 1300000, 1350000, 1400000, 1500000, 1650000];
    const r = summarizeOpinions(amounts, { range: { min: 1090000, max: 1810000 }, ended: true });
    expect(Object.keys(r).sort()).toEqual(['bands', 'count', 'middle', 'state', 'typical']);
    expect(r.count).toBe(6);
    expect(r.typical).toBe(1380000); // median 1,375,000 on the $10,000 steps
    expect(r.bands.reduce((n, b) => n + b.count, 0)).toBe(6);
    expect(r.bands).toHaveLength(5);
  });

  it('opinionResults is the only agent read, and it goes through the summary', async () => {
    const s = startSession(PROPERTY.id);
    for (const v of [0, 1, 2, 3, 4]) await submitOpinion(s.id, RANGE.min + v * 10000, RANGE);
    expect(opinionResults(s.id, { range: RANGE, ended: false }).live.label).toBe('5+');
    expect(opinionResults(s.id, { range: RANGE, ended: true }).state).toBe('ready');
    expect(read('_components/AgentDashboard.js')).not.toMatch(/readJson|['`]opinions:/);
  });
});

describe('sessions, links and demo data', () => {
  it('one live open home per property; ending it closes it; a scanned phone records the session', () => {
    const s = startSession(PROPERTY.id);
    expect(startSession(PROPERTY.id).id).toBe(s.id);
    expect(isSessionCode(s.id)).toBe(true);
    expect(activeSessionFor(PROPERTY.id).id).toBe(s.id);
    endSession(s.id);
    expect(getSession(s.id).endedAt).toBeTruthy();
    expect(activeSessionFor(PROPERTY.id)).toBeNull();
    expect(ensureVisitSession('ABC234', PROPERTY.id).scannedOnly).toBe(true);
  });

  it('the QR link opens the visit page for that session and property', () => {
    expect(visitUrl('K7Q2XM', 'demo-banksia', 'https://premarket.homes')).toBe('https://premarket.homes/concepts/open-home/visit?property=demo-banksia&session=K7Q2XM');
    expect(isSessionCode('k7q2xm')).toBe(false);
    expect(isSessionCode('K7Q2X')).toBe(false);
  });

  it('demo history is seeded once, with fictional people only', () => {
    seedDemoHistory();
    seedDemoHistory();
    const ended = listSessions().filter((s) => s.endedAt);
    expect(ended).toHaveLength(1);
    const people = listAttendance(ended[0].id);
    expect(people.length).toBe(14);
    for (const p of people) {
      expect(p.email.endsWith('@example.com')).toBe(true);
      expect(p.mobile).toMatch(/^\+61491 ?57\d/);
    }
  });

  it('reset clears only the demo’s own keys', () => {
    window.localStorage.setItem('someone-else', 'keep');
    startSession(PROPERTY.id);
    clearDemoData();
    expect(window.localStorage.getItem('someone-else')).toBe('keep');
    expect(listSessions()).toEqual([]);
  });

  it('uses the existing slider range and the existing office branding (no HPH hardcoding)', () => {
    expect(RANGE).toEqual(computePriceOpinionRange(PROPERTY));
    expect(partnerFor(PROPERTY).logo).toEqual(OFFICES.hph.logo);
    expect(partnerFor(PROPERTY).logoColour).toEqual(OFFICES.hph.logoColour);
    expect(partnerFor(DEMO_PROPERTIES.find((p) => !p.office))).toBeNull();
    const code = allFiles().filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(code).not.toMatch(/Harcourts Property Hub|logo-white\.png|logo-colour\.png|#001f49/i);
  });
});

describe('safe by construction', () => {
  it('no concept file can reach live data, send anything or touch the kiosk', () => {
    for (const file of allFiles().filter((f) => f.endsWith('.js'))) {
      // Code only (comments describe what the demo deliberately does NOT do).
      const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
      const rel = path.relative(ROOT, file);
      expect(src, rel).not.toMatch(/firebase\/|firestore|authFetch|clientApp|\/api\/|fetch\(|resend|sendgrid|twilio|kioskPersistence|kioskOutbox|offers/i);
    }
  });

  it('presenter pages are gated on production; the buyer page is not; nothing is indexed', () => {
    for (const p of ['page.js', 'demo/page.js', 'agent/page.js', 'sign/page.js']) {
      // production: admin sign-in unless the browser opened the private share link (see open-home-share-link.test.js)
      expect(read(p)).toMatch(/<ConceptGate requireAdmin=\{await requireAdminSignIn\(\)\}>/);
    }
    expect(read('visit/page.js')).not.toMatch(/ConceptGate/);
    expect(read('layout.js')).toMatch(/robots: \{ index: false, follow: false/);
    const config = fs.readFileSync(path.resolve(ROOT, '../../../../next.config.mjs'), 'utf8');
    expect(config).toMatch(/source: '\/concepts\/:path\*',\s*headers: \[\{ key: 'X-Robots-Tag', value: 'noindex, nofollow' \}\]/);
  });

  it('the pitch makes no claims it can’t back and names no individuals', () => {
    const pitch = read('_components/PitchPage.js');
    // No percentages or statistics in the copy (CSS lengths like w-[62%] or gradient stops aside).
    expect(pitch).not.toMatch(/\d+\s?%(?![\]_,)])|\bper cent\b|\d+x (more|faster|better)/i);
    expect(pitch).not.toMatch(/Dave|Trevor|Manby|Tippett/);
    expect(pitch).toMatch(/Proposed concept/);
    expect(pitch).toMatch(/not a launched product/);
  });
});

describe('ConceptGate', () => {
  const kid = createElement('p', null, 'secret concept');
  const gate = (requireAdmin) => render(createElement(ConceptGate, { requireAdmin }, kid));

  it('opens without sign-in when not required (previews, local)', () => {
    mockAuth.value = { user: null, userData: null, loading: false };
    gate(false);
    expect(screen.getByText('secret concept')).toBeTruthy();
  });
  it('asks a signed-out visitor to sign in', () => {
    mockAuth.value = { user: null, userData: null, loading: false };
    gate(true);
    expect(screen.queryByText('secret concept')).toBeNull();
    expect(screen.getByText('This page is private')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toMatch(/^\/login/);
  });
  it('keeps it private from signed-in non-admins (agents, office admins)', () => {
    mockAuth.value = { user: { uid: 'a' }, userData: { isAgent: true, isOfficeAdmin: true }, loading: false };
    gate(true);
    expect(screen.queryByText('secret concept')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
  it('shows it to a platform admin', () => {
    mockAuth.value = { user: { uid: 'b' }, userData: { superAdmin: true }, loading: false };
    gate(true);
    expect(screen.getByText('secret concept')).toBeTruthy();
  });
});
