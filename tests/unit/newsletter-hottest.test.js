import { describe, it, expect, vi, beforeEach } from 'vitest';

const data = { offers: [], properties: {}, users: [] };
const whereCalls = [];
const sendEmail = vi.fn(async () => ({}));

const snapOf = (docs) => ({ docs, forEach: (fn) => docs.forEach(fn) });
const docOf = (id, d) => ({ id, data: () => d, exists: true });

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'offers') {
        return { where: (...args) => { whereCalls.push(args); return { get: async () => snapOf(data.offers.map((o, i) => docOf(`o${i}`, o))) }; } };
      }
      if (name === 'properties') {
        return {
          doc: (id) => ({ get: async () => (data.properties[id] ? docOf(id, data.properties[id]) : { exists: false, data: () => undefined }) }),
          where: () => ({ where: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => snapOf(
            Object.entries(data.properties).filter(([, p]) => p.__new).map(([id, p]) => docOf(id, { ...p, created: { toDate: () => new Date() } })),
          ) }) }) }) }) }),
        };
      }
      return { where: () => ({ where: () => ({ get: async () => snapOf(data.users.map((u, i) => docOf(`u${i}`, u))) }) }) };
    },
  },
}));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { fromDate: (d) => ({ seconds: Math.floor(d.getTime() / 1000) }) } }));
vi.mock('../../src/app/api/services/resendService', () => ({ sendEmail: (...a) => sendEmail(...a) }));

const svc = await import('../../src/app/api/services/newsletterService');

const prop = (over = {}) => ({ active: true, visibility: true, title: 'House', address: '1 A St, Town', location: { suburb: 'Town' }, bedrooms: 3, price: 900000, imageUrls: ['https://x/y.jpg'], ...over });
const offers = (counts) => Object.entries(counts).flatMap(([propertyId, n]) => Array.from({ length: n }, () => ({ propertyId })));

beforeEach(() => {
  data.offers = []; data.properties = {}; data.users = []; whereCalls.length = 0; sendEmail.mockClear();
});

describe('fetchHottestProperties', () => {
  it('ranks by offer count from the last 7 days and limits to the top N', async () => {
    data.offers = offers({ a: 5, b: 9, c: 1, d: 3 });
    data.properties = { a: prop({ title: 'A' }), b: prop({ title: 'B' }), c: prop({ title: 'C' }), d: prop({ title: 'D' }) };
    const hot = await svc.fetchHottestProperties(3);
    expect(hot.map((p) => p.title)).toEqual(['B', 'A', 'D']);
    expect(hot[0].offerCount).toBe(9);
    const [field, op, since] = whereCalls[0];
    expect([field, op]).toEqual(['createdAt', '>=']);
    const ageDays = (Date.now() / 1000 - since.seconds) / 86400;
    expect(ageDays).toBeGreaterThan(6.99);
    expect(ageDays).toBeLessThan(7.01);
  });

  it('excludes inactive, hidden and deleted properties, and offers with no property', async () => {
    data.offers = [...offers({ a: 4, b: 3, c: 2, gone: 9 }), {}];
    data.properties = { a: prop({ active: false }), b: prop({ visibility: false }), c: prop({ title: 'C' }) };
    const hot = await svc.fetchHottestProperties(5);
    expect(hot.map((p) => p.title)).toEqual(['C']);
  });

  it('returns nothing when there were no offers', async () => {
    expect(await svc.fetchHottestProperties()).toEqual([]);
  });
});

describe('generateNewsletterHTML', () => {
  const buyer = { firstName: 'Bo', email: 'bo@example.com' };
  const mk = (id, title) => ({ id, title, address: '1 A St, Town', suburb: 'Town', bedrooms: 3, price: 900000, imageUrl: null });

  it('renders both sections and does not repeat a property shown as new', () => {
    const html = svc.generateNewsletterHTML(buyer, [mk('n1', 'NewOne'), mk('n2', 'Both')], [mk('n2', 'Both'), mk('h1', 'HotOne')]);
    expect(html).toContain('Latest Listings');
    expect(html).toContain('Hottest This Week');
    expect(html).toContain('HotOne');
    expect(html.match(/propertyId=n2/g).length).toBe(2); // title link + View button, once
  });

  it('works with no hottest list (previous behaviour)', () => {
    const html = svc.generateNewsletterHTML(buyer, [mk('n1', 'NewOne')]);
    expect(html).toContain('Latest Listings');
    expect(html).not.toContain('Hottest This Week');
  });

  it('renders a hottest-only email', () => {
    const html = svc.generateNewsletterHTML(buyer, [], [mk('h1', 'HotOne')]);
    expect(html).not.toContain('Latest Listings');
    expect(html).toContain('Hottest This Week');
  });
});

describe('sendWeeklyBuyerNewsletters', () => {
  const buyer = { email: 'bo@example.com', firstName: 'Bo', buyer: true, buyerPreferences: { notifyNewProperties: true } };

  it('sends one email per buyer including the hottest section, with the combined count in the subject', async () => {
    data.users = [buyer, { ...buyer, email: 'unsub@example.com', unsubscribed: true }];
    data.offers = offers({ hot: 4 });
    data.properties = { hot: prop({ title: 'HotOne' }), nw: { ...prop({ title: 'NewOne' }), __new: true } };
    const res = await svc.sendWeeklyBuyerNewsletters();
    expect(res).toEqual({ sent: 1, skipped: 0, errors: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe('bo@example.com');
    expect(msg.subject).toBe('2 Pre-Market Properties This Week');
    expect(msg.html).toContain('Hottest This Week');
  });

  it('still sends when there are hot properties but nothing new', async () => {
    data.users = [buyer];
    data.offers = offers({ hot: 2 });
    data.properties = { hot: prop() };
    expect((await svc.sendWeeklyBuyerNewsletters()).sent).toBe(1);
  });

  it('sends nothing when there is nothing new and nothing hot', async () => {
    data.users = [buyer];
    expect(await svc.sendWeeklyBuyerNewsletters()).toEqual({ sent: 0, skipped: 1, errors: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('one failing send does not stop the rest', async () => {
    data.users = [buyer, { ...buyer, email: 'two@example.com' }];
    data.offers = offers({ hot: 2 });
    data.properties = { hot: prop() };
    sendEmail.mockRejectedValueOnce(new Error('rate limited'));
    expect(await svc.sendWeeklyBuyerNewsletters()).toEqual({ sent: 1, skipped: 0, errors: 1 });
  });
});

describe('matchPropertiesToBuyer (regression: parsePrice was undefined, so every send threw)', () => {
  const p = (price) => ({ id: 'x', suburb: 'Town', bedrooms: 3, price });
  const buyer = (prefs) => ({ preferences: { locations: [], minBedrooms: null, minBudget: null, maxBudget: null, ...prefs } });
  it('filters by budget for numeric and string prices', () => {
    const b = buyer({ minBudget: 500000, maxBudget: 1000000 });
    expect(svc.matchPropertiesToBuyer(b, [p(900000), p('$1,250,000'), p('$600,000'), p(null)]).map((x) => x.price)).toEqual([900000, '$600,000', null]);
  });
});
