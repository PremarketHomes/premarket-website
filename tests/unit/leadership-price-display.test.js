// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import { render, cleanup } from '@testing-library/react';
import { fmtPrice, parsePriceValue, campaignPrice, PRICE_NOT_PROVIDED } from '../../src/app/dashboard/leadership/format';
import { buildLeadershipData, buildAgentProfile } from '../../src/app/api/services/leadershipMetrics';
import LeadershipHubView from '../../src/app/dashboard/leadership/LeadershipHubView';
import AgentProfileView from '../../src/app/dashboard/leadership/AgentProfileView';

afterEach(cleanup);

describe('fmtPrice — every way a price can be stored', () => {
  it.each([
    // numbers and digit strings (what the Add Property form saves)
    [950000, '$950,000'],
    ['950000', '$950,000'],
    [1250000.4, '$1,250,000'],
    [' 950000 ', '$950,000'],
    // formatted and shorthand text
    ['$1,200,000', '$1,200,000'],
    ['1,200,000', '$1,200,000'],
    ['$1.2m', '$1,200,000'],
    ['$1.2M', '$1,200,000'],
    ['1.5 million', '$1,500,000'],
    ['900k', '$900,000'],
    ['$900K', '$900,000'],
    ['Offers over $900,000', '$900,000'],
    ['Guide $850,000', '$850,000'],
    ['3 bed home $900k', '$900,000'],
    ['4 bed 2 bath $1.1m', '$1,100,000'],
    // ranges, in any common spelling
    ['$900,000 - $950,000', '$900,000 – $950,000'],
    ['$900,000 – $950,000', '$900,000 – $950,000'],
    ['$900,000 — $950,000', '$900,000 – $950,000'],
    ['$900,000 to $950,000', '$900,000 – $950,000'],
    ['900-950k', '$900,000 – $950,000'],
    ['900 to 950k', '$900,000 – $950,000'],
    ['$900k-$950k', '$900,000 – $950,000'],
    ['1 - 1.2 million', '$1,000,000 – $1,200,000'],
    ['$950,000 - $900,000', '$900,000 – $950,000'], // reversed
    ['$900,000 - $900,000', '$900,000'], // equal ends are one price
    [{ min: 900000, max: 950000 }, '$900,000 – $950,000'],
    [{ min: '900000', max: '$950,000' }, '$900,000 – $950,000'],
  ])('%j -> %s', (input, expected) => {
    expect(fmtPrice(input)).toBe(expected);
  });

  it.each([
    [undefined], [null], [''], ['   '], [0], ['0'], [-5], [NaN], [Infinity], [-Infinity],
    ['$NaN'], ['NaN'], ['undefined'], ['null'],
    ['Contact agent'], ['Contact Agent'], ['POA'], ['Price on application'], ['TBA'], ['Auction'], ['Under offer'],
    ['950'], [950], ['3 bed'], ['$'], ['-'], ['abc123'.replace('123', '')],
    ['$900,000 / $950,000 / $1,000,000'], ['900000 950000 1000000'],
    [true], [false], [[]], [[950000]], [{}], [{ min: 1 }], [{ min: 'x', max: 'y' }], [() => 1], [Symbol.iterator.toString()],
    [1e12], ['1e12'],
  ])('%j shows "Price not provided", never NaN', (input) => {
    const out = fmtPrice(input);
    expect(out).toBe(PRICE_NOT_PROVIDED);
    expect(out).not.toMatch(/NaN|undefined|null|Infinity/);
  });

  it('uses the supplied fallback, and never returns NaN for any input', () => {
    expect(fmtPrice(null, '—')).toBe('—');
    expect(fmtPrice('Contact agent', null)).toBeNull();
    const junk = ['', ' ', '$', '$$$', '..', ',,,', '1.2.3m', 'm', 'k', '1e5', '0x10', '١٢٣', '９００,０００', '\u0000', 'x'.repeat(10000), '9'.repeat(400), '1'.repeat(30) + 'm', '$-', '--'];
    for (const j of junk) expect(fmtPrice(j)).not.toMatch(/NaN|Infinity/);
  });

  it('does not change the value it is given', () => {
    const range = { min: 900000, max: 950000 };
    const copy = JSON.stringify(range);
    fmtPrice(range);
    expect(JSON.stringify(range)).toBe(copy);
    const text = '$900,000 - $950,000';
    expect(parsePriceValue(text)).toEqual({ kind: 'range', min: 900000, max: 950000 });
    expect(text).toBe('$900,000 - $950,000');
  });
});

describe('campaignPrice — sold vs listing price', () => {
  it('shows the sold price once sold, if valid; otherwise the listing price', () => {
    expect(campaignPrice({ status: 'sold', soldPrice: '1,050,000', price: '1000000' })).toEqual({ text: '$1,050,000', provided: true });
    expect(campaignPrice({ status: 'sold', soldPrice: 'Undisclosed', price: '1000000' })).toEqual({ text: '$1,000,000', provided: true });
    expect(campaignPrice({ status: 'sold', soldPrice: null, price: null })).toEqual({ text: 'Price not provided', provided: false });
    expect(campaignPrice({ status: 'live', soldPrice: 1, price: 'POA' })).toEqual({ text: 'Price not provided', provided: false });
    expect(campaignPrice({ status: 'live', price: '$900k' })).toEqual({ text: '$900,000', provided: true });
    expect(campaignPrice(null).provided).toBe(false);
  });
});

// The same awkward data, pushed through the real calculation code and the real screens.
const NOW = new Date('2026-11-04T03:00:00Z');
const PRICES = [950000, '950000', '$1,200,000', '$1.2m', '$900,000 - $950,000', '900-950k', 'Contact agent', 'POA', '', null, undefined, 0, NaN, '$NaN', { min: 900000, max: 950000 }, true, 'abc'];
const raw = () => ({
  now: NOW,
  members: [{ uid: 'a', firstName: 'Ann', lastName: 'Agent', accountStatus: 'active', isAgent: true }],
  properties: PRICES.map((price, i) => ({
    id: `p${i}`, userId: 'a', formattedAddress: `${i} Test St`, createdAt: new Date(NOW.getTime() - i * 86400000),
    visibility: true, price, soldPrice: i % 2 ? 'Undisclosed' : NaN, stats: { views: i % 3 === 0 ? 'many' : i },
  })),
  opinions: [], lastSignIns: {},
});

describe('screens never show $NaN, whatever the stored prices and counts', () => {
  it('portfolio (Hub): every card shows a real price or "Price not provided"', () => {
    const data = { office: { name: 'Test Agency' }, leader: { firstName: 'Lee' }, ...buildLeadershipData(raw()) };
    const { container } = render(React.createElement(LeadershipHubView, { data, sample: true }));
    const text = container.textContent;
    expect(text).not.toMatch(/NaN/);
    expect(text).toContain('Price not provided');
    expect(text).toContain('$950,000');
    expect(text).toContain('$1,200,000');
    expect(text).toContain('$900,000 – $950,000');
  });

  it('agent profile: property table never shows NaN', () => {
    const profile = { office: { name: 'Test Agency' }, leader: { firstName: 'Lee' }, ...buildAgentProfile(raw(), 'a') };
    const { container } = render(React.createElement(AgentProfileView, { data: profile, sample: true }));
    const text = container.textContent;
    expect(text).not.toMatch(/NaN/);
    expect(text).toContain('Price not provided');
    expect(text).toContain('$950,000');
  });

  it('non-numeric view counts can never turn a total into NaN or concatenated text', () => {
    const data = buildLeadershipData(raw());
    expect(Number.isInteger(data.overview.views)).toBe(true);
    expect(data.properties.every((p) => Number.isInteger(p.views) && p.views >= 0)).toBe(true);
    // (the raw stored price text '$NaN' is passed through untouched; it is the screens that format it)
    expect(JSON.stringify({ ...data, properties: data.properties.map(({ price, soldPrice, ...rest }) => rest) })).not.toMatch(/NaN/);
  });

  it('the stored prices are passed through unchanged by the calculation code (display-only fix)', () => {
    const input = raw();
    const before = JSON.stringify(input.properties.map((p) => [p.id, p.price]));
    buildLeadershipData(input);
    expect(JSON.stringify(input.properties.map((p) => [p.id, p.price]))).toBe(before);
  });
});

describe('static guarantees', () => {
  const files = ['LeadershipHubView.js', 'AgentProfileView.js', 'report/[id]/page.js'].map((f) => `src/app/dashboard/leadership/${f}`);
  it('every leadership screen formats prices through fmtPrice/campaignPrice, never by hand', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toMatch(/Math\.round\([^)]*price/i);
      expect(src).not.toMatch(/\$\{[^}]*price[^}]*\.toLocaleString/i);
      expect(src).not.toMatch(/`\$\$\{/);
    }
  });
  it('the price display code writes nothing', () => {
    const src = fs.readFileSync('src/app/dashboard/leadership/format.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/firebase|updateDoc|setDoc|fetch\(|\.update\(|\.set\(/);
  });
});
