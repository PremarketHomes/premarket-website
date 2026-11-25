import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createFakeFirestore } from './helpers/fakeFirestore';

// Premarket's promise: a buyer's price opinion stays anonymous. These tests pin the guarantees:
//   1. analytics (Google Tag Manager) never receive an amount or a per-visitor id;
//   2. a registration is its own record and can never carry a price, a session id or a device id;
//   3. the buyer page, the iPad kiosk and the TV display never write a buyer's details onto a price opinion;
//   4. counts stay right (a buyer who gives a price and registers is counted once) and history is unchanged;
//   5. agents get numbers from the server, never raw opinion records.

const root = new URL('../../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
// Source without comments (block comments that start a line, whole-line and trailing "// " comments), so assertions
// look at code only. Deliberately conservative: strings such as 'image/*' or 'https://' are left alone.
const code = (p) => read(p)
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/ .*$/gm, '');

const { analyticsEvent, ANALYTICS_PARAM_ALLOWLIST } = await import('../../src/app/utils/analyticsEvents');
const records = await import('../../src/app/utils/opinionRecords');
const { registrationRecord, countsAsOpinion, isRegistrationOnly, hasBuyerIdentity, hasPrice, REGISTRATION_FORBIDDEN_FIELDS } = records;
const { separateOpinions } = await import('../../src/app/api/services/opinionPrivacy');
const { computeOpinionStats } = await import('../../src/app/api/services/propertyCardService');
const { buildLeadershipData } = await import('../../src/app/api/services/leadershipMetrics');

describe('1. analytics never receive an individual price opinion or a per-visitor id', () => {
  it('the event builder passes campaign-level details only', () => {
    const out = analyticsEvent('price_opinion_created', {
      property_id: 'p1', opinion_amount: 1100000, session_id: 'session_1', visitor_id: 'v_1', user_id: 'u1',
      buyer_email: 'a@b.c', buyerName: 'A', register_interest: true, had_prior_opinion: true,
    });
    expect(out).toEqual({ event: 'price_opinion_created', property_id: 'p1' });
    expect(ANALYTICS_PARAM_ALLOWLIST).toEqual(['property_id', 'property_title', 'property_address', 'property_price', 'page_path']);
  });

  it('the buyer page pushes to the dataLayer only through that builder', () => {
    const src = code('src/app/components/PropertyPageClient.js');
    expect(src.match(/dataLayer\.push\(/g)).toHaveLength(1);
    expect(src).toContain('window.dataLayer.push(analyticsEvent(eventName, eventParams));');
  });

  it('no app code mentions opinion_amount or session_id for analytics any more', () => {
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.(js|jsx)$/.test(e.name) && /opinion_amount|session_id/.test(read(rel))) hits.push(rel);
      }
    };
    walk('src');
    expect(hits).toEqual([]);
  });

  it('every trackEvent call on the buyer page sends only allowlisted details', () => {
    const src = code('src/app/components/PropertyPageClient.js');
    const calls = [...src.matchAll(/trackEvent\('([a-z_]+)',\s*\{([^}]*)\}/g)];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const [, name, body] of calls) {
      const keys = [...body.matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1]);
      for (const k of keys) expect(ANALYTICS_PARAM_ALLOWLIST, `${name}: ${k}`).toContain(k);
    }
  });

  it('Sentry session replay masks every text and input and captures no request bodies (stated explicitly)', () => {
    const cfg = code('sentry.client.config.js');
    expect(cfg).toMatch(/maskAllText: true/);
    expect(cfg).toMatch(/maskAllInputs: true/);
    expect(cfg).toMatch(/blockAllMedia: true/);
    expect(cfg).toMatch(/networkDetailAllowUrls: \[\]/);
  });
});

describe('2. a registration is its own record', () => {
  it('holds the buyer\'s details and answers, never a price, a session id, a device id or an opinion id', () => {
    const r = registrationRecord({
      propertyId: 'p1',
      buyer: { name: '  Jamie Buyer ', email: ' Jamie@Example.com ', phone: ' 0400 111 222 ', userId: 'u1', offerAmount: 5, sessionId: 's' },
      answers: { nextAction: 'contact', timeframe: '1_3_months', buyerType: 'investor', isInvestor: true, offerAmount: 1, sessionId: 's', visitorId: 'v' },
    });
    expect(r).toEqual({
      type: 'opinion', propertyId: 'p1', serious: true, nextAction: 'contact', timeframe: '1_3_months',
      buyerType: 'investor', isFirstHomeBuyer: false, isInvestor: true, buyerName: 'Jamie Buyer', buyerEmail: 'jamie@example.com',
      buyerPhone: '0400 111 222', userId: 'u1', fromWeb: true,
    });
    for (const k of REGISTRATION_FORBIDDEN_FIELDS) expect(k in r).toBe(false);
    expect(REGISTRATION_FORBIDDEN_FIELDS).toEqual(['offerAmount', 'sessionId', 'visitorId']);
  });

  it('an account is attached only when given, and the source flags are carried', () => {
    expect('userId' in registrationRecord({ propertyId: 'p1', buyer: { name: 'A', email: 'a@b.c', phone: '1' } })).toBe(false);
    expect(registrationRecord({ propertyId: 'p1', buyer: { name: 'A' }, source: { fromIpadMode: true } })).toMatchObject({ fromIpadMode: true });
    expect(registrationRecord({ propertyId: 'p1', buyer: { name: 'A' }, source: { fromTvDisplay: true, displayId: 'd1' } }))
      .toMatchObject({ fromTvDisplay: true, displayId: 'd1' });
  });

  it('helpers recognise each kind of record', () => {
    expect(hasPrice({ offerAmount: 900000 })).toBe(true);
    expect(hasPrice({ offerAmount: 0 })).toBe(false);
    expect(hasBuyerIdentity({ buyerEmail: 'a@b.c' })).toBe(true);
    expect(hasBuyerIdentity({ userId: 'u' })).toBe(true);
    expect(hasBuyerIdentity({ buyerName: '' })).toBe(false);
    // A registration on its own is recognised by its shape: serious, no price, no session or device id.
    expect(isRegistrationOnly(registrationRecord({ propertyId: 'p1', buyer: { name: 'A', email: 'a@b.c', phone: '1' } }))).toBe(true);
    expect(isRegistrationOnly({ type: 'opinion', serious: true, buyerName: 'A' })).toBe(true);
    // Older registrations always carried the session id (and the device id key), so they still count as before.
    expect(isRegistrationOnly({ type: 'opinion', serious: true, buyerName: 'A', sessionId: 's1' })).toBe(false);
    expect(isRegistrationOnly({ type: 'opinion', serious: true, buyerName: 'A', visitorId: null })).toBe(false);
    expect(isRegistrationOnly({ type: 'opinion', serious: true, buyerName: 'A', offerAmount: 900000 })).toBe(false);
    expect(isRegistrationOnly({ type: 'opinion', offerAmount: 900000, sessionId: 's' })).toBe(false);
  });
});

describe('3. no writer ever puts a buyer next to a price', () => {
  const page = code('src/app/components/PropertyPageClient.js');
  const fn = (name, next) => page.slice(page.indexOf(`const ${name}`), page.indexOf(`const ${next}`));

  it('buyer page: a new opinion is amount + this tab\'s session id only (no device id, no buyer, no account)', () => {
    const create = fn('createAnonymousOpinion', 'savePriceOpinion');
    expect(create).toContain("addDoc(collection(db, 'offers')");
    expect(create).not.toMatch(/visitorId|pm_visitor_id|buyer|userId|serious|registration/);
    const save = fn('savePriceOpinion', 'formatMoney');
    const update = save.slice(save.indexOf('if (savedOfferId)'), save.indexOf('} else {'));
    expect(update).toContain("updateDoc(doc(db, 'offers', savedOfferId)");
    expect(update).not.toMatch(/visitorId|buyer|userId|serious|sessionId/);
  });

  it('buyer page: registering creates or updates only the registration record, never the opinion', () => {
    const submit = fn('handleContactSubmit', 'handleRegisterInterest');
    expect(submit).toContain('registrationRecord(');
    expect(submit).toContain("updateDoc(doc(db, 'offers', savedRegistrationId)");
    expect(submit).not.toMatch(/savedOfferId|offerAmount|priceOpinion|sessionId|visitorId|createAnonymousOpinion/);
    // and the agent is notified about the registration record (which holds no price)
    expect(submit).toContain('JSON.stringify({ offerId: registrationId, propertyId })');
  });

  it('iPad kiosk: the registration gets its own id and none of the opinion\'s data', async () => {
    vi.doMock('../../src/app/firebase/clientApp', () => ({ db: {} }));
    const { buildOpinionItem, buildRegistrationItem } = await import('../../src/app/utils/kioskPersistence');
    const op = buildOpinionItem({ propertyId: 'p1', opinion: { id: 'op1', amount: 980000, at: Date.now() }, sessionId: 'ipad_1', visitorId: 'v_ipad' });
    expect('visitorId' in op.data).toBe(false);
    expect(op.data).toMatchObject({ offerAmount: 980000, sessionId: 'ipad_1', fromIpadMode: true });
    const reg = buildRegistrationItem({
      propertyId: 'p1', docId: 'reg1', createdAtIso: new Date().toISOString(),
      buyer: { firstName: 'Sam', lastName: 'Visitor', email: 'Sam@Example.com', phone: '0400 333 444' },
      amount: 980000, sessionId: 'ipad_1', visitorId: 'v_ipad', // stale callers: ignored
    });
    expect(reg.docId).toBe('reg1');
    expect(reg.data).toMatchObject({ serious: true, buyerName: 'Sam Visitor', buyerEmail: 'sam@example.com', fromIpadMode: true });
    expect(isRegistrationOnly(reg.data)).toBe(true);
    for (const k of ['offerAmount', 'sessionId', 'visitorId', 'userId']) expect(k in reg.data, k).toBe(false);
    const kiosk = code('src/app/components/kiosk/OpenHomeKiosk.js');
    expect(kiosk).toContain('const docId = generateOfferId();');
    expect(kiosk).not.toMatch(/opinion\?\.id \|\| generateOfferId|amount: opinion\?\.amount/);
  });

  it('TV display: qualification answers and the new account go on a separate registration, never onto the opinion', () => {
    const tv = code('src/app/tv/[id]/page.js');
    expect(tv).not.toMatch(/updateDoc\(/);
    expect(tv).toContain('registrationRecord({');
    expect(tv).toMatch(/buyer: \{ name: `\$\{firstName\.trim\(\)\} \$\{lastName\.trim\(\)\}`, email, userId \}/);
  });

  it('database rules: every client write must keep an opinion and a buyer apart; agents cannot read raw records', () => {
    const rules = read('firestore.rules');
    const offers = rules.slice(rules.indexOf('match /offers/{offerId}'), rules.indexOf('match /likes/{likeId}'));
    expect(offers.match(/offerKeepsOpinionAndBuyerApart\(request\.resource\.data\)/g)).toHaveLength(2); // create + update
    expect(rules).not.toMatch(/registrationOnly/); // no new field: the app also works under the rules live before the split
    const readRule = offers.slice(offers.indexOf('allow read'), offers.indexOf('allow create'));
    expect(readRule).not.toMatch(/Owner/);
    const fnSrc = rules.slice(rules.indexOf('function offerKeepsOpinionAndBuyerApart'), rules.indexOf('function offerUpdateKeys'));
    for (const k of ["'offerAmount'", "'sessionId' in data", "'visitorId' in data", 'offerHoldsBuyer(data)']) expect(fnSrc).toContain(k);
  });
});

describe('4. counts stay right, and history is unchanged', () => {
  const at = (iso) => ({ toMillis: () => Date.parse(iso) });
  // An older campaign exactly like the Worongary records: 8 price opinions + 1 registration without a price.
  const legacy = [950000, 1050000, 1050000, 1100000, 1120000, 1160000, 1190000, 1210000]
    .map((a, i) => ({ id: `o${i}`, type: 'opinion', propertyId: 'p1', offerAmount: a, sessionId: `s${i}`, createdAt: at('2026-11-25T02:00:00Z') }))
    .concat([{ id: 'r0', type: 'opinion', propertyId: 'p1', serious: true, buyerName: 'X', buyerEmail: 'x@y.z', sessionId: 's9', createdAt: at('2026-11-25T04:14:00Z') }]);

  it('older campaigns keep exactly their figures (9 buyer opinions = 8 prices + 1 registration)', () => {
    const { summary, priceOpinions, registrations } = separateOpinions(legacy);
    expect(summary).toMatchObject({ opinions: 9, serious: 1, passive: 8, priceCount: 8, combinedMedian: 1110000 });
    expect(priceOpinions).toHaveLength(8);
    expect(registrations).toHaveLength(1);
  });

  it('a buyer who gives a price and then registers (two separate records) is counted once as an opinion', () => {
    const docs = [
      { id: 'a', type: 'opinion', propertyId: 'p1', offerAmount: 1000000, sessionId: 's1', createdAt: at('2026-11-26T01:00:00Z') },
      { id: 'b', type: 'opinion', propertyId: 'p1', offerAmount: 1100000, sessionId: 's2', createdAt: at('2026-11-26T01:05:00Z') },
      { id: 'reg', ...registrationRecord({ propertyId: 'p1', buyer: { name: 'B', email: 'b@c.d', phone: '1' }, answers: { isFirstHomeBuyer: true } }), createdAt: at('2026-11-26T01:06:00Z') },
    ];
    const { summary, priceOpinions, registrations } = separateOpinions(docs);
    expect(summary).toMatchObject({ opinions: 2, serious: 1, passive: 2, priceCount: 2, fhbCount: 1 });
    expect(summary.seriousMedian).toBeNull(); // a registered buyer's price is never known
    expect(priceOpinions).toEqual([{ offerAmount: 1100000 }, { offerAmount: 1000000 }]);
    expect(registrations[0]).toMatchObject({ id: 'reg', name: 'B', email: 'b@c.d' });
    expect(JSON.stringify(registrations)).not.toMatch(/1000000|1100000|offerAmount/);
  });

  it('the shareable card, the leadership hub and the buyer-page count use the same rule', () => {
    const docs = [
      { type: 'opinion', offerAmount: 1000000 },
      registrationRecord({ propertyId: 'p1', buyer: { name: 'B', email: 'b@c.d', phone: '1' } }),
    ];
    expect(computeOpinionStats(docs)).toMatchObject({ opinionsCount: 1, seriousBuyersCount: 1, combinedMedian: 1000000 });
    expect(docs.filter(countsAsOpinion)).toHaveLength(1);
    const now = new Date('2026-11-26T03:00:00Z');
    const hub = buildLeadershipData({
      now,
      members: [{ uid: 'a', firstName: 'Ann', accountStatus: 'active', isAgent: true }],
      properties: [{ id: 'p1', userId: 'a', visibility: true, createdAt: now, stats: { views: 3 } }],
      opinions: [
        { id: 'x', type: 'opinion', propertyId: 'p1', offerAmount: 1000000, createdAt: now },
        { id: 'y', propertyId: 'p1', createdAt: now, ...registrationRecord({ propertyId: 'p1', buyer: { name: 'B', email: 'b@c.d', phone: '1' } }) },
      ],
    });
    expect(hub.properties[0]).toMatchObject({ opinions: 1, registrations: 1 });
    for (const p of ['src/app/api/offers/opinion-count/route.js', 'src/app/api/services/teamService.js', 'src/app/api/services/managedCampaignService.js']) {
      expect(read(p), p).toContain('countsAsOpinion(');
    }
  });
});

describe('5. agents get numbers, never raw opinion records', () => {
  const authState = { uid: 'agent1' };
  let db;
  beforeEach(() => {
    db = createFakeFirestore({
      properties: { mine1: { userId: 'agent1' }, mine2: { userId: 'agent1' }, theirs: { userId: 'agent2' } },
      offers: {
        a: { type: 'opinion', propertyId: 'mine1', offerAmount: 900000 },
        b: { type: 'opinion', propertyId: 'mine1', offerAmount: 950000, serious: true, buyerName: 'Old', buyerEmail: 'old@x.y' }, // older combined record
        c: { type: 'opinion', propertyId: 'mine1', serious: true, buyerName: 'New', buyerEmail: 'new@x.y' }, // separate registration
        d: { type: 'opinion', propertyId: 'mine2', offerAmount: 1, reportExclusion: { excluded: true, kind: 'test' } },
        e: { type: 'opinion', propertyId: 'theirs', offerAmount: 1000000 },
      },
    });
    db.getAll = async (...refs) => Promise.all(refs.map((r) => r.get()));
    const origCollection = db.collection;
    db.collection = (c) => {
      const col = origCollection(c);
      return { ...col, where: (f, op, v) => (op === 'in' ? { get: async () => {
        const docs = (await Promise.all(v.map((id) => origCollection(c).where(f, '==', id).get()))).flatMap((s) => s.docs);
        return { docs };
      } } : col.where(f, op, v)) };
    };
  });
  const call = async (body, authed = true) => {
    vi.resetModules();
    vi.doMock('../../src/app/firebase/adminApp', () => ({ adminDb: db }));
    vi.doMock('../../src/app/api/middleware/auth', () => ({
      verifyAuth: async () => (authed ? { authenticated: true, uid: authState.uid } : { authenticated: false, error: 'Unauthorized', status: 401 }),
    }));
    const { POST } = await import('../../src/app/api/offers/opinion-counts/route');
    const res = await POST(new Request('http://x/api/offers/opinion-counts', { method: 'POST', body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };

  it('returns counts only, for the caller\'s own listings only, with the shared counting rule', async () => {
    const r = await call({ propertyIds: ['mine1', 'mine2', 'theirs', '../x'] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ total: 2, counts: { mine1: 2, mine2: 0 } });
    expect(JSON.stringify(r.body)).not.toMatch(/Old|New|old@|new@|900000|950000/);
  });

  it('refuses signed-out callers', async () => {
    expect((await call({ propertyIds: ['mine1'] }, false)).status).toBe(401);
  });

  it('the agent dashboard uses it instead of reading offers in the browser', () => {
    const dash = code('src/app/dashboard/page.js');
    expect(dash).toContain("authFetch('/api/offers/opinion-counts'");
    expect(dash).not.toMatch(/collection\(db, 'offers'\)/);
  });
});
