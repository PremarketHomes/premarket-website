import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

// Marketing channel links (Email / SMS / General): how opens and new anonymous opinions are counted per channel, what the
// campaign report shows, and what it withholds so a channel can never single out a buyer.

// --- an in-memory Admin Firestore with deep merge, increments and all-or-nothing transactions ---------------------------
const INC = Symbol('increment');
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (n) => ({ [INC]: n }),
    serverTimestamp: () => new Date(),
  },
  Timestamp: { fromDate: (d) => d },
}));

const store = new Map();
const writes = [];
let failNextWrite = null; // a collection name whose next write throws
const clone = (v) => (v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
function deepMerge(target, patch) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && INC in v) out[k] = (Number(out[k]) || 0) + v[INC];
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) out[k] = deepMerge(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
function applyWrite(path, data, opts) {
  const coll = path.split('/')[0];
  if (failNextWrite === coll) { failNextWrite = null; throw new Error(`${coll} down`); }
  writes.push({ path, data: clone(data) });
  store.set(path, opts?.merge ? deepMerge(store.get(path), data) : deepMerge({}, data));
}
const snap = (path) => ({ exists: store.has(path), id: path.split('/')[1], data: () => clone(store.get(path)) });
const docRef = (coll, id) => {
  const path = `${coll}/${id}`;
  return {
    id, path,
    get: async () => snap(path),
    set: async (data, opts) => applyWrite(path, data, opts),
    update: async (patch) => {
      if (!store.has(path)) throw new Error('NOT_FOUND');
      const flat = {};
      for (const [k, v] of Object.entries(patch)) {
        const parts = k.split('.');
        let cur = flat;
        parts.slice(0, -1).forEach((p) => { cur[p] = cur[p] || {}; cur = cur[p]; });
        cur[parts[parts.length - 1]] = v;
      }
      applyWrite(path, flat, { merge: true });
    },
  };
};
let autoId = 0;
const db = {
  collection: (coll) => ({
    doc: (id) => docRef(coll, id),
    add: async (data) => { const id = `auto${++autoId}`; applyWrite(`${coll}/${id}`, data); return { id }; },
    where: () => ({ get: async () => ({ docs: [], empty: true }) }),
  }),
  runTransaction: async (fn) => {
    const pending = [];
    const tx = { get: async (r) => snap(r.path), set: (r, d, o) => { pending.push([r.path, d, o]); return tx; } };
    const out = await fn(tx);
    for (const [p, d, o] of pending) applyWrite(p, d, o);
    return out;
  },
};
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: db }));

const { buildChannelReport, conversionRate } = await import('../../src/app/api/services/channelReport');
const attribution = await import('../../src/app/api/services/channelAttribution');
const { recordChannelView, recordChannelOpinion, opinionCreditRefusal, guardHash, CHANNEL_STATS, CHANNEL_GUARDS, loadChannelReport } = attribution;
const { CHANNELS, MIN_CHANNEL_OPINIONS } = await import('../../src/app/utils/campaignChannels');

const PID = 'm_4f5dde97f19d3f585db914ca';
const NOW = Date.UTC(2026, 10, 26, 1, 0, 0);
const offer = (over = {}) => ({
  type: 'opinion', propertyId: PID, sessionId: 'session_1', visitorId: 'v_1', offerAmount: 1100000, fromWeb: true,
  createdAt: new Date(NOW - 5000), updatedAt: new Date(NOW - 5000), ...over,
});

beforeEach(() => { store.clear(); writes.length = 0; failNextWrite = null; delete process.env.VERCEL_ENV; });
afterEach(() => { delete process.env.VERCEL_ENV; });

// ------------------------------------------------------------------------------------------------------------------------
describe('the report: Views, Price opinions and Conversion per channel', () => {
  const report = (email, sms, totalViews, priceCount) => buildChannelReport({
    channelStats: { email: { views: email[0], opinions: email[1] }, sms: { views: sms[0], opinions: sms[1] } },
    propertyStats: { views: totalViews },
    priceCount,
  });
  const row = (r, key) => r.rows.find((x) => x.key === key);

  it('General / Unknown is everything else: total minus the channel links (history is never re-labelled)', () => {
    const r = report([60, 6], [25, 3], 100, 12);
    expect(row(r, 'general')).toMatchObject({ label: 'General / Unknown', views: 15 });
    expect(r.total).toEqual({ views: 100, opinions: 12, conversion: 12 });
    expect(r.rows.map((x) => x.key)).toEqual(['email', 'sms', 'general']);
  });

  it('every channel with 3 or more opinions is shown exactly, with conversion = opinions ÷ views', () => {
    const r = report([60, 6], [25, 3], 100, 12);
    expect(row(r, 'email')).toMatchObject({ views: 60, opinions: 6, conversion: 10, opinionsHidden: false });
    expect(row(r, 'sms')).toMatchObject({ views: 25, opinions: 3, conversion: 12, opinionsHidden: false });
    expect(row(r, 'general')).toMatchObject({ views: 15, opinions: 3, conversion: 20, opinionsHidden: false });
    expect(r.withheld).toBeNull();
    expect(r.combined).toBeNull();
  });

  it('a campaign from before channel links (like Worongary): everything is General / Unknown, Email and SMS are 0', () => {
    const r = buildChannelReport({ channelStats: null, propertyStats: { views: 96 }, priceCount: 8 });
    expect(r.tracking).toBe(false);
    expect(row(r, 'email')).toMatchObject({ views: 0, used: false, opinions: 0, conversion: null });
    expect(row(r, 'sms')).toMatchObject({ views: 0, used: false, opinions: 0 });
    expect(row(r, 'general')).toMatchObject({ views: 96, opinions: 8, conversion: 8, opinionsHidden: false });
  });

  it('a channel under 3 opinions (zero included) is withheld, and so is the next smallest, shown only combined', () => {
    // The illustrative layout: Email 6, SMS 3, General 0 (with views). General's 0 alone could later flip to 1.
    const r = report([60, 6], [25, 3], 93, 9);
    expect(row(r, 'email')).toMatchObject({ opinions: 6, conversion: 10, opinionsHidden: false });
    expect(row(r, 'sms')).toMatchObject({ opinions: null, conversion: null, opinionsHidden: true });
    expect(row(r, 'general')).toMatchObject({ opinions: null, conversion: null, opinionsHidden: true });
    expect(r.combined).toEqual({ keys: ['sms', 'general'], labels: ['SMS', 'General / Unknown'], views: 33, opinions: 3, conversion: 9 });
  });

  it('withholds every channel when the withheld ones together would still be under 3', () => {
    const r = report([40, 2], [5, 0], 60, 9); // general = 7, email 2 and sms 0 hidden, sum 2 < 3
    expect(r.rows.every((x) => !x.used || x.opinionsHidden)).toBe(true);
    expect(r.withheld).toBe('small');
    expect(r.combined).toBeNull();
    expect(r.total.opinions).toBe(9); // the campaign total is still shown, as it always has been
  });

  it('with no opinions at all, every count is simply 0 (nothing to protect)', () => {
    const r = report([10, 0], [4, 0], 20, 0);
    expect(r.rows.map((x) => x.opinions)).toEqual([0, 0, 0]);
    expect(r.withheld).toBeNull();
  });

  it('never shows numbers that do not add up (an opinion later excluded by Premarket stays in its channel)', () => {
    const r = report([10, 3], [10, 1], 30, 3);
    expect(r.withheld).toBe('inconsistent');
    expect(r.rows.every((x) => x.opinions === null || !x.used)).toBe(true);
  });

  it('views are always shown exactly (they are not tied to any price)', () => {
    const r = report([40, 2], [5, 0], 60, 9);
    expect(r.rows.map((x) => x.views)).toEqual([40, 5, 15]);
  });

  it('conversion rounds to a whole percentage, is capped at 100 and is blank without views', () => {
    expect(conversionRate(1, 3)).toBe(33);
    expect(conversionRate(5, 2)).toBe(100);
    expect(conversionRate(0, 0)).toBeNull();
  });

  it('a malformed stats document can only ever read as zero', () => {
    const r = buildChannelReport({ channelStats: { email: { views: 'lots', opinions: -4 }, sms: null, __proto__: { x: 1 } }, propertyStats: {}, priceCount: undefined });
    expect(r.rows.map((x) => [x.views, x.opinions])).toEqual([[0, 0], [0, 0], [0, 0]]);
  });
});

// ------------------------------------------------------------------------------------------------------------------------
describe('low numbers can never single out a buyer (checked for every small combination)', () => {
  const K = MIN_CHANNEL_OPINIONS;
  const states = [];
  for (let e = 0; e <= 7; e += 1) for (let s = 0; s <= 7; s += 1) for (let g = 0; g <= 7; g += 1) {
    for (const [ev, sv, gv] of [[0, 0, 0], [1, 1, 1], [0, 3, 2], [5, 0, 4], [9, 2, 0], [20, 1, 3]]) {
      // views must be possible: a channel with opinions was opened at least that often
      states.push({ e, s, g, ev: Math.max(ev, e), sv: Math.max(sv, s), gv: Math.max(gv, g) });
    }
  }
  const run = ({ e, s, g, ev, sv, gv }) => buildChannelReport({
    channelStats: { email: { views: ev, opinions: e }, sms: { views: sv, opinions: s } },
    propertyStats: { views: ev + sv + gv },
    priceCount: e + s + g,
  });
  // Everything an agent can read from the table, minus the campaign total they can read anyway.
  const visible = (r) => JSON.stringify({ rows: r.rows.map((x) => [x.key, x.views, x.opinions, x.conversion, x.opinionsHidden]), combined: r.combined, withheld: r.withheld });

  it('every opinion count shown for a channel that was used is at least 3 (or there are no opinions at all)', () => {
    for (const st of states) {
      const r = run(st);
      if (r.total.opinions === 0) continue;
      for (const x of r.rows) if (x.used && !x.opinionsHidden) expect(x.opinions, JSON.stringify(st)).toBeGreaterThanOrEqual(K);
    }
  });

  it('a withheld channel can never be worked out from the total: never exactly one, and together at least 3', () => {
    for (const st of states) {
      const r = run(st);
      const hidden = r.rows.filter((x) => x.used && x.opinionsHidden);
      if (!hidden.length || r.withheld) continue;
      expect(hidden.length, JSON.stringify(st)).toBeGreaterThanOrEqual(2);
      expect(r.combined.opinions, JSON.stringify(st)).toBeGreaterThanOrEqual(K);
      const shown = r.rows.filter((x) => !x.opinionsHidden).reduce((t, x) => t + x.opinions, 0);
      expect(shown + r.combined.opinions).toBe(r.total.opinions);
    }
  });

  it('a new opinion in one withheld channel looks exactly the same as one in another (no before/after give-away)', () => {
    // e.g. the agent sends the SMS link to one buyer only and watches for a change: an SMS opinion and a General one
    // must be indistinguishable on screen.
    let compared = 0;
    for (const st of states) {
      const r = run(st);
      const hidden = r.rows.filter((x) => x.used && x.opinionsHidden).map((x) => x.key);
      if (hidden.length < 2) continue;
      for (const from of hidden) for (const to of hidden) {
        if (from === to) continue;
        const key = { email: 'e', sms: 's', general: 'g' };
        const moved = { ...st, [key[from]]: st[key[from]] - 1, [key[to]]: st[key[to]] + 1 };
        if (moved[key[from]] < 0 || moved.ev < moved.e || moved.sv < moved.s || moved.gv < moved.g) continue;
        const r2 = run(moved);
        const hidden2 = r2.rows.filter((x) => x.used && x.opinionsHidden).map((x) => x.key);
        if (hidden2.join() !== hidden.join()) continue; // a different grouping is a different (also protected) state
        expect(visible(r2), `${JSON.stringify(st)} -> ${JSON.stringify(moved)}`).toBe(visible(r));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('views alone never change which channels are withheld (no grouping that flips back and forth)', () => {
    // Equal opinion counts (Email 5, General 5) with SMS withheld: which one joins SMS must not depend on views.
    const groupings = new Set();
    for (const [ev, gv] of [[100, 10], [10, 100], [50, 50], [6, 200]]) {
      const r = run({ e: 5, s: 1, g: 5, ev, sv: 3, gv });
      groupings.add(r.rows.filter((x) => x.opinionsHidden).map((x) => x.key).join());
    }
    expect([...groupings]).toEqual(['sms,general']);
    for (const st of states) {
      if (!(st.ev && st.sv && st.gv)) continue; // every channel opened: the same opinions must give the same grouping
      const a = run(st).rows.map((x) => x.opinionsHidden).join();
      const b = run({ ...st, ev: st.ev + 7, sv: st.sv + 13, gv: st.gv + 1 }).rows.map((x) => x.opinionsHidden).join();
      expect(b, JSON.stringify(st)).toBe(a);
    }
  });

  it('a channel sent to a single buyer stays withheld whether or not that buyer gives an opinion', () => {
    // Email to many (10 opinions), SMS to one buyer, a little General traffic.
    const before = run({ e: 10, s: 0, g: 4, ev: 100, sv: 1, gv: 10 });
    const after = run({ e: 10, s: 1, g: 4, ev: 100, sv: 1, gv: 10 });
    for (const r of [before, after]) {
      expect(r.rows.find((x) => x.key === 'sms').opinionsHidden).toBe(true);
      expect(r.rows.find((x) => x.key === 'sms').opinions).toBeNull();
    }
  });

  it('never sends a withheld figure to the browser', () => {
    for (const st of states) {
      for (const x of run(st).rows) if (x.opinionsHidden) expect([x.opinions, x.conversion]).toEqual([null, null]);
    }
  });

  it('no amount, median, date, time or order is ever part of the channel figures', () => {
    const src = fs.readFileSync(new URL('../../src/app/api/services/channelReport.js', import.meta.url), 'utf-8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/offerAmount|median|createdAt|timestamp|Date\(/i);
    const r = run({ e: 5, s: 4, g: 3, ev: 50, sv: 40, gv: 30 });
    expect(Object.keys(r).sort()).toEqual(['combined', 'minOpinions', 'rows', 'total', 'tracking', 'withheld']);
    expect(Object.keys(r.rows[0]).sort()).toEqual(['conversion', 'key', 'label', 'opinions', 'opinionsHidden', 'used', 'views']);
  });
});

// ------------------------------------------------------------------------------------------------------------------------
describe('counting opens of a channel link', () => {
  it('adds one to that channel\'s views for the campaign, and nothing else', async () => {
    expect(await recordChannelView(db, { propertyId: PID, channel: 'email' })).toBe(true);
    expect(await recordChannelView(db, { propertyId: PID, channel: 'email' })).toBe(true);
    expect(await recordChannelView(db, { propertyId: PID, channel: 'sms' })).toBe(true);
    expect(store.get(`${CHANNEL_STATS}/${PID}`)).toEqual({ propertyId: PID, email: { views: 2 }, sms: { views: 1 } });
    expect([...store.keys()]).toEqual([`${CHANNEL_STATS}/${PID}`]);
  });

  it('ignores anything that is not a known channel (no general counter, no made-up channels)', async () => {
    for (const channel of ['general', 'facebook', 'EMAIL', '', null, undefined, '__proto__', { key: 'email' }]) {
      expect(await recordChannelView(db, { propertyId: PID, channel })).toBe(false);
    }
    expect(await recordChannelView(db, { propertyId: '../offers/x', channel: 'sms' })).toBe(false);
    expect(store.size).toBe(0);
  });
});

describe('crediting a new anonymous opinion to its channel', () => {
  const seed = (id, data) => store.set(`offers/${id}`, clone(data));
  const credit = (over = {}) => recordChannelOpinion(db, { propertyId: PID, offerId: 'op1', sessionId: 'session_1', channel: 'sms', now: NOW, ...over });

  it('counts a just-created anonymous web opinion once, under the channel its page was opened with', async () => {
    seed('op1', offer());
    expect(await credit()).toEqual({ counted: true });
    expect(store.get(`${CHANNEL_STATS}/${PID}`)).toEqual({ propertyId: PID, sms: { opinions: 1 } });
    expect(await credit()).toEqual({ counted: false, reason: 'already-counted' });
    expect(await credit({ channel: 'email' })).toEqual({ counted: false, reason: 'already-counted' }); // not re-labelled
    expect(store.get(`${CHANNEL_STATS}/${PID}`)).toEqual({ propertyId: PID, sms: { opinions: 1 } });
  });

  it('never writes anything to the opinion itself', async () => {
    seed('op1', offer());
    const before = store.get('offers/op1');
    await credit();
    expect(store.get('offers/op1')).toEqual(before);
    expect(writes.some((w) => w.path.startsWith('offers/'))).toBe(false);
  });

  it('stores no buyer, visitor, session, opinion id, amount, time or order: totals, plus an order-free counted marker', async () => {
    for (const [id, session] of [['op1', 's1'], ['op2', 's2'], ['op3', 's3']]) {
      seed(id, offer({ sessionId: session }));
      await credit({ offerId: id, sessionId: session, channel: id === 'op2' ? 'email' : 'sms' });
    }
    const stats = store.get(`${CHANNEL_STATS}/${PID}`);
    expect(stats).toEqual({ propertyId: PID, sms: { opinions: 2 }, email: { opinions: 1 } });
    const guard = store.get(`${CHANNEL_GUARDS}/${PID}`);
    expect(Object.keys(guard)).toEqual(['h']);
    expect(guard.h).toEqual([...guard.h].sort()); // sorted: no submission order
    expect(guard.h).toHaveLength(3);
    const all = JSON.stringify([stats, guard]);
    for (const secret of ['op1', 'op2', 'op3', 's1', 's2', 's3', 'session', 'v_1', '1100000']) {
      expect(all.includes(secret), secret).toBe(false);
    }
    expect(JSON.stringify(guard)).not.toMatch(/email|sms/); // the marker never says which channel
    expect(guard.h).toContain(guardHash(PID, 'op2'));
  });

  it.each([
    ['another browser tab (sessionId differs)', {}, { sessionId: 'someone_else' }, 'not-this-visitor'],
    ['another campaign\'s opinion', { propertyId: 'otherCampaign' }, {}, 'other-campaign'],
    ['an opinion with no price', { offerAmount: undefined }, {}, 'no-price'],
    ['an opinion that already carries a registration', { serious: true, buyerName: 'A Buyer', buyerEmail: 'a@b.c', buyerPhone: '0400' }, {}, 'registered'],
    ['an opinion linked to an account', { userId: 'uid1' }, {}, 'registered'],
    ['an iPad (open home) opinion', { fromIpadMode: true }, {}, 'kiosk'],
    ['an opinion Premarket excluded', { reportExclusion: { excluded: true, kind: 'test' } }, {}, 'excluded'],
    ['an older opinion (re-labelling history)', { createdAt: new Date(NOW - 31 * 60 * 1000) }, {}, 'not-new'],
    ['a non-opinion offer', { type: 'offer' }, {}, 'not-opinion'],
  ])('refuses %s', async (_label, offerOver, callOver, reason) => {
    seed('op1', offer(offerOver));
    expect(await credit(callOver)).toEqual({ counted: false, reason });
    expect(store.has(`${CHANNEL_STATS}/${PID}`)).toBe(false);
    expect(store.has(`${CHANNEL_GUARDS}/${PID}`)).toBe(false);
  });

  it('refuses a missing opinion, a bad id, or an unknown channel without touching anything', async () => {
    expect(await credit()).toEqual({ counted: false, reason: 'not-found' });
    expect((await credit({ offerId: '../users/x' })).counted).toBe(false);
    expect((await credit({ channel: 'general' })).counted).toBe(false);
    expect((await credit({ propertyId: undefined })).counted).toBe(false);
    expect(store.size).toBe(0);
  });

  it('cannot be pointed at another campaign to inflate it (the opinion must belong to the campaign named)', async () => {
    seed('op1', offer());
    expect(await credit({ propertyId: 'someOtherCampaign' })).toEqual({ counted: false, reason: 'other-campaign' });
    expect(store.size).toBe(1);
  });

  it('the refusal reasons are complete for an eligible opinion (null)', () => {
    expect(opinionCreditRefusal(offer(), { propertyId: PID, sessionId: 'session_1', now: NOW })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------------------------
describe('POST /api/property-visit with a channel', () => {
  const visit = async (body, headers = {}) => {
    const { POST } = await import('../../src/app/api/property-visit/route');
    return POST(new Request('http://x/api/property-visit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone)', ...headers }, body: JSON.stringify(body) }));
  };
  beforeEach(() => store.set(`properties/${PID}`, { stats: { views: 10, uniqueViews: 8, returnViews: 2 } }));

  it('counts the view as always, and the same open under its channel', async () => {
    const res = await visit({ propertyId: PID, visitorId: 'v_9', isReturn: false, channel: 'sms' });
    expect(res.status).toBe(200);
    expect(store.get(`properties/${PID}`).stats).toMatchObject({ views: 11, uniqueViews: 9 });
    expect(store.get(`${CHANNEL_STATS}/${PID}`)).toEqual({ propertyId: PID, sms: { views: 1 } });
  });

  it('adds nothing about the channel to the per-visit record', async () => {
    await visit({ propertyId: PID, visitorId: 'v_9', isReturn: true, channel: 'email' });
    const views = [...store.entries()].filter(([k]) => k.startsWith('propertyViews/')).map(([, v]) => v);
    expect(views).toHaveLength(1);
    expect(Object.keys(views[0]).sort()).toEqual(['isReturn', 'propertyId', 'scannerSuspected', 'timestamp', 'userAgent', 'visitorId']);
    expect(JSON.stringify(views[0])).not.toMatch(/email|sms|channel/i);
    const sessions = [...store.entries()].filter(([k]) => k.startsWith('propertyViewSessions/')).map(([, v]) => v);
    expect(JSON.stringify(sessions)).not.toMatch(/email|sms|channel/i);
  });

  it('without a channel (the general link, older links, the full link) behaves exactly as before', async () => {
    await visit({ propertyId: PID, visitorId: 'v_9', isReturn: false });
    expect(store.get(`properties/${PID}`).stats.views).toBe(11);
    expect(store.has(`${CHANNEL_STATS}/${PID}`)).toBe(false);
  });

  it('an unknown channel is ignored (counted as General / Unknown), never stored', async () => {
    await visit({ propertyId: PID, visitorId: 'v_9', channel: 'facebook' });
    expect(store.get(`properties/${PID}`).stats.views).toBe(11);
    expect(store.has(`${CHANNEL_STATS}/${PID}`)).toBe(false);
  });

  it('a failure counting the channel never fails the view', async () => {
    failNextWrite = CHANNEL_STATS;
    const res = await visit({ propertyId: PID, visitorId: 'v_9', channel: 'sms' });
    expect(res.status).toBe(200);
    expect(store.get(`properties/${PID}`).stats.views).toBe(11);
  });

  it('a preview deployment counts nothing (it shares the live database)', async () => {
    process.env.VERCEL_ENV = 'preview';
    await visit({ propertyId: PID, visitorId: 'v_9', channel: 'sms' });
    expect(store.get(`properties/${PID}`).stats.views).toBe(10);
    expect(store.has(`${CHANNEL_STATS}/${PID}`)).toBe(false);
  });
});

describe('POST /api/offers/opinion-channel', () => {
  const post = async (body) => {
    const { POST } = await import('../../src/app/api/offers/opinion-channel/route');
    return POST(new Request('http://x/api/offers/opinion-channel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  };
  beforeEach(() => store.set('offers/op1', clone(offer({ createdAt: new Date(Date.now() - 2000) }))));

  it('counts the opinion and answers only { ok: true }', async () => {
    const res = await post({ propertyId: PID, offerId: 'op1', sessionId: 'session_1', channel: 'email' });
    expect(await res.json()).toEqual({ ok: true });
    expect(store.get(`${CHANNEL_STATS}/${PID}`)).toEqual({ propertyId: PID, email: { opinions: 1 } });
  });

  it('answers exactly the same when nothing was counted (it cannot be used to probe an opinion)', async () => {
    const answers = [];
    for (const body of [
      { propertyId: PID, offerId: 'op1', sessionId: 'wrong', channel: 'email' },
      { propertyId: PID, offerId: 'nope', sessionId: 'session_1', channel: 'email' },
      { propertyId: 'other', offerId: 'op1', sessionId: 'session_1', channel: 'sms' },
      'not json',
    ]) {
      const res = await post(body);
      answers.push([res.status, await res.json()]);
    }
    expect(answers.every(([s, b]) => s === 200 && JSON.stringify(b) === '{"ok":true}')).toBe(true);
    expect(store.has(`${CHANNEL_STATS}/${PID}`)).toBe(false);
  });

  it('a preview deployment counts nothing', async () => {
    process.env.VERCEL_ENV = 'preview';
    await post({ propertyId: PID, offerId: 'op1', sessionId: 'session_1', channel: 'email' });
    expect(store.has(`${CHANNEL_STATS}/${PID}`)).toBe(false);
  });
});

describe('the report block', () => {
  it('is read from the campaign\'s channel totals and the report\'s own price-opinion count', async () => {
    store.set(`${CHANNEL_STATS}/${PID}`, { propertyId: PID, email: { views: 50, opinions: 4 }, sms: { views: 30, opinions: 3 } });
    const r = await loadChannelReport(db, { propertyId: PID, property: { stats: { views: 100 } }, priceCount: 10 });
    expect(r.rows.map((x) => [x.key, x.views, x.opinions])).toEqual([['email', 50, 4], ['sms', 30, 3], ['general', 20, 3]]);
  });

  it('never fails the report: unreadable channel totals give null', async () => {
    const broken = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('down'); } }) }) };
    expect(await loadChannelReport(broken, { propertyId: PID, property: {}, priceCount: 1 })).toBeNull();
  });

  it('is part of every report level, the team level included, and the new collections are server-only', () => {
    const svc = fs.readFileSync(new URL('../../src/app/api/services/propertyAccessService.js', import.meta.url), 'utf-8');
    expect(svc.match(/channels: await loadChannelReport\(/g)).toHaveLength(2);
    const rules = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf-8');
    expect(rules).not.toMatch(/campaignChannel/); // not opened to any client: the default-deny rule applies
    expect(rules).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });
});

// ------------------------------------------------------------------------------------------------------------------------
describe('the buyer page sends the channel only where it should', () => {
  const src = fs.readFileSync(new URL('../../src/app/components/PropertyPageClient.js', import.meta.url), 'utf-8');

  it('takes the channel from the link, and never in iPad (open home) mode', () => {
    expect(src).toContain("const linkChannel = initialMode !== 'ipad' && isChannel(channel) ? channel : null;");
    expect(src).toContain('...(linkChannel && !isIpadMode ? { channel: linkChannel } : {})');
  });

  it('credits only a NEW opinion, and never writes the channel onto the opinion or a registration', () => {
    const save = src.slice(src.indexOf('const savePriceOpinion'), src.indexOf('const formatMoney'));
    const createBranch = save.slice(save.indexOf('// Create new offer'));
    const updateBranch = save.slice(save.indexOf('if (savedOfferId)'), save.indexOf('// Create new offer'));
    expect(createBranch).toContain("fetch('/api/offers/opinion-channel'");
    expect(updateBranch).not.toContain('opinion-channel');
    const offerData = save.slice(save.indexOf('const offerData = {'), save.indexOf('};', save.indexOf('const offerData = {')));
    expect(offerData).not.toMatch(/channel/i);
    const register = src.slice(src.indexOf('const handleContactSubmit'), src.indexOf('const handleRegisterInterest'));
    expect(register).not.toMatch(/channel/i);
    expect(src.match(/opinion-channel/g)).toHaveLength(2); // the call, and the comment pointing at the route
  });

  it('adds nothing about the channel to analytics events', () => {
    for (const m of src.matchAll(/trackEvent\('[a-z_]+', \{[^}]*\}/g)) expect(m[0]).not.toMatch(/channel/i);
  });

  it('every channel has a letter the /prop rewrite accepts', () => {
    const config = fs.readFileSync(new URL('../../next.config.mjs', import.meta.url), 'utf-8');
    const cls = config.match(/\\\\d\{9\}\[([A-Za-z]+)\]\?/)[1];
    for (const c of CHANNELS) {
      expect(cls).toContain(c.suffix.toLowerCase());
      expect(cls).toContain(c.suffix.toUpperCase());
    }
  });
});
