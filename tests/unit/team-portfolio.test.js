import { describe, it, expect } from 'vitest';
import { teamRowToProperty, teamPropertiesFrom, listForView, computeStats, sortNewestFirst } from '../../src/app/utils/teamPortfolio';

const row = (over = {}) => ({
  id: 'p1', address: '1 Bob St', status: 'live', listingStatus: 'pre-market', price: 900000, soldPrice: null,
  bedrooms: 3, bathrooms: 2, carSpaces: 1, views: 7, thumbnail: 'x.jpg', createdAt: '2026-09-01T00:00:00.000Z',
  owner: { uid: 'bob', name: 'Bob Test' }, opinions: 2, ...over,
});
const own = (id, over = {}) => ({ id, userId: 'me', visibility: true, stats: { views: 5 }, createdAt: { toMillis: () => Date.parse('2026-09-02T00:00:00Z') }, ...over });

describe('teamRowToProperty', () => {
  it('maps a row to the card shape, flagged as a read-only teammate listing', () => {
    const p = teamRowToProperty(row());
    expect(p).toMatchObject({ id: 'p1', formattedAddress: '1 Bob St', isTeamListing: true, listedBy: 'Bob Test', userId: 'bob', visibility: true, archived: false, hidden: false, opinions: 2 });
    expect(p.imageUrls).toEqual(['x.jpg']);
    expect(p.stats.views).toBe(7);
  });
  it('maps statuses the way the dashboard badges read them', () => {
    expect(teamRowToProperty(row({ status: 'hidden' }))).toMatchObject({ visibility: false, archived: false });
    expect(teamRowToProperty(row({ status: 'archived' }))).toMatchObject({ archived: true });
    expect(teamRowToProperty(row({ status: 'archived' })).archivedReason).toBeUndefined();
    expect(teamRowToProperty(row({ status: 'sold', soldPrice: 1 }))).toMatchObject({ archived: true, archivedReason: 'sold', soldPrice: 1 });
  });
  it('copes with missing owner, photo and counts', () => {
    const p = teamRowToProperty({ id: 'z', status: 'live' });
    expect(p.listedBy).toBe('Teammate');
    expect(p.imageUrls).toEqual([]);
    expect(p.opinions).toBe(0);
    expect(p.stats.views).toBe(0);
  });
});

describe('teamPropertiesFrom — no duplicates', () => {
  it('drops rows already in the agent\'s own list, repeated rows, and the agent\'s own uid', () => {
    const out = teamPropertiesFrom([row({ id: 'a' }), row({ id: 'a' }), row({ id: 'mine' }), row({ id: 'c', owner: { uid: 'me', name: 'Me' } }), row({ id: 'd' })], [own('mine')], 'me');
    expect(out.map((p) => p.id)).toEqual(['a', 'd']);
  });
  it('tolerates junk input', () => {
    expect(teamPropertiesFrom(null)).toEqual([]);
    expect(teamPropertiesFrom([null, {}, undefined])).toEqual([]);
  });
});

describe('listForView', () => {
  const mine = [own('m1'), own('m2', { createdAt: { toMillis: () => Date.parse('2026-08-01T00:00:00Z') } })];
  const team = teamPropertiesFrom([row({ id: 't1' })], mine, 'me');
  it('mine / team return only that side; all merges both with every id once, newest first', () => {
    expect(listForView('mine', mine, team)).toBe(mine);
    expect(listForView('team', mine, team)).toBe(team);
    const all = listForView('all', mine, team);
    expect(all.map((p) => p.id)).toEqual(['m1', 't1', 'm2']);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
  });
  it('unknown view falls back to all', () => {
    expect(listForView('bogus', mine, team)).toHaveLength(3);
  });
  it('sorting is stable for equal timestamps', () => {
    expect(sortNewestFirst([{ id: 'a' }, { id: 'b' }]).map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('computeStats', () => {
  const ownActive = [own('m1'), own('m2', { visibility: false, stats: { views: 3 } })];
  const teamAll = teamPropertiesFrom([row({ id: 't1', opinions: 4, views: 10 }), row({ id: 't2', status: 'hidden', opinions: 1, views: 2 }), row({ id: 't3', status: 'sold', opinions: 5, views: 99 })]);
  const teamActive = teamAll.filter((p) => p.archived !== true);
  const args = { ownActive, teamActive, teamAll, ownOpinions: 6 };

  it('all = own + team, nothing counted twice', () => {
    expect(computeStats({ view: 'all', ...args })).toEqual({ properties: 4, live: 2, views: 5 + 3 + 10 + 2, opinions: 6 + 4 + 1 + 5 });
  });
  it('mine is exactly the agent\'s own figures; team is exactly the teammates\'', () => {
    expect(computeStats({ view: 'mine', ...args })).toEqual({ properties: 2, live: 1, views: 8, opinions: 6 });
    expect(computeStats({ view: 'team', ...args })).toEqual({ properties: 2, live: 1, views: 12, opinions: 10 });
  });
  it('all = mine + team for every figure (no inflation)', () => {
    const [a, m, t] = ['all', 'mine', 'team'].map((view) => computeStats({ view, ...args }));
    for (const k of Object.keys(a)) expect(a[k]).toBe(m[k] + t[k]);
  });
  it('with no team, the figures are the agent\'s own', () => {
    expect(computeStats({ view: 'all', ownActive, teamActive: [], teamAll: [], ownOpinions: 6 })).toEqual({ properties: 2, live: 1, views: 8, opinions: 6 });
  });
});
