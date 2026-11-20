import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OFFICES, BRANDED_PAGES } from '../../src/app/components/office-landing/offices';
import { officeLandingMetadata } from '../../src/app/components/office-landing/landingMeta';
import { transparentKioskLogo } from '../../src/app/utils/kioskLogo';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

describe('/harcourtsinnereast: the /hph vendor page, with only the office name and logo', () => {
  const p = BRANDED_PAGES.harcourtsinnereast;

  it('is derived from OFFICES.hph: identical except slug, name, agent label and logo', () => {
    const { slug, name, agentLabel, logo, logoColour, ...rest } = p;
    const { slug: s0, name: n0, agentLabel: a0, logo: l0, logoColour: c0, ...hphRest } = OFFICES.hph;
    expect(rest).toEqual(hphRest); // same navy, accent and contact: HPH updates flow through
    expect(slug).toBe('harcourtsinnereast');
    expect(name).toBe('Harcourts Inner East');
    expect(agentLabel).toBe('Harcourts Inner East agent');
    expect(logo).toEqual({ src: '/offices/harcourtsinnereast/logo.png', width: 384, height: 173 });
    expect(logoColour).toBeUndefined(); // no HPH logo carried over
    expect(p.team).toBeUndefined();
  });

  it('the logo is a transparent PNG at 2x its declared size', () => {
    const buf = readFileSync('public/offices/harcourtsinnereast/logo.png');
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buf[25]).toBe(6); // colour type 6 = RGBA
    expect(pngSize(buf)).toEqual({ w: 768, h: 346 });
  });

  it('renders the shared component; no Property Hub reference anywhere in its content', () => {
    expect(read('src/app/harcourtsinnereast/page.js')).toContain('const office = BRANDED_PAGES.harcourtsinnereast;');
    expect(read('src/app/harcourtsinnereast/page.js')).toContain('<OfficeLanding office={office} />');
    expect(read('src/app/harcourtsinnereast/opengraph-image.js')).toContain('officeLandingOgImage(BRANDED_PAGES.harcourtsinnereast)');
    expect(JSON.stringify(p)).not.toMatch(/property hub|\/hph\//i);
    const meta = officeLandingMetadata(p, '/harcourtsinnereast');
    expect(meta.title).toEqual({ absolute: 'Harcourts Inner East | Understand your property’s potential' });
    expect(meta.description).toBe('Harcourts Inner East has partnered with Premarket so you can explore buyer interest and anonymous pricing opinions before you go to market.');
    expect(meta.alternates.canonical).toBe('https://premarket.homes/harcourtsinnereast');
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.openGraph.siteName).toBe('Harcourts Inner East');
  });

  it('HPH and its office features are unchanged', () => {
    expect(Object.keys(OFFICES)).toEqual(['hph']);
    expect(OFFICES.hph.name).toBe('Harcourts Property Hub');
    expect(OFFICES.hph.logo.src).toBe('/offices/hph/logo-white.png');
    expect(read('src/app/hph/page.js')).toContain('const office = OFFICES.hph;');
    expect(transparentKioskLogo('https://premarket.homes/offices/hph/logo-colour.png')).toBe(OFFICES.hph.logo);
    expect(transparentKioskLogo('https://premarket.homes/offices/harcourtsinnereast/logo.png')).toBeNull();
  });
});
