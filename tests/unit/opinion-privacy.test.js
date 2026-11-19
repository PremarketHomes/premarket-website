import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { separateOpinions, brisbaneDay, MIN_GROUP } from '../../src/app/api/services/opinionPrivacy';

// Platform-wide rule: a buyer's identity is never delivered together with their price opinion, in any report.

const op = (id, o) => ({ id, type: 'opinion', ...o });
const reg = (id, amount, createdAt, extra = {}) => op(id, { serious: true, offerAmount: amount, createdAt, buyerName: `Buyer ${id}`, buyerEmail: `${id}@x.test`, buyerPhone: '0400', ...extra });
const pas = (id, amount, createdAt, extra = {}) => op(id, { serious: false, offerAmount: amount, createdAt, ...extra });

describe('two unlinked lists', () => {
  const docs = [
    reg('r1', 900000, '2026-11-10T01:00:00Z', { nextAction: 'inspect', isFirstHomeBuyer: true }),
    pas('p1', 850000, '2026-11-10T02:00:00Z', { buyerName: 'Contact Form Person', buyerEmail: 'cf@x.test' }), // contact form without registering
    pas('p2', 0, '2026-11-11T00:00:00Z'), // no price given
    { id: 'c1', type: 'comment', offerAmount: 1, buyerName: 'Not an opinion' },
  ];
  const r = separateOpinions(docs);

  it('registrations: who and what they want, never an amount', () => {
    expect(r.registrations).toEqual([expect.objectContaining({ id: 'r1', name: 'Buyer r1', email: 'r1@x.test', nextAction: 'inspect', isFirstHomeBuyer: true, registeredOn: '2026-11-10' })]);
    for (const row of r.registrations) expect(JSON.stringify(row)).not.toMatch(/900000|850000|offerAmount/);
  });
  it('prices: bare amounts only, highest first, with no id, buyer, date, seriousness or badge', () => {
    expect(r.priceOpinions).toEqual([{ offerAmount: 900000 }, { offerAmount: 850000 }]);
  });
  it('passive opinions that carry contact details never surface them', () => {
    expect(JSON.stringify(r)).not.toMatch(/Contact Form Person|cf@x\.test|Not an opinion/);
  });
  it('counts', () => {
    expect(r.summary).toMatchObject({ opinions: 3, serious: 1, passive: 2, priceCount: 2, priceMin: 850000, priceMax: 900000, fhbCount: 1, minGroup: MIN_GROUP });
  });
});

describe('figures never reduce to one registered buyer\'s price', () => {
  it('serious and passive medians are withheld until BOTH groups have 3+ prices (else passive + combined would reveal the serious one)', () => {
    const one = separateOpinions([reg('r1', 1000000, '2026-11-10T00:00:00Z'), pas('p1', 800000, '2026-11-10T00:00:00Z'), pas('p2', 900000, '2026-11-10T00:00:00Z'), pas('p3', 950000, '2026-11-10T00:00:00Z')]);
    expect(one.summary).toMatchObject({ seriousMedian: null, passiveMedian: null, combinedMedian: 925000 });
    const enough = separateOpinions([
      reg('r1', 1000000, '2026-11-10T00:00:00Z'), reg('r2', 1100000, '2026-11-10T00:00:00Z'), reg('r3', 1200000, '2026-11-10T00:00:00Z'),
      pas('p1', 800000, '2026-11-10T00:00:00Z'), pas('p2', 900000, '2026-11-10T00:00:00Z'), pas('p3', 950000, '2026-11-10T00:00:00Z'),
    ]);
    expect(enough.summary).toMatchObject({ seriousMedian: 1100000, passiveMedian: 900000 });
  });
  it('the timeline is weekly medians of weeks with 3+ prices, never single dated prices', () => {
    const r = separateOpinions([
      reg('r1', 1000000, '2026-11-02T00:00:00Z'), // Mon 2 Nov (Brisbane) week: 1 price only
      pas('p1', 800000, '2026-11-09T00:00:00Z'), pas('p2', 900000, '2026-11-10T00:00:00Z'), reg('r2', 950000, '2026-11-11T00:00:00Z'),
    ]);
    expect(r.summary.weekly).toEqual([
      { weekOf: '2026-11-02', count: 1, median: null },
      { weekOf: '2026-11-09', count: 3, median: 900000 },
    ]);
  });
});

describe('identity', () => {
  it('typed registration details win; the linked account only fills gaps (same person)', () => {
    const buyers = { hannah: { firstName: 'Hannah', lastName: 'L', email: 'hannah@x.test', phone: '0411', buyerPreferences: { locations: ['Gold Coast'] } } };
    const typedOther = separateOpinions([reg('r1', 1, '2026-11-10T00:00:00Z', { userId: 'hannah', buyerName: 'Luke W', buyerEmail: 'luke@x.test', buyerPhone: '0400' })], { buyers });
    expect(typedOther.registrations[0]).toMatchObject({ name: 'Luke W', email: 'luke@x.test', phone: '0400' });
    expect(JSON.stringify(typedOther.registrations[0])).not.toMatch(/Hannah|hannah@|0411|Gold Coast/);
  });
  it('without identity (team colleagues, leadership): positional labels, no contact or preferences, no real ids', () => {
    const r = separateOpinions([reg('REALID', 900000, '2026-11-10T00:00:00Z', { userId: 'u1', timeframe: '3 months' })], { withIdentity: false });
    expect(r.registrations).toEqual([{ id: 'registration-1', name: 'Registered buyer 1', serious: true, registeredOn: '2026-11-10', nextAction: null, timeframe: '3 months', buyerType: null, seriousnessLevel: null, isFirstHomeBuyer: false, isInvestor: false }]);
    expect(JSON.stringify(r)).not.toMatch(/REALID|u1|@x\.test|Buyer REALID/);
  });
  it('registration dates are Brisbane calendar days', () => {
    expect(brisbaneDay('2026-11-09T15:30:00Z')).toBe('2026-11-10'); // 1:30am Tuesday in Brisbane
  });
});

describe('every report surface uses it', () => {
  const read = (p) => readFileSync(p, 'utf8');
  it('report page, report API (all levels), emailed report/PDF and leadership report', () => {
    expect(read('src/app/api/services/propertyAccessService.js')).toMatch(/separateOpinions\(offers\.docs[\s\S]*\{ buyers \}\)/);
    expect(read('src/app/api/services/propertyAccessService.js')).toContain('separateOpinions(offers.docs.map((d) => d.data()), { withIdentity: false })');
    expect(read('src/app/api/services/reportService.js')).toContain('separateOpinions(offersSnap.docs');
    expect(read('src/app/api/services/leadershipService.js')).toContain("separateOpinions(opinionDocs, { withIdentity: false }).priceOpinions");
    const pdf = read('src/app/api/services/reportService.js');
    expect(pdf).not.toMatch(/b\.price|fmtMoney\(b\./); // no price on a registered buyer's card (PDF or email)
    expect(pdf).not.toContain('allOpinions,'); // raw opinions no longer handed to the PDF/email templates
    const page = read('src/app/dashboard/property/[id]/page.js');
    expect(page).not.toContain("collection(db, 'offers')");
    expect(page).not.toMatch(/op\.offerAmount \?/); // the old "price on the registration card"
  });
});
