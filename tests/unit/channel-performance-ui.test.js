// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Marketing Channel Performance on the campaign report: the three Copy buttons (Email / SMS / General) and the table.
const mockAuth = vi.hoisted(() => ({ currentUser: { getIdToken: async () => 'token' }, authStateReady: async () => {} }));
vi.mock('../../src/app/firebase/clientApp', () => ({ auth: mockAuth }));

const NUMBER = '4827319056';
const clipboard = [];
vi.stubGlobal('navigator', { clipboard: { writeText: async (t) => { clipboard.push(t); } } });
vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
  const { propertyIds } = JSON.parse(opts.body);
  return { ok: true, status: 200, json: async () => ({ numbers: Object.fromEntries(propertyIds.map((id) => [id, NUMBER])) }) };
}));

const { default: ChannelPerformance } = await import('../../src/app/components/ChannelPerformance');
const { useCampaignLinkCopy } = await import('../../src/app/components/CampaignLinks');
const { copyCampaignLink } = await import('../../src/app/utils/useShortLinks');
const { buildChannelReport } = await import('../../src/app/api/services/channelReport');
const ORIGIN = window.location.origin;
const PID = 'CampaignForChannels01';

beforeEach(() => { clipboard.length = 0; });
afterEach(() => cleanup());

function Harness({ channels }) {
  const { copy, copiedKey, toast } = useCampaignLinkCopy();
  return createElement('div', null,
    createElement(ChannelPerformance, { propertyId: PID, propNumber: NUMBER, channels, copy, copiedKey }),
    toast);
}
const report = (email, sms, views, priceCount) => buildChannelReport({
  channelStats: { email: { views: email[0], opinions: email[1] }, sms: { views: sms[0], opinions: sms[1] } },
  propertyStats: { views },
  priceCount,
});

describe('Share campaign: Copy Email / SMS / General link', () => {
  it('shows all three links, each the same campaign link (the general one unchanged)', () => {
    render(createElement(Harness, { channels: report([0, 0], [0, 0], 0, 0) }));
    expect(screen.getByTestId('email-link-text').textContent).toBe(`${ORIGIN.replace(/^https?:\/\//, '')}/prop${NUMBER}e`);
    expect(screen.getByTestId('sms-link-text').textContent).toBe(`${ORIGIN.replace(/^https?:\/\//, '')}/prop${NUMBER}s`);
    expect(screen.getByTestId('general-link-text').textContent).toBe(`${ORIGIN.replace(/^https?:\/\//, '')}/prop${NUMBER}`);
  });

  it('each button copies its own link and says which one was copied', async () => {
    render(createElement(Harness, { channels: report([0, 0], [0, 0], 0, 0) }));
    fireEvent.click(screen.getByTestId('copy-sms-link'));
    await waitFor(() => expect(clipboard).toEqual([`${ORIGIN}/prop${NUMBER}s`]));
    await waitFor(() => expect(screen.getByTestId('link-copied-toast').textContent).toContain('the SMS link'));
    expect(screen.getByTestId('copy-sms-link').textContent).toContain('Copied!');
    expect(screen.getByTestId('copy-email-link').textContent).not.toContain('Copied!');
    fireEvent.click(screen.getByTestId('copy-email-link'));
    await waitFor(() => expect(clipboard.at(-1)).toBe(`${ORIGIN}/prop${NUMBER}e`));
    fireEvent.click(screen.getByTestId('copy-general-link'));
    await waitFor(() => expect(clipboard.at(-1)).toBe(`${ORIGIN}/prop${NUMBER}`));
    await waitFor(() => expect(screen.getByTestId('link-copied-toast').textContent).toBe(`Copied ${ORIGIN.replace(/^https?:\/\//, '')}/prop${NUMBER}`));
  });

  it('the existing Copy link (no channel) still copies the general link, unchanged', async () => {
    expect(await copyCampaignLink(PID)).toEqual({ status: 'copied', link: `${ORIGIN}/prop${NUMBER}` });
    expect(await copyCampaignLink(PID, 'email')).toEqual({ status: 'copied', link: `${ORIGIN}/prop${NUMBER}e` });
    expect(await copyCampaignLink(PID, 'nonsense')).toEqual({ status: 'copied', link: `${ORIGIN}/prop${NUMBER}` });
  });
});

describe('Marketing Channel Performance table', () => {
  const cells = (key) => [...screen.getByTestId(`channel-row-${key}`).querySelectorAll('td')].map((td) => td.textContent);

  it('shows Email, SMS, General / Unknown and Total with views, price opinions and conversion', () => {
    render(createElement(Harness, { channels: report([60, 6], [25, 3], 100, 12) }));
    expect(cells('email')).toEqual(['Email', '60', '6', '10%']);
    expect(cells('sms')).toEqual(['SMS', '25', '3', '12%']);
    expect(cells('general')).toEqual(['General / Unknown', '15', '3', '20%']);
    expect(cells('total')).toEqual(['Total', '100', '12', '12%']);
    expect(screen.getByTestId('channel-performance').textContent).toContain('a forwarded email link counts as Email');
  });

  it('a withheld channel shows no number, and the combined figure says why', () => {
    render(createElement(Harness, { channels: report([60, 6], [25, 3], 93, 9) }));
    expect(cells('email')).toEqual(['Email', '60', '6', '10%']);
    expect(cells('sms')).toEqual(['SMS', '25', '—', '—']);
    expect(cells('general')).toEqual(['General / Unknown', '8', '—', '—']);
    expect(screen.getByTestId('channel-combined').textContent)
      .toContain('SMS and General / Unknown together: 3 price opinions, 9% conversion.');
  });

  it('when nothing can be shown safely, says when it will be', () => {
    render(createElement(Harness, { channels: report([40, 2], [5, 0], 60, 9) }));
    expect(screen.getByTestId('channel-withheld').textContent).toContain('at least 3 in each channel');
    expect(cells('total')).toEqual(['Total', '60', '9', '15%']);
  });

  it('an existing campaign with no channel links opened yet: all General / Unknown, with a hint', () => {
    render(createElement(Harness, { channels: buildChannelReport({ propertyStats: { views: 96 }, priceCount: 8 }) }));
    expect(cells('email')).toEqual(['Email', '0', '0', '—']);
    expect(cells('general')).toEqual(['General / Unknown', '96', '8', '8%']);
    expect(screen.getByTestId('channel-not-started')).toBeTruthy();
  });

  it('if the figures could not be loaded, the share buttons still work', () => {
    render(createElement(Harness, { channels: null }));
    expect(screen.getByTestId('channel-unavailable')).toBeTruthy();
    expect(screen.getByTestId('copy-email-link')).toBeTruthy();
  });
});
