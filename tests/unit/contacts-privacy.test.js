import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Admin CRM and the external contacts API: a person's contact details and registrations are kept, but nothing ties an
// identifiable buyer to an individual price opinion (no amounts, no "listings they gave an opinion on", and an
// anonymous opinion never links them to the listing agent's contacts).

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DELETE_FIELD' } }));

const { buildAllContacts, writeContacts } = await import('../../src/app/api/v1/contactComputation');

const snapOf = (rows) => ({ docs: Object.entries(rows).map(([id, d]) => ({ id, data: () => d })) });
const dbWith = (data) => ({ collection: (c) => ({ get: async () => snapOf(data[c] || {}) }) });

const data = {
  properties: {
    p1: { userId: 'agentA', formattedAddress: '1 Reg St' },
    p2: { userId: 'agentB', formattedAddress: '2 Anon St' },
  },
  users: {},
  likes: {},
  offers: {
    // Registered (serious) on agentA's listing
    o1: { propertyId: 'p1', type: 'opinion', serious: true, buyerName: 'Rita Reg', buyerEmail: 'rita@x.test', buyerPhone: '0400 111 111', offerAmount: 910000, createdAt: new Date('2026-11-10T00:00:00Z') },
    // The same person's ANONYMOUS opinion on agentB's listing (contact form without registering)
    o2: { propertyId: 'p2', type: 'opinion', serious: false, buyerEmail: 'rita@x.test', offerAmount: 777000, createdAt: new Date('2026-11-12T00:00:00Z') },
  },
};

describe('computed contacts', () => {
  it('keep contact details, registrations and totals; never the listings of anonymous opinions or any amount', async () => {
    const contacts = await buildAllContacts(dbWith(data));
    const rita = contacts.find((c) => c.email === 'rita@x.test');
    expect(rita).toMatchObject({ phone: expect.any(String), totalPriceOpinions: 2, totalRegisteredInterest: 1, registeredPropertyIds: ['p1'] });
    expect(rita).not.toHaveProperty('opinionPropertyIds');
    expect(JSON.stringify(rita)).not.toMatch(/910000|777000|offerAmount|"p2"/);
  });
  it('an anonymous opinion never puts the person in that listing agent\'s contacts; a registration does', async () => {
    const rita = (await buildAllContacts(dbWith(data))).find((c) => c.email === 'rita@x.test');
    expect(rita.linkedAgentIds).toEqual(['agentA']);
  });
  it('the stored field is removed from existing contacts on the next recompute (writes merge)', async () => {
    const sets = [];
    const db = { batch: () => ({ set: (ref, doc, opts) => sets.push({ doc, opts }), commit: async () => {} }), collection: () => ({ doc: (id) => ({ id }) }) };
    await writeContacts(db, [{ _key: 'k1', email: 'rita@x.test', registeredPropertyIds: ['p1'] }]);
    expect(sets[0].opts).toEqual({ merge: true });
    expect(sets[0].doc.opinionPropertyIds).toBe('DELETE_FIELD');
    expect(sets[0].doc.registeredPropertyIds).toEqual(['p1']);
  });
});

describe('admin CRM contact page (source)', () => {
  const page = readFileSync('src/app/dashboard/crm/[id]/page.js', 'utf8');
  it('shows registrations only: no price opinion amount, deviation or "listings opined on"', () => {
    expect(page).not.toMatch(/offerAmount|Opinion:|Submitted price opinion|opinionPropertyIds|Properties Opined On|deviation/);
    expect(page).toContain("registrations = unique.filter((o) => o.serious === true).map(toRegistration)");
    expect(page).toContain("const toRegistration = (o) => ({ id: o.id, propertyId: o.propertyId || null, createdAt: o.createdAt || null, nextAction: o.nextAction || null });");
    expect(page).toContain('Registered Interest');
    expect(page).toContain('Registered serious interest in ${addr}');
  });
});
