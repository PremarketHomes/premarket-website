// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// The share buttons' behaviour (utils/useShortLinks.js): Copy link must put the SHORT link on the clipboard, waiting
// for it when the page hasn't loaded it yet, instead of quietly copying the full link; and a page that asks before the
// signed-in session is restored must still end up with short links.
const mockAuth = vi.hoisted(() => ({ currentUser: { getIdToken: async () => 'token' }, authStateReady: async () => {} }));
vi.mock('../../src/app/firebase/clientApp', () => ({ auth: mockAuth }));

const clipboard = [];
let apiDelay = 0;
let apiFails = false;
const apiCalls = [];
vi.stubGlobal('navigator', { clipboard: { writeText: async (t) => { clipboard.push(t); } } });
vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
  const { propertyIds } = JSON.parse(opts.body);
  apiCalls.push(propertyIds);
  await new Promise((r) => setTimeout(r, apiDelay));
  if (apiFails) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => ({ codes: Object.fromEntries(propertyIds.map((id) => [id, 'x7k2m9q'])) }) };
}));

const { copyCampaignLink, campaignPath, fetchShortCodes, useShortCode } = await import('../../src/app/utils/useShortLinks');
const ORIGIN = window.location.origin; // links are built from the page's own origin (premarket.homes in production)

beforeEach(() => { clipboard.length = 0; apiCalls.length = 0; apiDelay = 0; apiFails = false; });

describe('Copy link', () => {
  it('copies the short link straight away when it is already known', async () => {
    expect(await copyCampaignLink('AbCdEfGhIjKlMnOpQrSt', 'x7k2m9q')).toBe(`${ORIGIN}/p/x7k2m9q`);
    expect(clipboard).toEqual([`${ORIGIN}/p/x7k2m9q`]);
  });

  it('clicked before the short link has loaded: waits for it, then copies the SHORT link', async () => {
    apiDelay = 300;
    const link = await copyCampaignLink('NotLoadedYet00000001', null);
    expect(link).toBe(`${ORIGIN}/p/x7k2m9q`);
    expect(clipboard).toEqual([`${ORIGIN}/p/x7k2m9q`]);
  });

  it('joins a request that is already in flight instead of asking twice, and remembers the answer', async () => {
    apiDelay = 200;
    const loading = fetchShortCodes(['InFlightCampaign0001']); // the page's own request
    expect(await copyCampaignLink('InFlightCampaign0001', null)).toBe(`${ORIGIN}/p/x7k2m9q`);
    await loading;
    await fetchShortCodes(['InFlightCampaign0001']);
    expect(apiCalls.flat().filter((id) => id === 'InFlightCampaign0001')).toHaveLength(1);
  });

  it('only if no short link can be had at all does it copy the full link (which always works)', async () => {
    apiFails = true;
    const link = await copyCampaignLink('BrokenApiCampaign001', null);
    expect(link).toBe(`${ORIGIN}/find-property?propertyId=BrokenApiCampaign001`);
    expect(clipboard).toEqual([link]);
  });

  it('Open / Preview links use /p/{code} once known', () => {
    expect(campaignPath('AbCdEfGhIjKlMnOpQrSt', 'x7k2m9q')).toBe('/p/x7k2m9q');
    expect(campaignPath('AbCdEfGhIjKlMnOpQrSt', null)).toBe('/find-property?propertyId=AbCdEfGhIjKlMnOpQrSt');
  });
});

describe('screens get the short link even when they ask early', () => {
  it('a page that asks before the sign-in is restored waits for it (it used to give up and keep the full link)', async () => {
    const user = mockAuth.currentUser;
    mockAuth.currentUser = null;
    mockAuth.authStateReady = () => new Promise((r) => setTimeout(() => { mockAuth.currentUser = user; r(); }, 150));
    const { result } = renderHook(() => useShortCode('EarlyAskCampaign0001'));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('x7k2m9q'));
  });

  it('when a Copy click finds a code, every screen showing that campaign switches to it', async () => {
    apiFails = true;
    const { result } = renderHook(() => useShortCode('RetriedCampaign00001'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(result.current).toBeNull(); // first request failed: full link for now
    apiFails = false;
    await act(async () => { await copyCampaignLink('RetriedCampaign00001', null); });
    await waitFor(() => expect(result.current).toBe('x7k2m9q'));
  });
});
