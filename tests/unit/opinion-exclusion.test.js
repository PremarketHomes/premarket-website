import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isExcludedOpinion, isTestExclusion, withoutExcluded, exclusionSummary, exclusionNotice,
} from '../../src/app/utils/opinionExclusion';
import { separateOpinions } from '../../src/app/api/services/opinionPrivacy';

// Opinions a Premarket administrator excluded: never counted anywhere, always disclosed in reports.

const EXCLUDED_AT = '2026-11-23T00:30:00Z'; // 23 Nov 2026, 10:30 Brisbane
const ex = (extra = {}) => ({ reportExclusion: { excluded: true, reason: '', excludedAt: EXCLUDED_AT, excludedByUid: 'admin', auditId: 'a1', ...extra } });
const op = (id, amount, createdAt, extra = {}) => ({ id, type: 'opinion', offerAmount: amount, createdAt, ...extra });

// The Glades Drive shape: four $900,000 opinions excluded, one $980,000 left active.
const glades = [
  op('a', 900000, '2026-11-19T04:39:19Z', ex()),
  op('b', 980000, '2026-11-19T04:59:51Z'),
  op('c', 900000, '2026-11-19T05:09:46Z', ex()),
  op('d', 900000, '2026-11-19T06:08:13Z', ex()),
  op('e', 900000, '2026-11-19T08:37:18Z', ex()),
];

describe('isExcludedOpinion / withoutExcluded', () => {
  it('only an explicit excluded: true counts as excluded', () => {
    expect(isExcludedOpinion(op('x', 1, null, ex()))).toBe(true);
    expect(isExcludedOpinion(op('x', 1, null))).toBe(false);
    expect(isExcludedOpinion(op('x', 1, null, { reportExclusion: { excluded: false } }))).toBe(false);
    expect(isExcludedOpinion(op('x', 1, null, { reportExclusion: { excluded: 'true' } }))).toBe(false);
    expect(isExcludedOpinion(null)).toBe(false);
  });
  it('withoutExcluded keeps everything else, in order, and tolerates non-arrays', () => {
    expect(withoutExcluded(glades).map((o) => o.id)).toEqual(['b']);
    expect(withoutExcluded(undefined)).toEqual([]);
    expect(withoutExcluded([null, op('y', 1, null)]).map((o) => o.id)).toEqual(['y']);
  });
});

describe('exclusionSummary', () => {
  it('counts excluded opinions, with the latest exclusion time and distinct reasons; never an amount', () => {
    const s = exclusionSummary([...glades, op('f', 1, null, ex({ reason: 'Duplicate', excludedAt: '2026-11-24T00:00:00Z' }))]);
    expect(s).toEqual({ count: 5, reasons: ['Duplicate'], excludedAt: '2026-11-24T00:00:00.000Z' });
    expect(JSON.stringify(s)).not.toMatch(/900000|980000/);
  });
  it('is null when nothing is excluded, and ignores non-opinion documents', () => {
    expect(exclusionSummary([op('b', 980000, null)])).toBeNull();
    expect(exclusionSummary([{ type: 'comment', ...ex() }])).toBeNull();
    expect(exclusionSummary(undefined)).toBeNull();
  });
  it('reads Firestore Timestamps (admin and client shapes)', () => {
    const ts = { toDate: () => new Date(EXCLUDED_AT) };
    expect(exclusionSummary([op('a', 1, null, ex({ excludedAt: ts }))]).excludedAt).toBe('2026-11-23T00:30:00.000Z');
    expect(exclusionSummary([op('a', 1, null, ex({ excludedAt: { _seconds: 1795393800 } }))]).excludedAt).toBe(new Date(1795393800 * 1000).toISOString());
  });
});

describe('exclusionNotice', () => {
  it('states how many, by whom and when (Brisbane date), and that the figures leave them out', () => {
    expect(exclusionNotice(exclusionSummary(glades))).toBe(
      '4 buyer price opinions were excluded from these results by Premarket on 23 Nov 2026. The figures shown do not include them.',
    );
  });
  it('singular, with a reason', () => {
    expect(exclusionNotice({ count: 1, reasons: ['Submitted twice'], excludedAt: EXCLUDED_AT })).toBe(
      '1 buyer price opinion was excluded from these results by Premarket on 23 Nov 2026. The figures shown do not include it. Reason: Submitted twice.',
    );
  });
  it('uses the Brisbane calendar day (UTC+10)', () => {
    expect(exclusionNotice({ count: 2, reasons: [], excludedAt: '2026-11-22T15:00:00Z' })).toMatch(/on 23 Nov 2026\./);
  });
  it('nothing to say when nothing was excluded', () => {
    expect(exclusionNotice(null)).toBeNull();
    expect(exclusionNotice({ count: 0 })).toBeNull();
  });
});

describe('separateOpinions leaves excluded opinions out of every list and figure', () => {
  const r = separateOpinions(glades);
  it('only the active $980,000 opinion remains', () => {
    expect(r.priceOpinions).toEqual([{ offerAmount: 980000 }]);
    expect(r.summary).toMatchObject({
      opinions: 1, passive: 1, serious: 0, priceCount: 1,
      combinedMedian: 980000, priceMin: 980000, priceMax: 980000,
    });
    expect(r.summary.weekly).toEqual([{ weekOf: '2026-11-16', count: 1, median: null }]);
  });
  it('discloses the exclusion in the summary (count, date, reasons only)', () => {
    expect(r.summary.excluded).toEqual({ count: 4, reasons: [], excludedAt: '2026-11-23T00:30:00.000Z' });
  });
  it('an excluded registration is not listed either', () => {
    const s = separateOpinions([op('r', 900000, '2026-11-19T00:00:00Z', { serious: true, buyerName: 'X', ...ex() })]);
    expect(s.registrations).toEqual([]);
    expect(s.summary.serious).toBe(0);
    expect(s.summary.excluded.count).toBe(1);
  });
  it('no exclusions: unchanged output, excluded is null', () => {
    const s = separateOpinions([op('b', 980000, '2026-11-19T00:00:00Z')]);
    expect(s.summary.excluded).toBeNull();
    expect(s.priceOpinions).toEqual([{ offerAmount: 980000 }]);
  });
});

describe('test submissions: excluded everywhere, never disclosed (like test campaigns)', () => {
  const test = (extra = {}) => ex({ kind: 'test', reason: 'Test submissions', ...extra });
  // The Glades Drive data as it is now: the four $900,000 opinions confirmed as tests.
  const gladesTests = [
    op('a', 900000, '2026-11-19T04:39:19Z', test()),
    op('b', 980000, '2026-11-19T04:59:51Z'),
    op('c', 900000, '2026-11-19T05:09:46Z', test()),
    op('d', 900000, '2026-11-19T06:08:13Z', test()),
    op('e', 900000, '2026-11-19T08:37:18Z', test()),
  ];
  it('isTestExclusion needs both excluded: true and kind: test', () => {
    expect(isTestExclusion(op('x', 1, null, test()))).toBe(true);
    expect(isTestExclusion(op('x', 1, null, ex()))).toBe(false);
    expect(isTestExclusion(op('x', 1, null, { reportExclusion: { excluded: false, kind: 'test' } }))).toBe(false);
  });
  it('still excluded from every list and figure', () => {
    expect(withoutExcluded(gladesTests).map((o) => o.id)).toEqual(['b']);
    const r = separateOpinions(gladesTests);
    expect(r.priceOpinions).toEqual([{ offerAmount: 980000 }]);
    expect(r.summary).toMatchObject({ opinions: 1, priceCount: 1, combinedMedian: 980000, priceMin: 980000, priceMax: 980000 });
  });
  it('nothing to disclose: no summary, no notice', () => {
    expect(exclusionSummary(gladesTests)).toBeNull();
    expect(separateOpinions(gladesTests).summary.excluded).toBeNull();
    expect(exclusionNotice(exclusionSummary(gladesTests))).toBeNull();
  });
  it('a genuine exclusion alongside tests is still disclosed, counting only the genuine one', () => {
    const s = exclusionSummary([...gladesTests, op('f', 1200000, '2026-11-20T00:00:00Z', ex())]);
    expect(s).toMatchObject({ count: 1, reasons: [] });
    expect(exclusionNotice(s)).toMatch(/^1 buyer price opinion was excluded/);
  });
});

describe('wiring (every reader of opinions honours exclusions)', () => {
  const src = (p) => readFileSync(new URL(`../../src/app/${p}`, import.meta.url), 'utf8');
  const readers = [
    'api/services/reportService.js',
    'api/services/leadershipService.js',
    'api/services/teamService.js',
    'api/services/managedCampaignService.js',
    'api/services/publicProfileService.js',
    'api/services/officeRegistrationService.js',
    'api/services/newsletterService.js',
    'api/offers/opinion-count/route.js',
    'api/reports/property-card/route.js',
    'api/v1/helpers.js',
    'api/v1/upcoming-to-market/route.js',
    'api/v1/trending-areas/route.js',
    'api/v1/contactComputation.js',
    'api/cron/market-report/route.js',
    'api/buyer/feed/route.js',
    'dashboard/page.js',
    'dashboard/admin/components/tabs/PropertiesTab.js',
  ];
  it.each(readers)('%s filters excluded opinions', (p) => {
    expect(src(p)).toMatch(/isExcludedOpinion|withoutExcluded/);
  });
  it.each([
    'dashboard/property/[id]/page.js',
    'dashboard/leadership/report/[id]/page.js',
  ])('%s shows the disclosure', (p) => {
    expect(src(p)).toMatch(/exclusionNotice\(/);
    expect(src(p)).toMatch(/opinion-exclusion-notice/);
  });
  it('the emailed report and PDF state the exclusion', () => {
    const s = src('api/services/reportService.js');
    expect(s).toMatch(/exclusionNotice: exclusionNotice\(excluded\)/);
    expect(s).toMatch(/report\.exclusionNotice \? `<p/);
    expect(s).toMatch(/Note: \$\{report\.exclusionNotice\}/);
  });
  it('the shareable card discloses the excluded count', () => {
    expect(src('api/services/propertyCardRenderer.js')).toMatch(/excluded by Premarket/);
  });
  it('no browser can set or clear reportExclusion (firestore.rules allowlists)', () => {
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const createKeys = rules.match(/function offerCreateKeys\(\) \{[\s\S]*?\}/)[0];
    const updateKeys = rules.match(/function offerUpdateKeys\(\) \{[\s\S]*?\}/)[0];
    expect(createKeys).not.toMatch(/reportExclusion/);
    expect(updateKeys).not.toMatch(/reportExclusion/);
  });
});
