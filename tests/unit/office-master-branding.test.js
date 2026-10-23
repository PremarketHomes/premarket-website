import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyOfficeBrand, computeDisplayLogoUrl, computeEffectiveColors } from '../../src/app/utils/brandStyle';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');
const brand = { id: 'office-o1', name: 'Harcourts Property Hub', logoUrl: 'https://x/harcourts.svg', colors: { primary: '#001f49', secondary: '#00aeef' } };

describe('applyOfficeBrand — office brand is authoritative for linked agents', () => {
  it('replaces personal logo, agency title and colours with the office brand, without mutating the input', () => {
    const agent = { officeId: 'o1', logoUrl: 'https://x/old-personal.png', companyName: 'Old Agency', brandColors: { primary: '#ff0000' }, firstName: 'Sam', avatar: 'a.png', phone: '0400' };
    const out = applyOfficeBrand(agent, brand);
    expect(out).toMatchObject({ logoUrl: brand.logoUrl, companyName: 'Harcourts Property Hub', brandColors: null, firstName: 'Sam', avatar: 'a.png', phone: '0400' });
    expect(agent.logoUrl).toBe('https://x/old-personal.png');
  });

  it('end to end through the existing resolvers: office logo + colours win over a stale personal override', () => {
    const out = applyOfficeBrand({ officeId: 'o1', logoUrl: 'https://x/old.png', brandColors: { primary: '#ff0000' } }, brand);
    expect(computeDisplayLogoUrl({ brand, agentData: out })).toBe(brand.logoUrl);
    expect(computeEffectiveColors({ brand, agentData: out })).toEqual(brand.colors);
  });

  it('does not let a stale personal logo show through when the office brand has none', () => {
    const out = applyOfficeBrand({ officeId: 'o1', logoUrl: 'https://x/old.png' }, { ...brand, logoUrl: null });
    expect(out.logoUrl).toBeNull();
  });

  it('independent agents (no officeId) and a missing brand pass through untouched', () => {
    const indep = { logoUrl: 'https://x/mine.png', companyName: 'Mine', brandColors: { primary: '#123456' } };
    expect(applyOfficeBrand(indep, brand)).toBe(indep);
    const linked = { officeId: 'o1', logoUrl: 'https://x/mine.png' };
    expect(applyOfficeBrand(linked, null)).toBe(linked);
  });
});

describe('surfaces apply the office brand / hide billing prompts for office agents (source guards)', () => {
  it('public property page, listings and TV all resolve agents through the office brand', () => {
    expect(read('src/app/components/PropertyPageClient.js')).toContain('applyOfficeBrand(data, resolvedBrand)');
    expect(read('src/app/listings/page.js')).toContain('withOfficeBrand(');
    expect(read('src/app/tv/[id]/page.js')).toContain('withOfficeBrand(');
  });

  it('Settings shows the inherited office brand read-only and never writes personal logo/company for office agents', () => {
    const s = read('src/app/dashboard/settings/page.js');
    expect(s).toContain('useOfficeBrand(officeId)');
    expect(s).toContain('...(!officeId && logoUrl && { logoUrl })');
    expect(s).toContain('...(!officeId && { companyName: companyName.trim() })');
    expect(s).toMatch(/Agency Logo \(independent agents only\) \*\/\}\s*\{\(userData\?\.isAgent \|\| userData\?\.agent\) && !officeId/);
  });

  it('dashboard hides the billing announcement + billing-contact prompt for office-linked agents only', () => {
    const s = read('src/app/dashboard/page.js');
    expect(s).toMatch(/\{!userData\?\.officeId && \(\s*<>\s*<BillingAnnouncementBanner[\s\S]*?<BillingContactPrompt \/>\s*<\/>/);
  });

  it('billing logic is untouched by this change', () => {
    const changed = ['src/app/utils/officeBrand.js', 'src/app/utils/brandStyle.js'].map(read).join('\n');
    expect(changed).not.toMatch(/billing|invoice|xero|stripe/i);
  });
});

describe('remaining branding surfaces + broken-logo fallback (source guards)', () => {
  it('Settings hides the Billing Details section for office-linked agents only (billing code itself untouched)', () => {
    expect(read('src/app/dashboard/settings/page.js')).toContain('(userData?.isAgent || userData?.agent) && !officeId && <BillingDetailsSection />');
  });

  it('public homepage resolves agents through the office brand; dashboard sidebar shows the office agency title', () => {
    expect(read('src/app/components/PublicHomepage.js')).toContain('withOfficeBrand(');
    const d = read('src/app/dashboard/page.js');
    expect(d).toContain('useOfficeBrand(sidebarOfficeId)');
  });

  it('a broken logo falls back to the agency name (header) or hides (never a broken-image icon)', () => {
    const header = read('src/app/components/property-page/PropertyHeader.js');
    expect(header).toContain('agencyLogoUrl && !logoFailed');
    expect(header).toContain('onError={() => setLogoFailed(true)}');
    for (const f of ['src/app/components/property-page/AgentSignOff.js', 'src/app/listings/page.js', 'src/app/components/PublicHomepage.js', 'src/app/tv/[id]/page.js']) {
      expect(read(f)).toContain("e.currentTarget.style.display = 'none'");
    }
  });

  it('outgoing emails carry no agency logo/title, so there is nothing to resolve there', () => {
    expect(read('src/app/api/services/resendService.js')).not.toMatch(/logoUrl|companyName|brandColors/);
  });
});

describe('office-linked agents never see their old personal agency name while branding loads or fails', () => {
  it('sidebar: office members get a placeholder / retry, personal companyName only for independents', () => {
    const d = read('src/app/dashboard/page.js');
    expect(d).toContain('const agencyTitle = sidebarOfficeId ? null : userData?.companyName;');
    expect(d).toContain("officeBrand.status === 'loading'");
    expect(d).toContain("officeBrand.status === 'failed'");
    expect(d).toContain('onClick={officeBrand.retry}');
  });

  it('Settings: loading skeleton, failure + Retry, and no personal companyName anywhere in the office card', () => {
    const s = read('src/app/dashboard/settings/page.js');
    const card = s.slice(s.indexOf('>Agency Branding<'), s.indexOf('Agency Logo (independent agents only)'));
    expect(card).toContain("officeBrand.status === 'loading'");
    expect(card).toContain("officeBrand.status === 'failed'");
    expect(card).toContain('onClick={officeBrand.retry}');
    expect(card).not.toContain('companyName');
  });

  it('useOfficeBrand distinguishes "no brand" from "failed", and failures are not cached (so retry really retries)', () => {
    const u = read('src/app/utils/officeBrand.js');
    expect(u).toContain('.catch(() => { if (!cancelled) setState({ status: \'failed\', brand: null }); })');
    expect(u).toContain('p.catch(() => cache.delete(officeId))');
  });
});
