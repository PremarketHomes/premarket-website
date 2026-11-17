import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OFFICES, TEAM_PAGES } from '../../src/app/components/office-landing/offices';
import { officeLandingMetadata } from '../../src/app/components/office-landing/landingMeta';
import { MITCH_HARROP_PINK, contrastRatio } from '../../src/app/utils/teamTheme';
import { TEAM_THEME_ASSIGNMENTS } from '../../src/app/api/services/teamThemes';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');

describe('/harropteam: the /hph vendor page, with only the team accent and name', () => {
  const t = TEAM_PAGES.harropteam;
  it('is derived from OFFICES.hph: identical except slug, accent and team', () => {
    const { slug, blue, team, ...rest } = t;
    const { slug: s0, blue: b0, ...hphRest } = OFFICES.hph;
    expect(rest).toEqual(hphRest); // same name, navy, logos, labels: HPH updates flow through
    expect(slug).toBe('harropteam');
    expect(blue).toBe(MITCH_HARROP_PINK.colors.primary);
    expect(team).toEqual({ id: 'ICSKK5kDs5RF5OYs11mM', name: 'Mitch Harrop Team' });
    expect(Object.keys(TEAM_THEME_ASSIGNMENTS)).toContain(team.id);
    expect(t.logo).toBe(OFFICES.hph.logo); // Harcourts Property Hub logo kept
  });

  it('the pink accent is readable on the HPH navy (it only ever appears there)', () => {
    expect(contrastRatio(t.blue, t.navy)).toBeGreaterThanOrEqual(4.5);
  });

  it('both pages render the same shared component; /Harropteam and /HarropTeam serve /harropteam', () => {
    expect(read('src/app/hph/page.js')).toContain('<OfficeLanding office={office} />');
    expect(read('src/app/harropteam/page.js')).toContain('<OfficeLanding office={office} />');
    expect(read('src/app/harropteam/page.js')).toContain('const office = TEAM_PAGES.harropteam;');
    const cfg = read('next.config.mjs');
    expect(cfg).toContain("{ source: '/Harropteam', destination: '/harropteam' }");
    expect(cfg).toContain("{ source: '/HarropTeam', destination: '/harropteam' }");
  });

  it('team identification appears only on the team page (hph renders exactly as before)', () => {
    const src = read('src/app/components/office-landing/OfficeLanding.js');
    expect(src).toContain("{team ? `${team.name} · In partnership with Premarket` : 'In partnership with Premarket'}");
    expect(src).toContain('{team && <p');
    expect(OFFICES.hph.team).toBeUndefined();
  });

  it('HPH metadata is unchanged; the team page is identified in its title', () => {
    const hph = officeLandingMetadata(OFFICES.hph, '/hph');
    expect(hph.title).toEqual({ absolute: 'Harcourts Property Hub | Understand your property’s potential' });
    expect(hph.alternates.canonical).toBe('https://premarket.homes/hph');
    expect(hph.robots).toEqual({ index: false, follow: false });
    const team = officeLandingMetadata(t, '/Harropteam');
    expect(team.title.absolute).toBe('Mitch Harrop Team · Harcourts Property Hub | Understand your property’s potential');
    expect(team.description).toBe(hph.description);
  });
});

describe('Agent Hub: pink accent only for verified Mitch Harrop Team members', () => {
  it('reads the server-verified team palette and swaps only the accent colour', () => {
    const src = read('src/app/components/office-landing/AgentHub.js');
    expect(src).toContain("authFetch('/api/teams/mine')");
    expect(src).toContain('knownTeamTheme(d?.team?.theme)?.colors.primary');
    expect(src).toContain("style={{ '--navy': navy, '--blue': teamAccent || blue }}");
    expect(src).toContain('if (!uid) return undefined;'); // signed out: unchanged, no request
  });
});
