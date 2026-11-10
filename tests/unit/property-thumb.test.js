// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import PropertyThumb from '../../src/app/components/PropertyThumb';

const read = (p) => readFileSync(p, 'utf8');
const BUNNY = 'https://premarketvideos.b-cdn.net/photos/abc/1.jpg';
const REX = 'https://images.rexsoftware.com/listing/1.jpg';
const h = React.createElement;
afterEach(cleanup);

describe('PropertyThumb: resized copies with a safe fallback to the original', () => {
  it('a known host loads a small resized copy (1x and 2x), not the original', () => {
    const { container } = render(h(PropertyThumb, { src: BUNNY, width: 64, height: 48, className: 'w-16 h-12' }));
    const img = container.querySelector('img');
    expect(img.getAttribute('src')).toContain('/_next/image?url=' + encodeURIComponent(BUNNY));
    expect(img.getAttribute('src')).toMatch(/w=128/);
    expect(img.getAttribute('srcset')).toMatch(/w=64.* 1x, .*w=128.* 2x/);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toBe('w-16 h-12');
  });
  it('an unknown host (e.g. a freshly synced CRM photo) shows the original, as before', () => {
    const { container } = render(h(PropertyThumb, { src: REX, width: 64, height: 48 }));
    expect(container.querySelector('img').getAttribute('src')).toBe(REX);
  });
  it('if the resized copy fails, the original is shown; the caller hears only a failure of the original', () => {
    const onError = vi.fn();
    const { container } = render(h(PropertyThumb, { src: BUNNY, width: 80, height: 64, onError }));
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img').getAttribute('src')).toBe(BUNNY);
    expect(onError).not.toHaveBeenCalled();
    fireEvent.error(container.querySelector('img'));
    expect(onError).toHaveBeenCalledTimes(1);
  });
  it('fill mode passes sizes so phones get a phone-sized copy', () => {
    const { container } = render(h('div', { style: { position: 'relative' } }, h(PropertyThumb, { src: BUNNY, fill: true, sizes: '(min-width: 640px) 50vw, 100vw' })));
    const img = container.querySelector('img');
    expect(img.getAttribute('sizes')).toBe('(min-width: 640px) 50vw, 100vw');
    expect(img.getAttribute('srcset')).toMatch(/w=640&q=75 640w/);
  });
});

describe('every property list uses it; editing and full-screen views keep originals', () => {
  it('lists and grids', () => {
    const uses = {
      'src/app/dashboard/page.js': 'sizes="(min-width: 1280px) 400px, (min-width: 640px) 50vw, 100vw"',
      'src/app/dashboard/components/BsoCampaigns.js': '<PropertyThumb src={c.imageUrl} width={64} height={48}',
      'src/app/dashboard/office/campaigns/page.js': '<PropertyThumb src={c.imageUrl} width={64} height={48}',
      'src/app/dashboard/team/page.js': '<PropertyThumb src={p.thumbnail} width={80} height={64}',
      'src/app/dashboard/office/team/page.js': '<PropertyThumb src={p.thumbnail} width={80} height={64}',
      'src/app/dashboard/leadership/LeadershipHubView.js': '<PropertyThumb src={p.thumbnail} fill',
      'src/app/dashboard/leadership/AgentProfileView.js': '<PropertyThumb src={p.thumbnail} width={40} height={40}',
      'src/app/listings/page.js': 'sizes="(min-width: 1024px) 480px, (min-width: 640px) 50vw, 100vw"',
      'src/app/components/PublicHomepage.js': 'sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"',
    };
    for (const [p, s] of Object.entries(uses)) expect(read(p), p).toContain(s);
    for (const p of ['src/app/dashboard/page.js', 'src/app/listings/page.js', 'src/app/components/PublicHomepage.js']) {
      const s = read(p); const shimmer = s.slice(s.indexOf('function ShimmerImage'), s.indexOf('function ShimmerImage') + 700);
      expect(shimmer, p).toContain('<PropertyThumb');
    }
  });
  it('the property page full-screen viewer and the add/edit photo steps are untouched', () => {
    expect(read('src/app/components/PropertyPageClient.js')).not.toContain('PropertyThumb');
    expect(read('src/app/dashboard/add/page.js')).not.toContain('PropertyThumb');
    expect(read('src/app/dashboard/edit/[id]/page.js')).not.toContain('PropertyThumb');
  });
});
