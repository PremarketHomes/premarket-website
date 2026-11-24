import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';

// In-memory Firestore with the parts the short-link service uses: doc get, getAll, and serialised transactions whose
// create() refuses to overwrite (like Firestore's). Every write is recorded so tests can prove campaigns are untouched.
const store = new Map(); // 'col/id' -> data
const writes = [];
let failReads = false;

const snap = (path) => {
  const data = store.get(path);
  return { exists: data !== undefined, id: path.split('/')[1], data: () => (data === undefined ? undefined : { ...data }) };
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
      for (const [path] of pending) if (store.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
      for (const [path, data] of pending) { writes.push({ op: 'create', path }); store.set(path, { ...data }); }
      return out;
    });
    txChain = run.catch(() => {});
    return run;
  },
};

vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: fakeDb }));
const sentEmails = [];
vi.mock('../../src/app/api/services/resendService', () => ({ sendEmail: vi.fn(async (msg) => { sentEmails.push(msg); return { id: 'test' }; }) }));
const authSpies = { verifyIdToken: vi.fn() };
vi.mock('firebase-admin/auth', () => ({ getAuth: () => authSpies }));
// The buyer page component itself is client-side; the /p/ page tests only check what it is given.
vi.mock('../../src/app/components/PropertyPageClient', () => ({ default: function PropertyPageClient() { return null; } }));

const utils = await import('../../src/app/utils/shortLinks');
const service = await import('../../src/app/api/services/shortLinkService');
const { SHORT_CODE_ALPHABET, normalizeShortCode, shortLinkUrl, fullBuyerLink } = utils;
const { generateShortCode, getOrCreateShortCodes, resolveShortCode, buyerShareLink } = service;

const P1 = 'AbCdEfGhIjKlMnOpQrSt'; // Firestore-style 20-character ids
const P2 = 'ZyXwVuTsRqPoNmLkJiHg';
const P3 = 'Mixed_case-id_123456';
const seq = (...codes) => { let i = 0; return () => codes[Math.min(i++, codes.length - 1)]; };

beforeEach(() => {
  store.clear(); writes.length = 0; failReads = false; authSpies.verifyIdToken.mockReset();
  store.set(`properties/${P1}`, { userId: 'agent1', visibility: false, address: '1 Test St' });
  store.set(`properties/${P2}`, { userId: 'agent2', visibility: true, archived: true });
  store.set(`properties/${P3}`, { userId: 'agent3', visibility: true });
});

describe('short-link format', () => {
  it('is 7 characters from an alphabet with no vowels and no look-alike characters', () => {
    expect(SHORT_CODE_ALPHABET).toHaveLength(28);
    expect(SHORT_CODE_ALPHABET).not.toMatch(/[aeiou01l]/);
    expect(new Set(SHORT_CODE_ALPHABET).size).toBe(28);
    for (let i = 0; i < 2000; i += 1) expect(generateShortCode()).toMatch(/^[23456789bcdfghjkmnpqrstvwxyz]{7}$/);
  });

  it('uses every character of the alphabet (randomness reaches the whole space)', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) for (const ch of generateShortCode()) seen.add(ch);
    expect(seen.size).toBe(28);
  });

  it('a short link is 33 characters; the full link it replaces is 69', () => {
    expect(shortLinkUrl('x7k2m9q')).toBe('https://premarket.homes/p/x7k2m9q');
    expect(shortLinkUrl('x7k2m9q')).toHaveLength(33);
    expect(fullBuyerLink(P1)).toBe(`https://premarket.homes/find-property?propertyId=${P1}`);
    expect(fullBuyerLink(P1)).toHaveLength(69);
  });

  it('accepts the ways a pasted link gets mangled, rejects anything else', () => {
    expect(normalizeShortCode('x7k2m9q')).toBe('x7k2m9q');
    expect(normalizeShortCode('X7K2M9Q')).toBe('x7k2m9q');
    expect(normalizeShortCode('x7k2m9q.')).toBe('x7k2m9q');
    expect(normalizeShortCode('x7k2m9q).')).toBe('x7k2m9q');
    expect(normalizeShortCode('%20x7k2m9q')).toBe('x7k2m9q');
    for (const bad of ['', 'x7k2m9', 'x7k2m9qq', 'a7k2m9q', 'x7k2m0q', '../../x', 'x7k2m9q/x', null, undefined, 42, 'x'.repeat(100)]) {
      expect(normalizeShortCode(bad)).toBeNull();
    }
  });
});

describe('getOrCreateShortCodes', () => {
  it('creates one code per campaign, in new collections only: campaign documents are never written', async () => {
    const codes = await getOrCreateShortCodes(fakeDb, [P1, P2], { allowCreate: true });
    expect(codes[P1]).toMatch(/^[23456789bcdfghjkmnpqrstvwxyz]{7}$/);
    expect(codes[P2]).toMatch(/^[23456789bcdfghjkmnpqrstvwxyz]{7}$/);
    expect(codes[P1]).not.toBe(codes[P2]);
    expect(store.get(`shortLinks/${codes[P1]}`)).toMatchObject({ propertyId: P1 });
    expect(store.get(`propertyShortLinks/${P1}`)).toMatchObject({ code: codes[P1] });
    expect(writes.every((w) => w.op === 'create' && /^(shortLinks|propertyShortLinks)\//.test(w.path))).toBe(true);
    expect(store.get(`properties/${P1}`)).toEqual({ userId: 'agent1', visibility: false, address: '1 Test St' });
  });

  it('is stable: asking again returns the same code and writes nothing', async () => {
    const first = await getOrCreateShortCodes(fakeDb, [P1], { allowCreate: true });
    const before = writes.length;
    const again = await getOrCreateShortCodes(fakeDb, [P1, P1], { allowCreate: true });
    expect(again).toEqual(first);
    expect(writes.length).toBe(before);
  });

  it('two screens asking at the same moment still get one code', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => getOrCreateShortCodes(fakeDb, [P1], { allowCreate: true })));
    expect(new Set(results.map((r) => r[P1])).size).toBe(1);
    expect([...store.keys()].filter((k) => k.startsWith('shortLinks/'))).toHaveLength(1);
  });

  it('never reuses a code that belongs to another campaign (collision is retried)', async () => {
    store.set('shortLinks/bbbbbbb', { propertyId: P2 });
    const codes = await getOrCreateShortCodes(fakeDb, [P1], { allowCreate: true, generate: seq('bbbbbbb', 'ccccccc') });
    expect(codes[P1]).toBe('ccccccc');
    expect(store.get('shortLinks/bbbbbbb')).toEqual({ propertyId: P2 }); // untouched
  });

  it('gives up cleanly (null, full link used) if no free code is found, without overwriting', async () => {
    store.set('shortLinks/bbbbbbb', { propertyId: P2 });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const codes = await getOrCreateShortCodes(fakeDb, [P1], { allowCreate: true, generate: () => 'bbbbbbb' });
    err.mockRestore();
    expect(codes[P1]).toBeNull();
    expect(store.get('shortLinks/bbbbbbb')).toEqual({ propertyId: P2 });
    expect(store.has(`propertyShortLinks/${P1}`)).toBe(false);
  });

  it('creates nothing for a campaign that does not exist, or for an id that is not a campaign id', async () => {
    const codes = await getOrCreateShortCodes(fakeDb, ['NoSuchCampaign000000', '../etc', '', null, 'a b c d e f'], { allowCreate: true });
    expect(codes).toEqual({ NoSuchCampaign000000: null });
    expect(writes).toHaveLength(0);
  });

  it('on a preview connected to live data it only reads existing codes', async () => {
    store.set(`propertyShortLinks/${P1}`, { code: 'ddddddd' });
    const codes = await getOrCreateShortCodes(fakeDb, [P1, P2], { allowCreate: false });
    expect(codes).toEqual({ [P1]: 'ddddddd', [P2]: null });
    expect(writes).toHaveLength(0);
  });

  it('caps a request at 50 campaigns', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `Campaign${String(i).padStart(12, '0')}`);
    const codes = await getOrCreateShortCodes(fakeDb, ids, { allowCreate: false });
    expect(Object.keys(codes)).toHaveLength(50);
  });
});

describe('resolveShortCode', () => {
  it('ok for a live campaign, gone for a deleted one, unknown otherwise', async () => {
    const { [P1]: code } = await getOrCreateShortCodes(fakeDb, [P1], { allowCreate: true });
    expect(await resolveShortCode(fakeDb, code)).toEqual({ status: 'ok', propertyId: P1 });
    store.delete(`properties/${P1}`);
    expect(await resolveShortCode(fakeDb, code)).toEqual({ status: 'gone', propertyId: P1 });
    expect(await resolveShortCode(fakeDb, 'zzzzzzz')).toEqual({ status: 'unknown' });
    expect(await resolveShortCode(fakeDb, 'not-a-code')).toEqual({ status: 'unknown' });
  });
});

describe('buyerShareLink (campaign-link email)', () => {
  it('is the short link, or the full link if short links fail', async () => {
    const link = await buyerShareLink(fakeDb, P1);
    expect(link).toMatch(/^https:\/\/premarket\.homes\/p\/[23456789bcdfghjkmnpqrstvwxyz]{7}$/);
    failReads = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await buyerShareLink(fakeDb, P3)).toBe(fullBuyerLink(P3));
    err.mockRestore();
  });
});

describe('/p/{code} renders the campaign page itself (no redirect)', () => {
  const restFetch = vi.fn(async (url) => {
    const id = decodeURIComponent(String(url).split('/properties/')[1].split('?')[0]);
    const data = store.get(`properties/${id}`);
    if (!data) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ fields: { title: { stringValue: `Home ${id.slice(0, 4)}` }, address: { stringValue: data.address || '' } } }) };
  });
  beforeEach(() => { vi.stubGlobal('fetch', restFetch); restFetch.mockClear(); });
  const page = async (code) => (await import('../../src/app/p/[code]/page')).default({ params: Promise.resolve({ code }) });
  const metadata = async (code) => (await import('../../src/app/p/[code]/page')).generateMetadata({ params: Promise.resolve({ code }) });
  const codeFor = async (id) => (await getOrCreateShortCodes(fakeDb, [id], { allowCreate: true }))[id];
  const clientProps = (el) => el.props.children.props;
  const is404 = (p) => expect(p).rejects.toMatchObject({ digest: expect.stringContaining('404') });

  it('renders the same buyer page component, for the right campaign, at the short address', async () => {
    const code = await codeFor(P1);
    const props = clientProps(await page(code));
    expect(props.propertyId).toBe(P1);
    expect(props.initialProperty).toMatchObject({ id: P1, title: 'Home AbCd' });
  });

  it('gives link previews (SMS, iMessage, email) the campaign title, with no doubled "| Premarket"', async () => {
    const meta = await metadata(await codeFor(P1));
    expect(meta.openGraph.title).toBe('Home AbCd | Premarket');
    expect(meta.title).toEqual({ absolute: 'Home AbCd | Premarket' });
  });

  it('works for private and archived campaigns exactly like the full link (the buyer page decides)', async () => {
    expect(clientProps(await page(await codeFor(P1))).propertyId).toBe(P1); // visibility false
    expect(clientProps(await page(await codeFor(P2))).propertyId).toBe(P2); // archived
  });

  it('tolerates case changes and a trailing full stop', async () => {
    const code = await codeFor(P1);
    expect(clientProps(await page(code.toUpperCase())).propertyId).toBe(P1);
    expect(clientProps(await page(`${code}.`)).propertyId).toBe(P1);
  });

  it('an unknown code, a malformed one or a deleted campaign gets the not-found page (404)', async () => {
    await is404(page('zzzzzzz'));
    await is404(page('hello'));
    await is404(page('%3Cscript%3E'));
    const code = await codeFor(P1);
    store.delete(`properties/${P1}`);
    await is404(page(code));
    expect((await metadata('zzzzzzz')).robots).toEqual({ index: false });
  });

  it('the not-found page reveals nothing about the campaign', () => {
    const src = fs.readFileSync(new URL('../../src/app/p/[code]/not-found.js', import.meta.url), 'utf-8');
    expect(src).toContain('This link isn’t working');
    expect(src).not.toMatch(/params|propertyId|code/);
  });

  it('a malformed code never touches the database', async () => {
    failReads = true; // any read would throw
    await is404(page('hello'));
  });
});

describe('POST /api/short-links', () => {
  const post = async (body, token = 'good') => {
    const { POST } = await import('../../src/app/api/short-links/route');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return POST(new Request('https://premarket.homes/api/short-links', { method: 'POST', headers, body: JSON.stringify(body) }));
  };

  it('requires sign-in', async () => {
    expect((await post({ propertyIds: [P1] }, null)).status).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it('returns codes for signed-in users and validates the request', async () => {
    authSpies.verifyIdToken.mockResolvedValue({ uid: 'agent1' });
    const res = await post({ propertyIds: [P1, 'NoSuchCampaign000000'] });
    expect(res.status).toBe(200);
    const { codes } = await res.json();
    expect(codes[P1]).toMatch(/^[23456789bcdfghjkmnpqrstvwxyz]{7}$/);
    expect(codes.NoSuchCampaign000000).toBeNull();
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect((await post({ propertyIds: 'x' })).status).toBe(400);
    expect((await post({ propertyIds: Array.from({ length: 51 }, (_, i) => `Campaign${String(i).padStart(12, '0')}`) })).status).toBe(400);
  });
});

describe('share screens and the campaign-link email use the short link', () => {
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');

  it('campaign report page: Copy link (header + menu) copies the short link, Preview Listing opens it', () => {
    const src = read('src/app/dashboard/property/[id]/page.js');
    expect(src).toContain('data-testid="copy-campaign-link"');
    expect(src).toContain('copyCampaignLink(property.id, shortCode)');
    expect(src).toContain('href={campaignPath(property.id, shortCode)}');
    // requested as soon as the page opens (from the URL), not after the report has loaded
    expect(src).toContain('useShortCode(propertyId)');
  });

  it('agent dashboard, BSO list and Office → Campaigns copy and open the short link', () => {
    const dash = read('src/app/dashboard/page.js');
    expect(dash).toContain('data-testid="card-copy-link"');
    expect(dash).toContain('copyCampaignLink(property.id, shortCode)');
    const bso = read('src/app/dashboard/components/BsoCampaigns.js');
    expect(bso).toContain('copyCampaignLink(c.id, shortCodes[c.id])');
    expect(bso).toContain('href={campaignPath(c.id, shortCodes[c.id])}');
    const office = read('src/app/dashboard/office/campaigns/page.js');
    expect(office).toContain('data-testid="office-copy-link"');
    expect(office).toContain('href={campaignPath(c.id, shortCodes[c.id])}');
  });

  it('no agent, BSO, office or team screen links to the full buyer address any more (iPad open-home mode and admin aside)', () => {
    const files = [
      'src/app/dashboard/page.js', 'src/app/dashboard/components/BsoCampaigns.js', 'src/app/dashboard/office/campaigns/page.js',
      'src/app/dashboard/office/team/page.js', 'src/app/dashboard/team/page.js', 'src/app/dashboard/property/[id]/page.js',
    ];
    for (const f of files) {
      const leftovers = read(f).split('\n').filter((l) => l.includes('find-property') && !l.includes('mode=ipad'));
      expect(leftovers, f).toEqual([]);
    }
  });

  it('the campaign-link email carries the short link (and still works with only a campaign id)', async () => {
    expect(read('src/app/api/services/agentNotificationService.js')).toContain('link: await buyerShareLink(adminDb, propertyId)');
    const { sendCampaignLinkToAgentEmail } = await import('../../src/app/api/services/agentCampaignEmail');
    sentEmails.length = 0;
    await sendCampaignLinkToAgentEmail({ to: 'agent@example.com', firstName: 'Jo', propertyAddress: '1 Test St', propertyId: P1, link: 'https://premarket.homes/p/x7k2m9q' });
    expect(sentEmails[0].html).toContain('https://premarket.homes/p/x7k2m9q');
    expect(sentEmails[0].html).not.toContain('find-property');
    await sendCampaignLinkToAgentEmail({ to: 'agent@example.com', firstName: 'Jo', propertyAddress: '1 Test St', propertyId: P1 });
    expect(sentEmails[1].html).toContain(fullBuyerLink(P1));
  });

  it('the full link still renders the buyer page from its ?propertyId= (unchanged); the component only gained an optional id', () => {
    const find = read('src/app/find-property/page.js');
    expect(find).toContain('<PropertyPageClient initialProperty={initialProperty} />');
    expect(find).not.toMatch(/redirect|shortLink/);
    const client = read('src/app/components/PropertyPageClient.js');
    expect(client).toContain("const propertyId = campaignId || previewPropertyId || searchParams.get('propertyId');");
  });
});
