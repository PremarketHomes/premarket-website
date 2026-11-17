import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MITCH_HARROP_PINK, TEAM_THEME_PALETTES, knownTeamTheme, teamBrandColors, teamAccentStyle, campaignAccentStyle, contrastRatio,
} from '../../src/app/utils/teamTheme';
import { computeEffectiveColors, computeBrandStyle } from '../../src/app/utils/brandStyle';
import { themeForTeamId, resolveCampaignTeamThemes, TEAM_THEME_ASSIGNMENTS, activeTeamThemeAssignments } from '../../src/app/api/services/teamThemes';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');
// Source without comments, so guards look at code rather than at explanations.
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const THEME_FILES = ['src/app/api/services/teamThemes.js', 'src/app/utils/teamTheme.js', 'src/app/utils/fetchCampaignThemes.js', 'src/app/api/public/campaign-theme/route.js'];
const PINK = { key: MITCH_HARROP_PINK.key };

/* ───────────────────────── palette ───────────────────────── */

describe('team palettes: contrast and safety', () => {
  for (const t of Object.values(TEAM_THEME_PALETTES)) {
    it(`${t.key}: white text on the accent and its dark shade, and the accent as text, all meet WCAG AA (4.5:1)`, () => {
      const c = t.colors;
      expect(contrastRatio(c.primaryText, c.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.primaryText, c.primaryDark)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.primary, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.primary, c.soft)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('the Mitch Harrop palette is marked temporary, not an official brand, and carries no logo or name', () => {
    expect(MITCH_HARROP_PINK.official).toBe(false);
    expect(Object.keys(MITCH_HARROP_PINK)).toEqual(['key', 'official', 'colors']);
  });

  it('only a palette known to this build is ever applied (a response cannot inject CSS)', () => {
    expect(knownTeamTheme(PINK)).toBe(MITCH_HARROP_PINK);
    expect(knownTeamTheme({ key: 'nope' })).toBeNull();
    expect(knownTeamTheme({ key: 'constructor' })).toBeNull();
    expect(knownTeamTheme({ key: MITCH_HARROP_PINK.key, colors: { primary: 'red;background:url(x)' } }).colors.primary).toBe('#be185d');
    expect(knownTeamTheme(null)).toBeNull();
    expect(knownTeamTheme('mitch-harrop-pink')).toBeNull();
  });

  it('no theme means no style attribute at all (every agent and team keeps exactly today\'s look)', () => {
    expect(teamAccentStyle(null)).toBeUndefined();
    expect(teamBrandColors(null)).toBeNull();
    expect(campaignAccentStyle(undefined)).toBeUndefined();
  });

  it('a campaign card with no team theme resets the accent to today\'s colours even inside a themed dashboard', () => {
    const reset = campaignAccentStyle(null);
    expect(Object.values(reset)).toEqual(['initial', 'initial', 'initial', 'initial']);
    expect(campaignAccentStyle(PINK)['--team-accent']).toBe('#be185d');
  });
});

/* ───────────────────────── buyer page precedence ───────────────────────── */

describe('buyer page colours: team accent only for that team\'s campaigns', () => {
  const office = { colors: { primary: '#011d47', primaryDark: '#01183a', primaryText: '#ffffff', secondary: '#01a8ec' } };
  const team = teamBrandColors(PINK);

  it('without a team theme the result is exactly what it was before (office brand / personal / default)', () => {
    expect(computeEffectiveColors({ brand: office, agentData: { brandColors: null } })).toEqual(office.colors);
    expect(computeEffectiveColors({ brand: office, agentData: { brandColors: null }, teamColors: null })).toEqual(office.colors);
    expect(computeEffectiveColors({ brand: null, agentData: { brandColors: { primary: '#123456' } }, teamColors: null })).toEqual({ primary: '#123456' });
    expect(computeEffectiveColors({ brand: null, agentData: null, teamColors: null })).toBeNull();
    expect(computeBrandStyle(null)).toBeUndefined();
  });

  it('a themed campaign uses the team accent over the office colours (the office logo is untouched: colours only)', () => {
    expect(computeEffectiveColors({ brand: office, agentData: { brandColors: null }, teamColors: team })).toEqual(team);
    expect(computeBrandStyle(team)).toEqual({
      '--brand-primary': '#be185d', '--brand-primary-dark': '#9d174d', '--brand-text-on-primary': '#ffffff',
      // kiosk photo stays neutral slate (the no-brand default): pink only on the slider and buttons
      '--brand-tint': '#334155', '--brand-tint-dark': '#0f172a',
    });
    // an agency brand never sets the tint, so its kiosk overlay is exactly as before
    expect(Object.keys(computeBrandStyle(office.colors))).not.toContain('--brand-tint');
  });

  it('the dashboard branding preview still wins over everything', () => {
    const previewBrand = { colors: { primary: '#000000' } };
    expect(computeEffectiveColors({ brand: office, agentData: null, previewBrand, teamColors: team })).toEqual(previewBrand.colors);
  });
});

/* ───────────────────────── server: which campaigns ───────────────────────── */

const MITCH_TEAM = 'teamMitch';
const OTHER_TEAM = 'teamOther';
const OFFICE = 'hph';
const ASSIGN = { [MITCH_TEAM]: MITCH_HARROP_PINK.key };

function fakeDb(seed) {
  const reads = { count: 0 };
  const store = JSON.parse(JSON.stringify(seed));
  const db = {
    reads,
    collection(name) {
      const col = store[name] || {};
      return {
        doc(id) {
          return {
            async get() {
              reads.count += 1;
              if (col[id] === '__throw__') throw new Error('boom');
              return { exists: col[id] !== undefined, id, data: () => col[id] };
            },
          };
        },
        where(field, _op, value) {
          return {
            async get() {
              const docs = Object.entries(col).filter(([, d]) => d && d[field] === value).map(([id, d]) => ({ id, data: () => d }));
              reads.count += docs.length || 1;
              return { docs, empty: docs.length === 0 };
            },
          };
        },
      };
    },
  };
  return db;
}

const agent = (first, last, extra = {}) => ({ firstName: first, lastName: last, agent: true, officeId: OFFICE, ...extra });
const base = () => ({
  teams: { [MITCH_TEAM]: { officeId: OFFICE, name: 'Mitch Harrop Team' }, [OTHER_TEAM]: { officeId: OFFICE, name: 'Other Team' } },
  officeAdminInfo: { [OFFICE]: { status: 'active' } },
  users: {
    mitch: agent('Mitch', 'Harrop', { teamId: MITCH_TEAM }),
    mate: agent('Mia', 'Member', { teamId: MITCH_TEAM }),
    other: agent('Olly', 'Other', { teamId: OTHER_TEAM }),
    solo: agent('Sam', 'Solo'),
    bso: { firstName: 'Bea', lastName: 'Bso', officeId: OFFICE }, // a BSO / uploader, no team
    adminUploader: agent('Ada', 'Admin'),
    twinA: agent('Jo', 'Twin', { teamId: MITCH_TEAM }),
    twinB: agent('Jo', 'Twin'),
  },
  properties: {
    pMitch: { userId: 'mitch' },
    pMate: { userId: 'mate' },
    pOther: { userId: 'other' },
    pSolo: { userId: 'solo' },
    // managed: BSO uploaded for Mitch's team member → the team of the SELLING AGENT (userId)
    pManagedForMitch: { userId: 'mate', managedByUid: 'bso', createdByUid: 'bso', managedCreation: true },
    // managed: a Mitch member uploaded (as office admin/team creator) for a non-team agent → NOT themed
    pUploadedByMitchForSolo: { userId: 'solo', managedByUid: 'mitch', createdByUid: 'mitch', managedCreation: true },
    // older roster shape: uploaded under an admin account, assigned to a Mitch member by name → themed
    pRosterForMitch: { userId: 'adminUploader', agentId: 'r1', agentName: 'Mia  member' },
    // older roster shape: uploaded under a Mitch member's account for a NON-team agent → not themed (uploader ignored)
    pRosterByMitchForOther: { userId: 'mitch', agentId: 'r2', agentName: 'Olly Other' },
    // ambiguous assigned name → never guessed
    pRosterAmbiguous: { userId: 'adminUploader', agentId: 'r3', agentName: 'Jo Twin' },
  },
});

describe('themeForTeamId', () => {
  it('maps only an assigned team id to a known palette', () => {
    expect(themeForTeamId(MITCH_TEAM, ASSIGN)).toEqual(PINK);
    expect(themeForTeamId(OTHER_TEAM, ASSIGN)).toBeNull();
    expect(themeForTeamId(null, ASSIGN)).toBeNull();
    expect(themeForTeamId('x', { x: 'unknown-palette' })).toBeNull();
    for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect(themeForTeamId(k, ASSIGN)).toBeNull();
  });

  it('a staging test team is honoured only off the live project, never in production', () => {
    const stagingSa = JSON.stringify({ project_id: 'premarket-ows-staging-dbf1' });
    expect(activeTeamThemeAssignments({ TEAM_THEME_TEST_TEAM_ID: 'stgTeam', FIREBASE_SERVICE_ACCOUNT: stagingSa })).toMatchObject({ stgTeam: MITCH_HARROP_PINK.key });
    expect(activeTeamThemeAssignments({ TEAM_THEME_TEST_TEAM_ID: 'stgTeam', FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'premarket-homes' }) })).toBe(TEAM_THEME_ASSIGNMENTS);
    expect(activeTeamThemeAssignments({ TEAM_THEME_TEST_TEAM_ID: 'stgTeam' })).toBe(TEAM_THEME_ASSIGNMENTS); // no credentials = live
    expect(activeTeamThemeAssignments({ TEAM_THEME_TEST_TEAM_ID: 'stgTeam', FIREBASE_SERVICE_ACCOUNT: '{bad' })).toBe(TEAM_THEME_ASSIGNMENTS);
  });

  it('the shipped list themes exactly one team: the verified Mitch Harrop Team id', () => {
    expect(TEAM_THEME_ASSIGNMENTS).toEqual({ ICSKK5kDs5RF5OYs11mM: MITCH_HARROP_PINK.key });
    expect(themeForTeamId('ICSKK5kDs5RF5OYs11mM', TEAM_THEME_ASSIGNMENTS)).toEqual(PINK);
    // every other HPH team id seen in production stays unthemed
    for (const other of ['06M7JccJtlbZUA0X33bQ', '1FgqPISsUpUDQbbzuWcy', '80l5CY7rWQ9VHXTHnRAs', 'FIjXIIsiuXp8MjxbxYw6', 'MVPgk1YkioH4JAmjaKsV',
      'Zph40MPoxyWpw6F2LIEi', 'bgblKDwJVyLS30OYwGdi', 'l366znAyim3u1C85oLQ0', 'qLzxwenbOgw0xQsMnL5C', 'uiTM8WOad5nF5DrNkt88', 'xG8B56SMtCaNj9PZbIcu',
      'yKyuOGHG5FwyizWyMuip', 'yksFVF7o1zMKtqUo62zV']) expect(themeForTeamId(other, TEAM_THEME_ASSIGNMENTS)).toBeNull();
  });
});

describe('resolveCampaignTeamThemes — by the campaign\'s team, never the uploader or the viewer', () => {
  let db;
  beforeEach(() => { db = fakeDb(base()); });
  const resolve = (ids, seedDb = db) => resolveCampaignTeamThemes(seedDb, ids, { assignments: ASSIGN });

  it('themes the Mitch Harrop Team\'s own campaigns', async () => {
    expect(await resolve(['pMitch', 'pMate'])).toEqual({ pMitch: PINK, pMate: PINK });
  });

  it('other HPH teams and agents with no team keep their appearance (no leakage)', async () => {
    expect(await resolve(['pOther', 'pSolo'])).toEqual({ pOther: null, pSolo: null });
  });

  it('managed campaigns follow the selling agent: BSO-uploaded for a member is themed; a member uploading for someone else is not', async () => {
    expect(await resolve(['pManagedForMitch', 'pUploadedByMitchForSolo'])).toEqual({ pManagedForMitch: PINK, pUploadedByMitchForSolo: null });
  });

  it('older roster-assigned listings use the assigned agent (unique name in the office), never the uploading account', async () => {
    expect(await resolve(['pRosterForMitch', 'pRosterByMitchForOther'])).toEqual({ pRosterForMitch: PINK, pRosterByMitchForOther: null });
  });

  it('an ambiguous assigned name is never guessed', async () => {
    expect(await resolve(['pRosterAmbiguous'])).toEqual({ pRosterAmbiguous: null });
  });

  it('a stale team pointer, a team moved to another office, or an inactive office gives no theme', async () => {
    const s1 = base(); delete s1.teams[MITCH_TEAM];
    expect((await resolve(['pMitch'], fakeDb(s1))).pMitch).toBeNull();
    const s2 = base(); s2.teams[MITCH_TEAM].officeId = 'elsewhere';
    expect((await resolve(['pMitch'], fakeDb(s2))).pMitch).toBeNull();
    const s3 = base(); s3.officeAdminInfo[OFFICE].status = 'suspended';
    expect((await resolve(['pMitch'], fakeDb(s3))).pMitch).toBeNull();
    const s4 = base(); s4.users.mitch.officeId = 'elsewhere';
    expect((await resolve(['pMitch'], fakeDb(s4))).pMitch).toBeNull();
  });

  it('leaving the team ends the theme immediately (read live, nothing stored)', async () => {
    const s = base(); delete s.users.mate.teamId;
    expect(await resolve(['pMate', 'pManagedForMitch'], fakeDb(s))).toEqual({ pMate: null, pManagedForMitch: null });
  });

  it('unknown campaigns and a failed read answer "no theme" without affecting the others', async () => {
    const s = base(); s.properties.pBroken = '__throw__';
    expect(await resolve(['missing1', 'pBroken', 'pMitch'], fakeDb(s))).toEqual({ missing1: null, pBroken: null, pMitch: PINK });
  });

  it('with no team assigned it answers null for everything and reads nothing', async () => {
    const out = await resolveCampaignTeamThemes(db, ['pMitch', 'pMate'], { assignments: {} });
    expect(out).toEqual({ pMitch: null, pMate: null });
    expect(db.reads.count).toBe(0);
  });

  it('caps and de-duplicates the ids', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `p${String(i).padStart(6, '0')}`);
    expect(Object.keys(await resolve([...ids, ...ids])).length).toBe(25);
  });
});

/* ───────────────────────── public route ───────────────────────── */

let routeDb;
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: new Proxy({}, { get: (_, prop) => routeDb[prop] }) }));

describe('GET /api/public/campaign-theme', () => {
  it('returns only palette keys per campaign (no team id, owner or member data), CDN-cacheable', async () => {
    routeDb = fakeDb(base());
    const { GET } = await import('../../src/app/api/public/campaign-theme/route.js');
    const res = await GET(new Request('https://x/api/public/campaign-theme?ids=pMitch,pOther,bad%20id'));
    const body = await res.json();
    // (fake ids: no themed team in this fake data, so both are null)
    expect(Object.keys(body)).toEqual(['themes']);
    expect(Object.keys(body.themes).sort()).toEqual(['pMitch', 'pOther']);
    for (const v of Object.values(body.themes)) expect(v === null || Object.keys(v).join() === 'key').toBe(true);
    expect(res.headers.get('Cache-Control')).toMatch(/s-maxage=60/);
  });

  it('never depends on who is asking: the route reads no auth', () => {
    const src = read('src/app/api/public/campaign-theme/route.js');
    expect(src).not.toMatch(/verifyAuth|authorization|currentUser|cookies\(/i);
  });
});

/* ───────────────────────── guards ───────────────────────── */

describe('scope guards', () => {
  it('the theme service and helpers only read: no writes of any kind', () => {
    const src = THEME_FILES.map(code).join('\n');
    expect(src).not.toMatch(/\.(update|add|delete|create)\(|runTransaction|batch\(|FieldValue|method:\s*'(POST|PUT|PATCH|DELETE)'/);
    // The only .set( calls are on in-memory Maps (per-request memo / per-page cache), never on a document.
    for (const m of src.matchAll(/(\w+)\.set\(/g)) expect(['memo', 'cache']).toContain(m[1]);
  });

  it('pricing, promo, billing, permissions, membership and opinions are not touched', () => {
    const src = THEME_FILES.map(code).join('\n');
    expect(src).not.toMatch(/billing|invoice|charge|price|promo|HPHNOVEMBER|offers|opinion|permission|propertyCharges|teamInvites/i);
  });

  it('team APIs expose the palette of the verified team only', () => {
    const svc = read('src/app/api/services/teamService.js');
    expect(svc).toContain('theme: themeForTeamId(me.team.id)');
    expect(svc).toContain('total: properties.length, theme: themeForTeamId(me.team.id) }');
  });

  it('buyer page, slider, confirmation and iPad kiosk all take the team colours through the existing brand variables', () => {
    const page = read('src/app/components/PropertyPageClient.js');
    expect(page).toContain('computeEffectiveColors({ brand, agentData, previewBrand, teamColors: teamBrandColors(teamTheme) })');
    expect(page).toContain('brandStyle={brandStyle}'); // kiosk
    const kiosk = read('src/app/components/kiosk/OpenHomeKiosk.js');
    expect(kiosk).toContain('var(--brand-tint, var(--brand-primary, #334155))'); // falls back to the brand colour as before
    expect(read('src/app/components/PriceOpinionSlider.js')).toContain('var(--brand-primary');
  });

  it('every dashboard accent keeps today\'s colour as its fallback', () => {
    const src = read('src/app/dashboard/page.js') + read('src/app/dashboard/team/page.js');
    const lines = src.split('\n').filter((l) => l.includes('var(--team-accent'));
    expect(lines.length).toBeGreaterThan(15);
    for (const line of lines) {
      // A bare var(--team-accent) (no fallback) only appears on an element rendered for a themed campaign.
      if (/var\(--team-accent\)/.test(line)) expect(line).toMatch(/\{(campaignTheme|rowTheme) && /);
      for (const m of line.matchAll(/var\(--team-accent[a-z-]*,/g)) expect(m[0]).toMatch(/,$/);
    }
  });
});
