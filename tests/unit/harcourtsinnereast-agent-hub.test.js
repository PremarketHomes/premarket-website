import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OFFICES, BRANDED_PAGES } from '../../src/app/components/office-landing/offices';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');

describe('/harcourtsinnereast-agent-hub: the /hph-agent-hub page, with only the office name and logo', () => {
  const page = read('src/app/harcourtsinnereast-agent-hub/page.js');
  const og = read('src/app/harcourtsinnereast-agent-hub/opengraph-image.js');

  it('renders the shared AgentHub with the Inner East office', () => {
    expect(page).toContain('const office = BRANDED_PAGES.harcourtsinnereast;');
    expect(page).toContain('<AgentHub office={office} />');
    expect(page).toContain("const url = 'https://premarket.homes/harcourtsinnereast-agent-hub';");
    expect(page).toContain('robots: { index: false, follow: false }');
    expect(og).toContain('BRANDED_PAGES.harcourtsinnereast');
    expect(`${page}\n${og}`).not.toMatch(/Property Hub|PROPERTY HUB|\bHPH\b|OFFICES\.hph/);
  });

  it('the hub copy comes from the office entry; HPH keeps "HPH" and /hph, Inner East gets its own name and vendor page', () => {
    expect(OFFICES.hph.shortName).toBe('HPH');
    expect(BRANDED_PAGES.harcourtsinnereast.shortName).toBe('Harcourts Inner East');
    const hub = read('src/app/components/office-landing/AgentHub.js');
    const tab = read('src/app/components/office-landing/AgentPremarketTab.js');
    const pi = read('src/app/components/office-landing/PriceIntelligenceLanding.js');
    expect(hub).toContain('{name} <span aria-hidden="true">&middot;</span> Agent Hub');
    expect(hub).toContain('<Sections office={office} />');
    expect(tab).toContain('them the {office.shortName} vendor information page');
    expect(tab).toContain('href={`https://premarket.homes/${office.slug}`}');
    expect(pi).toContain('At {office.name}, the focus is simple');
    expect(pi).toContain('Price Intelligence gives {office.shortName} agents');
    expect(pi).toContain('<PriceIntelligenceSections office={office} />');
    for (const src of [hub, tab]) expect(src).not.toMatch(/Property Hub|\bHPH vendor|premarket\.homes\/hph/);
  });

  it('is public like the HPH hub: no sign-in gate (team accent only when signed in)', () => {
    const hub = read('src/app/components/office-landing/AgentHub.js');
    expect(hub).toContain('if (!uid) return undefined;');
    expect(hub).not.toMatch(/router\.(push|replace)|redirect\(/);
    expect(page).not.toMatch(/auth|redirect/i);
  });

  it('the HPH Agent Hub page itself is unchanged', () => {
    const hph = read('src/app/hph-agent-hub/page.js');
    expect(hph).toContain('const office = OFFICES.hph;');
    expect(hph).toContain("const url = 'https://premarket.homes/hph-agent-hub';");
    expect(hph).toContain('An internal resource for Harcourts Property Hub agents.');
  });
});
