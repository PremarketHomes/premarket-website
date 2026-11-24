import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Campaign links: premarket.homes/prop{10 digits} (current) and premarket.homes/p/{code} (legacy, still resolved).
//
// In-memory Firestore with the parts the link service uses: doc get, getAll, and serialised transactions whose
// create() refuses to overwrite (like Firestore's). Every write is recorded so tests can prove campaigns and legacy
// links are untouched.
const store = new Map(); // 'col/id' -> data
const writes = [];
let failReads = false;

const snap = (p) => {
  const data = store.get(p);
  return { exists: data !== undefined, id: p.split('/')[1], data: () => (data === undefined ? undefined : { ...data }) };
};
const ref = (col, id) => ({
  col, id, path: `${col}/${id}`,
  get: async () => { if (failReads) throw new Error('firestore down'); return snap(`${col}/${id}`); },
  set: async (data) => { writes.push({ op: 'set', path: `${col}/${id}` }); store.set(`${col}/${id}`, { ...data }); },
  update: async (data) => { writes.push({ op: 'update', path: `${col}/${id}` }); store.set(`${col}/${id}`, { ...(store.get(`${col}/${id}`) || {}), ...data }); },
});
let txChain = Promise.resolve();
const fakeDb = {
  collection: (col) => ({ doc: (id) => ref(col, id) }),
  getAll: async (...refs) => { if (failReads) throw new Error('firestore down'); return refs.map((r) => snap(r.path)); },
  runTransaction: (fn) => {
    const run = txChain.then(async () => {
      const pending = [];
      const tx = {
        get: async (r) => snap(r.path),
        create: (r, data) => { pending.push([r.path, data]); return tx; },
      };
      const out = await fn(tx);
      for (const [p] of pending) if (store.has(p)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
      for (const [p, data] of pending) { writes.push({ op: 'create', path: p }); store.set(p, { ...data }); }
      return out;
    });
    txChain = run.catch(() => {});
    return run;
  },
};

vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: fakeDb }));
vi.mock('next/cache', () => ({ unstable_cache: (fn) => fn })); // the page's mapping cache, as a pass-through
const sentEmails = [];
vi.mock('../../src/app/api/services/resendService', () => ({ sendEmail: vi.fn(async (msg) => { sentEmails.push(msg); return { id: 'test' }; }) }));
const authSpies = { verifyIdToken: vi.fn() };
vi.mock('firebase-admin/auth', () => ({ getAuth: () => authSpies }));
// The buyer page component itself is client-side; the page tests only check what it is given.
vi.mock('../../src/app/components/PropertyPageClient', () => ({ default: function PropertyPageClient() { return null; } }));

const utils = await import('../../src/app/utils/shortLinks');
const service = await import('../../src/app/api/services/shortLinkService');
const { SHORT_CODE_ALPHABET, normalizeShortCode, normalizePropSlug, propLinkUrl, shortLinkUrl, fullBuyerLink, isPropNumber } = utils;
const {
  generatePropNumber, generateShortCode, getOrCreatePropNumbers, getOrCreateShortCodes, resolvePropNumber, resolveShortCode,
  buyerShareLink, buyerShareLinks, existingPropNumber,
} = service;

const P1 = 'AbCdEfGhIjKlMnOpQrSt'; // Firestore-style 20-character ids
const P2 = 'ZyXwVuTsRqPoNmLkJiHg';
const P3 = 'Mixed_case-id_123456';
const PROP_RE = /^[1-9][0-9]{9}$/;
const seq = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const create = (ids) => getOrCreatePropNumbers(fakeDb, ids, { allowCreate: true });

beforeEach(() => {
  store.clear(); writes.length = 0; failReads = false; authSpies.verifyIdToken.mockReset();
  store.set(`properties/${P1}`, { userId: 'agent1', visibility: false, address: '1 Test St' });
  store.set(`properties/${P2}`, { userId: 'agent2', visibility: true, archived: true });
  store.set(`properties/${P3}`, { userId: 'agent3', visibility: true });
});

describe('prop link format: premarket.homes/prop + 10 digits', () => {
  it('is always exactly 10 digits with a non-zero first digit (so every link is the same length)', () => {
    for (let i = 0; i < 20000; i += 1) expect(generatePropNumber()).toMatch(PROP_RE);
    expect(generatePropNumber((min) => min)).toBe('1000000000'); // smallest possible
    expect(generatePropNumber((min, max) => max - 1)).toBe('9999999999'); // largest possible
  });

  it('is random across the whole space: every digit appears in every position, every first digit 1-9 occurs', () => {
    const seen = Array.from({ length: 10 }, () => new Set());
    for (let i = 0; i < 3000; i += 1) [...generatePropNumber()].forEach((d, pos) => seen[pos].add(d));
    expect(seen[0].size).toBe(9);
    expect(seen[0].has('0')).toBe(false);
    for (let pos = 1; pos < 10; pos += 1) expect(seen[pos].size).toBe(10);
  });

  it('20,000 fresh numbers are all different (9 billion possibilities)', () => {
    const numbers = new Set(Array.from({ length: 20000 }, () => generatePropNumber()));
    expect(numbers.size).toBe(20000);
  });

  it('the link is 38 characters (30 without https://) and says nothing about the property', () => {
    const link = propLinkUrl('4827319056');
    expect(link).toBe('https://premarket.homes/prop4827319056');
    expect(link).toHaveLength(38);
    expect(link.replace('https://', '')).toHaveLength(30);
    expect(link).toMatch(/^https:\/\/premarket\.homes\/prop\d{10}$/); // only digits after "prop": no address, agent or id
    expect(fullBuyerLink(P1)).toHaveLength(69); // the full link it replaces
  });

  it('reads the number from a pasted link, tolerating a capitalised "Prop" and a trailing full stop; rejects anything else', () => {
    expect(normalizePropSlug('prop4827319056')).toBe('4827319056');
    expect(normalizePropSlug('Prop4827319056')).toBe('4827319056');
    expect(normalizePropSlug('PROP4827319056.')).toBe('4827319056');
    expect(normalizePropSlug('prop4827319056).')).toBe('4827319056');
    for (const bad of ['prop0827319056', 'prop482731905', 'prop48273190561', 'prop48273l9056', 'p4827319056', '4827319056',
      'property', 'prop', 'prop-4827319056', 'prop4827319056/x', '../prop4827319056', '', null, undefined, 42, 'p'.repeat(100)]) {
      expect(normalizePropSlug(bad)).toBeNull();
    }
    expect(isPropNumber('4827319056')).toBe(true);
    expect(isPropNumber('0827319056')).toBe(false);
  });
});

describe('getOrCreatePropNumbers: one stable prop number per campaign', () => {
  it('creates one number per campaign, in new collections only: campaigns and legacy /p/ links are never written', async () => {
    store.set('shortLinks/x7k2m9q', { propertyId: P1 });
    store.set(`propertyShortLinks/${P1}`, { code: 'x7k2m9q' });
    const numbers = await create([P1, P2]);
    expect(numbers[P1]).toMatch(PROP_RE);
    expect(numbers[P2]).toMatch(PROP_RE);
    expect(numbers[P1]).not.toBe(numbers[P2]);
    expect(store.get(`propLinks/${numbers[P1]}`)).toMatchObject({ propertyId: P1 });
    expect(store.get(`propertyPropLinks/${P1}`)).toMatchObject({ number: numbers[P1] });
    expect(writes.every((w) => w.op === 'create' && /^(propLinks|propertyPropLinks)\//.test(w.path))).toBe(true);
    expect(store.get(`properties/${P1}`)).toEqual({ userId: 'agent1', visibility: false, address: '1 Test St' });
    expect(store.get('shortLinks/x7k2m9q')).toEqual({ propertyId: P1 }); // the legacy link is untouched
    expect(store.get(`propertyShortLinks/${P1}`)).toEqual({ code: 'x7k2m9q' });
  });

  it('an existing campaign gets its number the first time it is asked for: no migration, no campaign write', async () => {
    expect(await existingPropNumber(fakeDb, P3)).toBeNull();
    const { [P3]: number } = await create([P3]);
    expect(await existingPropNumber(fakeDb, P3)).toBe(number);
    expect(writes.map((w) => w.path.split('/')[0]).sort()).toEqual(['propLinks', 'propertyPropLinks']);
  });

  it('is stable: asking again returns the same number and writes nothing, even after the address or agent changes', async () => {
    const first = await create([P1]);
    const before = writes.length;
    store.set(`properties/${P1}`, { userId: 'another-agent', visibility: true, address: '99 Renamed Rd' });
    expect(await create([P1, P1])).toEqual(first);
    expect(writes.length).toBe(before);
  });

  it('many screens asking at the same moment still get one number', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => create([P1])));
    expect(new Set(results.map((r) => r[P1])).size).toBe(1);
    expect([...store.keys()].filter((k) => k.startsWith('propLinks/'))).toHaveLength(1);
  });

  it('a request that loses the race to another request returns the winner\'s number (never a second one)', async () => {
    let first = true;
    const racingDb = {
      ...fakeDb,
      runTransaction: async (fn) => {
        if (first) { // another request commits this campaign's number just before ours
          first = false;
          store.set('propLinks/7777777777', { propertyId: P1 });
          store.set(`propertyPropLinks/${P1}`, { number: '7777777777' });
          throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
        }
        return fakeDb.runTransaction(fn);
      },
    };
    const numbers = await getOrCreatePropNumbers(racingDb, [P1], { allowCreate: true });
    expect(numbers[P1]).toBe('7777777777');
    expect([...store.keys()].filter((k) => k.startsWith('propLinks/'))).toEqual(['propLinks/7777777777']);
  });

  it('never reuses a number that belongs to another campaign (a collision is re-rolled)', async () => {
    store.set('propLinks/1111111111', { propertyId: P2 });
    const numbers = await getOrCreatePropNumbers(fakeDb, [P1], { allowCreate: true, generate: seq('1111111111', '2222222222') });
    expect(numbers[P1]).toBe('2222222222');
    expect(store.get('propLinks/1111111111')).toEqual({ propertyId: P2 }); // untouched
  });

  it('two campaigns drawing the same number at the same moment end up with different numbers', async () => {
    const draws = seq('5555555555', '5555555555', '6666666666');
    const [a, b] = await Promise.all([
      getOrCreatePropNumbers(fakeDb, [P1], { allowCreate: true, generate: draws }),
      getOrCreatePropNumbers(fakeDb, [P3], { allowCreate: true, generate: draws }),
    ]);
    expect(new Set([a[P1], b[P3]])).toEqual(new Set(['5555555555', '6666666666']));
    expect(store.get('propLinks/5555555555').propertyId).not.toBe(store.get('propLinks/6666666666').propertyId);
  });

  it('gives up cleanly (null: the screen shows an error and a retry) if no free number is found, without overwriting', async () => {
    store.set('propLinks/1111111111', { propertyId: P2 });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const numbers = await getOrCreatePropNumbers(fakeDb, [P1], { allowCreate: true, generate: () => '1111111111' });
    err.mockRestore();
    expect(numbers[P1]).toBeNull();
    expect(store.get('propLinks/1111111111')).toEqual({ propertyId: P2 });
    expect(store.has(`propertyPropLinks/${P1}`)).toBe(false);
  });

  it('creates nothing for a campaign that does not exist, or for an id that is not a campaign id', async () => {
    const numbers = await create(['NoSuchCampaign000000', '../etc', '', null, 'a b c d e f']);
    expect(numbers).toEqual({ NoSuchCampaign000000: null });
    expect(writes).toHaveLength(0);
  });

  it('on a preview connected to live data it only reads existing numbers', async () => {
    store.set(`propertyPropLinks/${P1}`, { number: '4827319056' });
    const numbers = await getOrCreatePropNumbers(fakeDb, [P1, P2], { allowCreate: false });
    expect(numbers).toEqual({ [P1]: '4827319056', [P2]: null });
    expect(writes).toHaveLength(0);
  });

  it('caps a request at 50 campaigns', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `Campaign${String(i).padStart(12, '0')}`);
    expect(Object.keys(await getOrCreatePropNumbers(fakeDb, ids, { allowCreate: false }))).toHaveLength(50);
  });
});

describe('resolving links', () => {
  it('a prop number: ok for a live campaign, gone for a deleted one, unknown otherwise', async () => {
    const { [P1]: number } = await create([P1]);
    expect(await resolvePropNumber(fakeDb, number)).toEqual({ status: 'ok', propertyId: P1 });
    store.delete(`properties/${P1}`);
    expect(await resolvePropNumber(fakeDb, number)).toEqual({ status: 'gone', propertyId: P1 });
    expect(await resolvePropNumber(fakeDb, '9999999999')).toEqual({ status: 'unknown' });
    expect(await resolvePropNumber(fakeDb, 'not-a-number')).toEqual({ status: 'unknown' });
  });

  it('legacy /p/ codes still resolve (and are still generated in their own format for old dashboard tabs)', async () => {
    expect(SHORT_CODE_ALPHABET).toHaveLength(28);
    for (let i = 0; i < 500; i += 1) expect(generateShortCode()).toMatch(/^[23456789bcdfghjkmnpqrstvwxyz]{7}$/);
    const { [P1]: code } = await getOrCreateShortCodes(fakeDb, [P1], { allowCreate: true });
    expect(await resolveShortCode(fakeDb, code)).toEqual({ status: 'ok', propertyId: P1 });
    expect(normalizeShortCode(code.toUpperCase())).toBe(code);
    expect(await resolveShortCode(fakeDb, 'zzzzzzz')).toEqual({ status: 'unknown' });
  });
});

describe('links in emails', () => {
  it('buyerShareLink is the prop link; failing that the campaign\'s existing /p/ link; failing that the full link', async () => {
    expect(await buyerShareLink(fakeDb, P1)).toMatch(/^https:\/\/premarket\.homes\/prop[1-9]\d{9}$/);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.set(`propertyShortLinks/${P3}`, { code: 'x7k2m9q' });
    const noPropDb = { ...fakeDb, runTransaction: async () => { throw new Error('unavailable'); } };
    expect(await buyerShareLink(noPropDb, P3)).toBe(shortLinkUrl('x7k2m9q'));
    failReads = true;
    expect(await buyerShareLink(fakeDb, P2)).toBe(fullBuyerLink(P2));
    err.mockRestore();
  });

  it('buyerShareLinks gives every property in a newsletter its prop link', async () => {
    const links = await buyerShareLinks(fakeDb, [P1, P3, P1], 'https://premarket.homes');
    expect(Object.keys(links)).toEqual([P1, P3]);
    for (const link of Object.values(links)) expect(link).toMatch(/^https:\/\/premarket\.homes\/prop[1-9]\d{9}$/);
  });
});

describe('the buyer page at /prop{number} (and legacy /p/{code}): rendered directly, no redirect', () => {
  const restFetch = vi.fn(async (url) => {
    const id = decodeURIComponent(String(url).split('/properties/')[1].split('?')[0]);
    const data = store.get(`properties/${id}`);
    if (!data || data.restDown) return { ok: false, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({ fields: {
        title: { stringValue: `Home ${id.slice(0, 4)}` }, address: { stringValue: data.address || '' },
        visibility: { booleanValue: data.visibility === true }, archived: { booleanValue: data.archived === true },
      } }),
    };
  });
  beforeEach(() => { vi.stubGlobal('fetch', restFetch); restFetch.mockClear(); });
  const mod = () => import('../../src/app/p/[code]/page');
  // The rewrite hands the page the whole segment ("prop4827319056"); a legacy link hands it the code.
  const page = async (code) => (await mod()).default({ params: Promise.resolve({ code }) });
  const metadata = async (code) => (await mod()).generateMetadata({ params: Promise.resolve({ code }) });
  const numberFor = async (id) => (await create([id]))[id];
  const clientProps = (el) => el.props.children.props;
  const is404 = (p) => expect(p).rejects.toMatchObject({ digest: expect.stringContaining('404') });

  it('renders the same buyer page component, for the right campaign, at the prop address', async () => {
    const number = await numberFor(P1);
    const props = clientProps(await page(`prop${number}`));
    expect(props.propertyId).toBe(P1);
    expect(props.initialProperty).toMatchObject({ id: P1, title: 'Home AbCd' });
  });

  it('declares the prop link as the canonical address and the preview card URL (what Share and link previews use)', async () => {
    const number = await numberFor(P3);
    const meta = await metadata(`prop${number}`);
    expect(meta.alternates).toEqual({ canonical: `https://premarket.homes/prop${number}` });
    expect(meta.openGraph.url).toBe(`https://premarket.homes/prop${number}`);
    expect(meta.title).toEqual({ absolute: 'Home Mixe | Premarket' });
    expect(meta.robots).toBeUndefined(); // a public, live campaign
  });

  it('private and archived campaigns open exactly like the full link, but are kept out of search engines', async () => {
    expect(clientProps(await page(`prop${await numberFor(P1)}`)).propertyId).toBe(P1); // private
    expect(clientProps(await page(`prop${await numberFor(P2)}`)).propertyId).toBe(P2); // archived
    expect((await metadata(`prop${await numberFor(P1)}`)).robots).toEqual({ index: false, follow: false });
    expect((await metadata(`prop${await numberFor(P2)}`)).robots).toEqual({ index: false, follow: false });
  });

  it('tolerates a capitalised "Prop" and a trailing full stop', async () => {
    const number = await numberFor(P1);
    expect(clientProps(await page(`Prop${number}`)).propertyId).toBe(P1);
    expect(clientProps(await page(`PROP${number}.`)).propertyId).toBe(P1);
  });

  it('legacy /p/ links keep working, and point their canonical at the campaign\'s prop link once it has one', async () => {
    const { [P3]: code } = await getOrCreateShortCodes(fakeDb, [P3], { allowCreate: true });
    expect(clientProps(await page(code)).propertyId).toBe(P3);
    expect(clientProps(await page(`${code.toUpperCase()}.`)).propertyId).toBe(P3);
    expect((await metadata(code)).alternates).toBeUndefined(); // no prop number yet: none is created by a visit
    expect(store.has(`propertyPropLinks/${P3}`)).toBe(false);
    const number = await numberFor(P3);
    expect((await metadata(code)).alternates).toEqual({ canonical: `https://premarket.homes/prop${number}` });
  });

  it('an unknown number, a malformed link or a deleted campaign gets the not-found page (404)', async () => {
    await is404(page('prop9999999999'));
    await is404(page('prop0123456789'));
    await is404(page('prop123'));
    await is404(page('%3Cscript%3E'));
    const number = await numberFor(P1);
    store.delete(`properties/${P1}`);
    await is404(page(`prop${number}`));
    expect((await metadata('prop9999999999')).robots).toEqual({ index: false });
  });

  it('a momentary hiccup in the public read never turns a live campaign into "not found"', async () => {
    const number = await numberFor(P3);
    store.set(`properties/${P3}`, { ...store.get(`properties/${P3}`), restDown: true });
    const props = clientProps(await page(`prop${number}`));
    expect(props.propertyId).toBe(P3);
    expect(props.initialProperty).toBeNull(); // the page loads it itself, as the full link does
  });

  it('a malformed link never touches the database', async () => {
    failReads = true; // any read would throw
    await is404(page('hello'));
    await is404(page('prop12'));
  });

  it('the not-found page reveals nothing about the campaign', () => {
    const src = fs.readFileSync(new URL('../../src/app/p/[code]/not-found.js', import.meta.url), 'utf-8');
    expect(src).toContain('This link isn’t working');
    expect(src).not.toMatch(/params|propertyId|code/);
  });

  it('the full link still renders the buyer page from its ?propertyId= (unchanged)', async () => {
    const find = fs.readFileSync(new URL('../../src/app/find-property/page.js', import.meta.url), 'utf-8');
    expect(find).toContain('<PropertyPageClient initialProperty={initialProperty} />');
    expect(find).not.toMatch(/redirect|shortLink|propLink/);
    const client = fs.readFileSync(new URL('../../src/app/components/PropertyPageClient.js', import.meta.url), 'utf-8');
    expect(client).toContain("const propertyId = campaignId || previewPropertyId || searchParams.get('propertyId');");
  });
});

describe('routing: /prop{number} at the site root', () => {
  const config = fs.readFileSync(new URL('../../next.config.mjs', import.meta.url), 'utf-8');
  const rule = config.match(/\{ source: '(\/:slug\([^']+\))', destination: '([^']+)' \}/);
  const { match } = createRequire(import.meta.url)('next/dist/compiled/path-to-regexp'); // the matcher Next itself uses
  const matches = (p) => {
    const m = match(rule[1].replace(/\\\\/g, '\\'), { decode: decodeURIComponent })(p);
    return m ? m.params.slug : null;
  };

  it('is a rewrite to the buyer page (the address bar keeps /prop...), never a redirect', () => {
    expect(rule).not.toBeNull();
    expect(rule[2]).toBe('/p/:slug');
    expect(config.slice(config.indexOf('async redirects()'), config.indexOf('async rewrites()'))).not.toMatch(/prop/i);
  });

  it('matches only "prop" + 10 digits (first digit 1-9), optionally capitalised or with a trailing full stop', () => {
    expect(matches('/prop4827319056')).toBe('prop4827319056');
    expect(matches('/Prop4827319056')).toBe('Prop4827319056');
    expect(matches('/prop4827319056.')).toBe('prop4827319056.');
    for (const other of ['/', '/property', '/properties', '/prop', '/prop482731', '/prop0827319056', '/prop48273190561',
      '/prop4827319056/x', '/p/x7k2m9q', '/premarket', '/privacy', '/dashboard', '/api/prop-links', '/find-property',
      '/hph', '/harcourtsinnereast', '/Harropteam', '/login', '/prop-4827319056']) {
      expect(matches(other), other).toBeNull();
    }
  });

  it('no page, folder or public file at the root can collide with it', () => {
    const appRoot = new URL('../../src/app/', import.meta.url).pathname;
    const publicRoot = new URL('../../public/', import.meta.url).pathname;
    const names = [...fs.readdirSync(appRoot), ...fs.readdirSync(publicRoot)].map((n) => `/${path.parse(n).name}`);
    for (const n of names) expect(matches(n), n).toBeNull();
  });
});

describe('POST /api/prop-links', () => {
  const post = async (body, token = 'good') => {
    const { POST } = await import('../../src/app/api/prop-links/route');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return POST(new Request('https://premarket.homes/api/prop-links', { method: 'POST', headers, body: JSON.stringify(body) }));
  };

  it('requires sign-in', async () => {
    expect((await post({ propertyIds: [P1] }, null)).status).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it('returns numbers (never a full link) for signed-in users and validates the request', async () => {
    authSpies.verifyIdToken.mockResolvedValue({ uid: 'agent1' });
    const res = await post({ propertyIds: [P1, 'NoSuchCampaign000000'] });
    expect(res.status).toBe(200);
    const { numbers } = await res.json();
    expect(numbers[P1]).toMatch(PROP_RE);
    expect(numbers.NoSuchCampaign000000).toBeNull();
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect((await post({ propertyIds: 'x' })).status).toBe(400);
    expect((await post({ propertyIds: Array.from({ length: 51 }, (_, i) => `Campaign${String(i).padStart(12, '0')}`) })).status).toBe(400);
  });

  it('the legacy /api/short-links still answers dashboards opened before this change', async () => {
    authSpies.verifyIdToken.mockResolvedValue({ uid: 'agent1' });
    const { POST } = await import('../../src/app/api/short-links/route');
    const res = await POST(new Request('https://premarket.homes/api/short-links', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer good' }, body: JSON.stringify({ propertyIds: [P1] }),
    }));
    expect((await res.json()).codes[P1]).toMatch(/^[23456789bcdfghjkmnpqrstvwxyz]{7}$/);
  });
});

describe('every agent, BSO and office share action uses the prop link', () => {
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');
  const SCREENS = [
    'src/app/dashboard/page.js', 'src/app/dashboard/components/BsoCampaigns.js', 'src/app/dashboard/office/campaigns/page.js',
    'src/app/dashboard/office/team/page.js', 'src/app/dashboard/team/page.js', 'src/app/dashboard/property/[id]/page.js',
  ];

  it('campaign report page: Copy link (header + menu) and Preview Listing', () => {
    const src = read('src/app/dashboard/property/[id]/page.js');
    expect(src).toContain('data-testid="copy-campaign-link"');
    expect(src).toContain('const copyLink = () => copyCampaign(property.id);');
    expect(src).toMatch(/<CampaignPageLink\s+propertyId=\{property\.id\}[\s\S]{0,600}Preview Listing\s+<\/CampaignPageLink>/);
    expect(src).toContain('useCampaignLink(propertyId)'); // asked for as soon as the page opens
  });

  it('agent dashboard cards (photo, address, Copy link), BSO list (Copy buyer link, Open), Office → Campaigns (Copy link, Buyer link)', () => {
    const dash = read('src/app/dashboard/page.js');
    expect(dash).toContain('data-testid="card-copy-link"');
    expect(dash).toContain('onClick={() => copy(property.id)}');
    expect(dash.match(/<CampaignPageLink\s+propertyId=\{property\.id\}/g)).toHaveLength(2);
    const bso = read('src/app/dashboard/components/BsoCampaigns.js');
    expect(bso).toContain('copy(c.id)');
    expect(bso).toMatch(/<CampaignPageLink propertyId=\{c\.id\}[^>]*>.*Open<\/CampaignPageLink>/);
    const office = read('src/app/dashboard/office/campaigns/page.js');
    expect(office).toContain('data-testid="office-copy-link"');
    expect(office).toMatch(/<CampaignPageLink propertyId=\{c\.id\}[^>]*>.*Buyer link<\/CampaignPageLink>/);
    for (const f of ['src/app/dashboard/office/team/page.js', 'src/app/dashboard/team/page.js']) {
      expect(read(f)).toMatch(/<CampaignPageLink propertyId=\{p\.id\}/);
    }
  });

  it('no share screen builds a long link, a /p/ link or its own clipboard copy (iPad open-home mode aside)', () => {
    for (const f of SCREENS) {
      const src = read(f);
      const leftovers = src.split('\n').filter((l) => (l.includes('find-property') && !l.includes('mode=ipad')) || /['"`]\/p\/|clipboard|window\.prompt/.test(l));
      expect(leftovers, f).toEqual([]);
    }
  });

  it('the agent\'s campaign-link email carries the prop link', async () => {
    expect(read('src/app/api/services/agentNotificationService.js')).toContain('link: await buyerShareLink(adminDb, propertyId)');
    const { sendCampaignLinkToAgentEmail } = await import('../../src/app/api/services/agentCampaignEmail');
    sentEmails.length = 0;
    await sendCampaignLinkToAgentEmail({ to: 'agent@example.com', firstName: 'Jo', propertyAddress: '1 Test St', propertyId: P1, link: 'https://premarket.homes/prop4827319056' });
    expect(sentEmails[0].html).toContain('https://premarket.homes/prop4827319056');
    expect(sentEmails[0].html).not.toContain('find-property');
  });

  it('the weekly buyer newsletter links each property by its prop link (full link only if a property has none)', async () => {
    const { generateNewsletterHTML } = await import('../../src/app/api/services/newsletterService');
    const mk = (id) => ({ id, title: `T ${id}`, price: 900000, imageUrl: null, created: new Date() });
    const html = generateNewsletterHTML({ email: 'b@example.com', firstName: 'B' }, [mk(P1), mk(P3)], [], { [P1]: 'https://premarket.homes/prop4827319056' });
    expect(html).toContain('href="https://premarket.homes/prop4827319056"');
    expect(html).not.toContain(`find-property?propertyId=${P1}`);
    expect(html).toContain(`find-property?propertyId=${P3}`);
    expect(read('src/app/api/services/newsletterService.js')).toContain('await buyerShareLinks(adminDb,');
  });
});
