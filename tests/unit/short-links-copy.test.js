// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderHook, waitFor, act, render, screen, fireEvent, cleanup } from '@testing-library/react';

// The share buttons (utils/useShortLinks.js + components/CampaignLinks.js): Copy link must put the PROP link on the
// clipboard, waiting for it when the page hasn't loaded it yet; if it can't be had, nothing is copied (never the full
// link) and an error with "Try again" is shown. A page that asks before the signed-in session is restored still gets it.
const mockAuth = vi.hoisted(() => ({ currentUser: { getIdToken: async () => 'token' }, authStateReady: async () => {} }));
vi.mock('../../src/app/firebase/clientApp', () => ({ auth: mockAuth }));

const NUMBER = '4827319056';
const clipboard = [];
let clipboardRefuses = false;
let apiDelay = 0;
let apiStatus = []; // statuses to answer with, in order (then 200)
let apiNever = false;
const apiCalls = [];
vi.stubGlobal('navigator', { clipboard: { writeText: async (t) => { if (clipboardRefuses) throw new Error('denied'); clipboard.push(t); } } });
vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
  const { propertyIds } = JSON.parse(opts.body);
  apiCalls.push({ url, propertyIds });
  if (apiNever) return new Promise(() => {});
  await new Promise((r) => setTimeout(r, apiDelay));
  const status = apiStatus.length ? apiStatus.shift() : 200;
  if (status !== 200) return { ok: false, status, json: async () => ({}) };
  return { ok: true, status, json: async () => ({ numbers: Object.fromEntries(propertyIds.map((id) => [id, NUMBER])) }) };
}));

const links = await import('../../src/app/utils/useShortLinks');
const { copyCampaignLink, campaignPath, campaignLink, fetchPropNumbers, useCampaignLink, waitForPropNumber } = links;
const { useCampaignLinkCopy, CampaignPageLink } = await import('../../src/app/components/CampaignLinks');
const ORIGIN = window.location.origin; // links are built from the page's own origin (premarket.homes in production)
const LINK = `${ORIGIN}/prop${NUMBER}`;

beforeEach(() => { clipboard.length = 0; apiCalls.length = 0; apiDelay = 0; apiStatus = []; apiNever = false; clipboardRefuses = false; });
afterEach(() => { cleanup(); delete globalThis.ClipboardItem; navigator.clipboard.write = undefined; });

describe('Copy link', () => {
  it('asks the prop-links API and copies the prop link', async () => {
    expect(await copyCampaignLink('FirstCampaign0000001')).toEqual({ status: 'copied', link: LINK });
    expect(clipboard).toEqual([LINK]);
    expect(apiCalls[0].url).toBe('/api/prop-links');
  });

  it('copies straight away (no request) when the page already has the link', async () => {
    await fetchPropNumbers(['KnownCampaign0000001']);
    apiCalls.length = 0;
    expect(await copyCampaignLink('KnownCampaign0000001')).toEqual({ status: 'copied', link: LINK });
    expect(apiCalls).toHaveLength(0);
  });

  it('clicked before the link has loaded: waits for it, then copies the PROP link', async () => {
    apiDelay = 300;
    expect(await copyCampaignLink('NotLoadedYet00000001')).toEqual({ status: 'copied', link: LINK });
    expect(clipboard).toEqual([LINK]);
  });

  it('joins a request that is already in flight instead of asking twice, and remembers the answer', async () => {
    apiDelay = 200;
    const loading = fetchPropNumbers(['InFlightCampaign0001']); // the page's own request
    expect((await copyCampaignLink('InFlightCampaign0001')).link).toBe(LINK);
    await loading;
    await fetchPropNumbers(['InFlightCampaign0001']);
    expect(apiCalls.flatMap((c) => c.propertyIds).filter((id) => id === 'InFlightCampaign0001')).toHaveLength(1);
  });

  it('a temporary server error is retried and still copies the prop link', async () => {
    apiStatus = [503];
    expect(await copyCampaignLink('FlakyCampaign0000001')).toEqual({ status: 'copied', link: LINK });
    expect(apiCalls).toHaveLength(2);
  });

  it('if the link can\'t be had, NOTHING is copied (never the full link) and the caller is told', async () => {
    apiStatus = [500, 500, 500];
    expect(await copyCampaignLink('BrokenApiCampaign001')).toEqual({ status: 'failed' });
    expect(clipboard).toEqual([]);
    expect(apiCalls).toHaveLength(3); // tried 3 times
  }, 10000);

  it('a request that is refused outright (400) is not retried', async () => {
    apiStatus = [400];
    expect(await copyCampaignLink('BadRequestCampaign01')).toEqual({ status: 'failed' });
    expect(apiCalls).toHaveLength(1);
  });

  it('a request that hangs gives up after the wait limit instead of waiting forever', async () => {
    apiNever = true;
    expect(await waitForPropNumber('HangingCampaign00001', 100)).toBeNull();
  });

  it('if the browser blocks the clipboard, the prop link is handed back to show (never the full link)', async () => {
    clipboardRefuses = true;
    document.execCommand = vi.fn(() => false); // the old-browser fallback is refused too
    expect(await copyCampaignLink('BlockedClipboard0001')).toEqual({ status: 'blocked', link: LINK });
  });

  it('Safari path: the clipboard write starts inside the click, holding the link that is still loading', async () => {
    apiDelay = 200;
    const items = [];
    globalThis.ClipboardItem = class { constructor(data) { this.data = data; } };
    navigator.clipboard.write = vi.fn(async ([item]) => { items.push(await (await item.data['text/plain']).text()); });
    const copying = copyCampaignLink('SafariCampaign000001');
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1); // synchronously, before any waiting
    expect(await copying).toEqual({ status: 'copied', link: LINK });
    expect(items).toEqual([LINK]);
  });

  it('Safari path: if the link can\'t be had, the pending write fails and nothing is copied', async () => {
    apiStatus = [400];
    const items = [];
    globalThis.ClipboardItem = class { constructor(data) { this.data = data; } };
    navigator.clipboard.write = vi.fn(async ([item]) => { items.push(await (await item.data['text/plain']).text()); });
    expect(await copyCampaignLink('SafariBroken00000001')).toEqual({ status: 'failed' });
    expect(items).toEqual([]);
    expect(clipboard).toEqual([]);
  });

  it('Open / Preview / Copy only ever use the prop link: nothing to fall back to before it is known', () => {
    expect(campaignPath('AbCdEfGhIjKlMnOpQrSt', NUMBER)).toBe(`/prop${NUMBER}`);
    expect(campaignLink('AbCdEfGhIjKlMnOpQrSt', NUMBER)).toBe(LINK);
    expect(campaignPath('AbCdEfGhIjKlMnOpQrSt', null)).toBeNull();
    expect(campaignLink('AbCdEfGhIjKlMnOpQrSt', null)).toBeNull();
  });
});

describe('screens get the prop link even when they ask early', () => {
  it('a page that asks before the sign-in is restored waits for it', async () => {
    const user = mockAuth.currentUser;
    mockAuth.currentUser = null;
    mockAuth.authStateReady = () => new Promise((r) => setTimeout(() => { mockAuth.currentUser = user; r(); }, 150));
    const { result } = renderHook(() => useCampaignLink('EarlyAskCampaign0001'));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(NUMBER));
  });

  it('when a Copy click finds a number, every screen showing that campaign switches to it', async () => {
    apiStatus = [400];
    const { result } = renderHook(() => useCampaignLink('RetriedCampaign00001'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(result.current).toBeNull(); // first request refused
    await act(async () => { await copyCampaignLink('RetriedCampaign00001'); });
    await waitFor(() => expect(result.current).toBe(NUMBER));
  });
});

describe('what the agent sees', () => {
  function CopyButton({ id }) {
    const { copy, copiedId, toast } = useCampaignLinkCopy();
    return createElement('div', null,
      createElement('button', { onClick: () => copy(id) }, copiedId === id ? 'Copied' : 'Copy link'),
      toast);
  }

  it('after a copy: a confirmation showing exactly the link that was copied', async () => {
    render(createElement(CopyButton, { id: 'ToastCampaign0000001' }));
    fireEvent.click(screen.getByText('Copy link'));
    const toast = await screen.findByTestId('link-copied-toast');
    expect(toast.textContent).toBe(`Copied ${LINK.replace(/^https?:\/\//, '')}`);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('if it fails: an error saying nothing was copied, and "Try again" copies the prop link', async () => {
    apiStatus = [400];
    render(createElement(CopyButton, { id: 'ToastFailCampaign001' }));
    fireEvent.click(screen.getByText('Copy link'));
    const error = await screen.findByTestId('link-copy-failed');
    expect(error.textContent).toContain('Nothing was copied');
    expect(clipboard).toEqual([]);
    fireEvent.click(screen.getByTestId('link-copy-retry'));
    expect((await screen.findByTestId('link-copied-toast')).textContent).toContain(`/prop${NUMBER}`);
    expect(clipboard).toEqual([LINK]);
  });

  it('Open links point at /prop... once known, and have no address at all before (so the long link can\'t leak)', async () => {
    apiDelay = 100;
    render(createElement(CampaignPageLink, { propertyId: 'OpenLinkCampaign0001' }, 'Open'));
    const before = screen.getByText('Open');
    expect(before.getAttribute('href')).toBeNull();
    await waitFor(() => expect(screen.getByText('Open').getAttribute('href')).toBe(`/prop${NUMBER}`));
    expect(screen.getByText('Open').getAttribute('target')).toBe('_blank');
  });

  it('Open clicked before the link has loaded opens the new tab at once and sends it to the prop link', async () => {
    apiDelay = 150;
    const tab = { opener: 'x', location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab);
    render(createElement(CampaignPageLink, { propertyId: 'OpenEarlyCampaign001' }, 'Open'));
    fireEvent.click(screen.getByText('Open'));
    expect(open).toHaveBeenCalledWith('', '_blank'); // inside the click, so pop-up blockers allow it
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(LINK));
    expect(tab.opener).toBeNull();
    open.mockRestore();
  });

  it('Open that can\'t get a link closes the tab and shows the error (it never opens the full link)', async () => {
    apiStatus = [400];
    const tab = { opener: 'x', location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab);
    render(createElement(CampaignPageLink, { propertyId: 'OpenFailCampaign0001' }, 'Open'));
    fireEvent.click(screen.getByText('Open'));
    await screen.findByTestId('link-copy-failed');
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
