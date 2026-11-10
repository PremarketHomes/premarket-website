// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { render, cleanup } from '@testing-library/react';
import { DashboardSkeleton, OfficePageSkeleton, ReportSkeleton, EditSkeleton, PropertyCardsSkeleton, CampaignRowsSkeleton } from '../../src/app/dashboard/components/PageSkeletons';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
afterEach(cleanup);

describe('loading placeholders carry no data', () => {
  const all = [h(DashboardSkeleton), h(OfficePageSkeleton), h(OfficePageSkeleton, { overview: true }), h(ReportSkeleton), h(EditSkeleton)];
  it('no digits, no images, no links or buttons; announced as loading', () => {
    for (const el of all) {
      const { container } = render(el);
      const text = container.textContent.replace('Loading…', '');
      expect(text).not.toMatch(/\d/); // no counts, so never a misleading "0 properties"
      expect(text).not.toMatch(/no properties|no campaigns|nothing/i);
      expect(container.querySelector('img, a, button, input')).toBeNull();
      expect(container.querySelector('[role="status"][aria-busy="true"]')).toBeTruthy();
      cleanup();
    }
  });
  it('the only words shown are the generic page name on the Dashboard header', () => {
    const { container } = render(h(DashboardSkeleton));
    expect(container.textContent.replace('Loading…', '').trim()).toBe('Dashboard');
    cleanup();
    for (const el of [h(PropertyCardsSkeleton), h(CampaignRowsSkeleton)]) { const r = render(el); expect(r.container.textContent).toBe(''); cleanup(); }
  });
});

describe('full-screen spinners replaced on signed-in pages', () => {
  it('Dashboard, Office pages, report and edit use the placeholders while loading', () => {
    const dash = read('src/app/dashboard/page.js');
    expect(dash).toContain('<Suspense fallback={<DashboardSkeleton />}>');
    expect(dash).toContain('if (loading) return <DashboardSkeleton />;');
    expect(dash).toContain('{showBsoLayout ? <CampaignRowsSkeleton /> : <PropertyCardsSkeleton />}');
    expect(read('src/app/dashboard/office/page.js')).toContain('if (authLoading || loading) return <OfficePageSkeleton overview />;');
    for (const p of ['campaigns', 'teams', 'registrations', 'agents', 'team']) expect(read(`src/app/dashboard/office/${p}/page.js`), p).toContain('return <OfficePageSkeleton />;');
    expect(read('src/app/dashboard/office/campaigns/page.js')).toContain('<Suspense fallback={<OfficePageSkeleton />}><CampaignsInner /></Suspense>');
    expect(read('src/app/dashboard/property/[id]/page.js')).toContain('if (authLoading || loading) return <ReportSkeleton />;');
    expect(read('src/app/dashboard/edit/[id]/page.js')).toContain('if (authLoading || pageLoading) return <EditSkeleton />;');
  });
  it('the access and data checks that follow loading are unchanged', () => {
    expect(read('src/app/dashboard/page.js')).toContain('if (!user) return null;');
    expect(read('src/app/dashboard/property/[id]/page.js')).toContain('if (!user) return null;');
    expect(read('src/app/dashboard/edit/[id]/page.js')).toContain('if (!user) return null;');
    expect(read('src/app/dashboard/office/campaigns/page.js')).toContain("state.status === 'not-admin' ? 'Only office administrators can see office campaigns.'");
  });
});
