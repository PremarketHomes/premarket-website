'use client';

import { useEffect, useState } from 'react';
import { auth } from '../firebase/clientApp';
import { authFetch } from './authFetch';
import { isPropNumber, propLinkUrl, propPath } from './shortLinks';

/**
 * Campaign links in the dashboard: every agent/BSO/office share action hands out the campaign's prop link
 * (premarket.homes/prop4827319056, see shortLinks.js), and never the full find-property link.
 *
 * Numbers are fetched in batches from POST /api/prop-links (which creates a campaign's number the first time it is asked
 * for), remembered for the page's lifetime, and pushed to every mounted screen as soon as any request finds one.
 * A request waits for Firebase to restore the signed-in session, retries transient failures, and times out instead of
 * hanging; if a number still can't be had the caller is told (null), so it can show an error with a retry.
 */

const CHUNK = 50; // = MAX_SHORT_LINK_BATCH on the server
const ID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const RETRY_DELAYS_MS = [400, 1500]; // a failed request is tried up to 3 times in all
const REQUEST_TIMEOUT_MS = 8000;
export const LINK_WAIT_MS = 15000; // how long Copy / Open wait for a link that is still being fetched or created

const pending = new Map(); // propertyId -> Promise<number|null> while a request is in flight
const known = new Map(); // propertyId -> number, once any request has found it
const listeners = new Set(); // mounted useCampaignLinks hooks, told about every number found (by any request)
let batch = null; // ids asked for during the current tick, sent as one request

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One request for up to 50 campaigns -> { [propertyId]: number }. Never throws; {} when every attempt failed. */
async function request(ids) {
  for (let attempt = 0; ; attempt += 1) {
    let retry = true;
    try {
      // A page can ask before Firebase has restored the signed-in session (e.g. a campaign page asks as soon as it
      // opens): wait for that instead of giving up.
      if (!auth.currentUser && typeof auth.authStateReady === 'function') await auth.authStateReady();
      if (!auth.currentUser) return {}; // signed out: nothing to retry
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
      try {
        const res = await authFetch('/api/prop-links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyIds: ids }),
          signal: controller?.signal,
        });
        if (res.ok) return (await res.json()).numbers || {};
        retry = res.status >= 500 || res.status === 429 || res.status === 401; // 401: the token is refreshed next try
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch { /* network error or timeout: retry */ }
    if (!retry || attempt >= RETRY_DELAYS_MS.length) return {};
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

async function requestAll(ids) {
  const parts = [];
  for (let i = 0; i < ids.length; i += CHUNK) parts.push(request(ids.slice(i, i + CHUNK)));
  return Object.assign({}, ...(await Promise.all(parts)));
}

/** Every card on a page asks during the same render, so their ids are collected and sent together. */
function enqueue(id) {
  if (!batch) {
    const ids = [];
    const promise = sleep(0).then(() => { batch = null; return requestAll(ids); });
    batch = { ids, promise };
  }
  batch.ids.push(id);
  return batch.promise.then((numbers) => (isPropNumber(numbers[id]) ? numbers[id] : null));
}

function numberFor(id) {
  if (known.has(id)) return Promise.resolve(known.get(id));
  if (!pending.has(id)) {
    const req = enqueue(id);
    pending.set(id, req);
    req.then((number) => {
      pending.delete(id); // a failure is asked again next time
      if (!number) return;
      known.set(id, number);
      listeners.forEach((notify) => notify(id, number)); // every button/link showing this campaign updates
    });
  }
  return pending.get(id);
}

const validId = (id) => typeof id === 'string' && ID_RE.test(id);

/** { [propertyId]: number | null }. Never throws: null means the number could not be had (yet). */
export async function fetchPropNumbers(propertyIds) {
  const ids = [...new Set((propertyIds || []).filter(validId))];
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await numberFor(id)])));
}

/** The campaign's number if this page already has it (synchronous), else null. */
export const knownPropNumber = (propertyId) => known.get(propertyId) || null;

/** The campaign's number, waiting (up to timeoutMs) for one that is still loading or being created. Never throws. */
export function waitForPropNumber(propertyId, timeoutMs = LINK_WAIT_MS) {
  if (!validId(propertyId)) return Promise.resolve(null);
  if (known.has(propertyId)) return Promise.resolve(known.get(propertyId));
  return Promise.race([numberFor(propertyId), sleep(timeoutMs).then(() => null)]);
}

const currentOrigin = () => (typeof window !== 'undefined' ? window.location.origin : undefined);

/** The campaign's link to share (built from the page's own origin, so staging hands out staging links), or null. */
export const campaignLink = (propertyId, number) => (isPropNumber(number) ? propLinkUrl(number, currentOrigin()) : null);

/** Same-site address of the campaign's buyer page (/prop4827319056), or null until the number is known. */
export const campaignPath = (propertyId, number) => (isPropNumber(number) ? propPath(number) : null);

/** The link as people should read it: no "https://" (e.g. premarket.homes/prop4827319056). */
export const displayLink = (url) => String(url || '').replace(/^https?:\/\//, '');

const result = async (link) => {
  if (!link) return { status: 'failed' };
  return (await copyText(link)) ? { status: 'copied', link } : { status: 'blocked', link };
};

/**
 * Copies a campaign's prop link. Always the prop link: if the page hasn't got it yet, the copy waits for it; if it
 * can't be had at all, nothing is copied (never the full link). Resolves to
 *   { status: 'copied', link }    on the clipboard
 *   { status: 'blocked', link }   the browser refused the clipboard: the caller shows the link to copy with a click
 *   { status: 'failed' }          no link could be had: the caller shows an error with a retry
 *
 * Not an async function on purpose: the clipboard call has to START inside the click (Safari). While the link is still
 * loading, a ClipboardItem holding a pending value is written straight away (Safari and Chrome fill it in when the link
 * arrives); otherwise the copy happens once the link is known.
 */
export function copyCampaignLink(propertyId) {
  const number = knownPropNumber(propertyId);
  if (number) return result(campaignLink(propertyId, number));

  const linkPromise = waitForPropNumber(propertyId).then((n) => campaignLink(propertyId, n));
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = linkPromise.then((link) => {
        if (!link) throw new Error('No campaign link');
        return new Blob([link], { type: 'text/plain' });
      });
      blob.catch(() => {}); // the failure is reported below, not as an unhandled rejection
      return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
        .then(async () => ({ status: 'copied', link: await linkPromise }))
        .catch(async () => result(await linkPromise));
    } catch { /* this browser's ClipboardItem can't hold a pending value: copy once the link is known */ }
  }
  return linkPromise.then(result);
}

/** Prop numbers for the campaigns on screen: { [propertyId]: number } (only those known so far). */
export function useCampaignLinks(propertyIds) {
  const key = [...new Set((propertyIds || []).filter(Boolean))].sort().join(',');
  // Numbers already found on this page show immediately (no "getting link" flash when a screen remounts).
  const [numbers, setNumbers] = useState(() => Object.fromEntries(key.split(',').filter((id) => known.has(id)).map((id) => [id, known.get(id)])));
  useEffect(() => {
    if (!key) return undefined;
    const ids = new Set(key.split(','));
    let active = true;
    // Any request that finds one of these numbers (e.g. a Copy click retrying) updates this screen too.
    const notify = (id, number) => { if (active && ids.has(id)) setNumbers((prev) => (prev[id] === number ? prev : { ...prev, [id]: number })); };
    listeners.add(notify);
    fetchPropNumbers([...ids]).then((loaded) => {
      if (!active) return;
      const found = Object.entries(loaded).filter(([, number]) => number);
      if (found.length) setNumbers((prev) => ({ ...prev, ...Object.fromEntries(found) }));
    });
    return () => { active = false; listeners.delete(notify); };
  }, [key]);
  return numbers;
}

/** One campaign's prop number, or null until (or unless) it is known. Pass null to skip. */
export function useCampaignLink(propertyId) {
  return useCampaignLinks(propertyId ? [propertyId] : [])[propertyId] || null;
}

/** Copies text; true when it worked. Falls back to a hidden text field for browsers without the Clipboard API. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(input);
      return ok;
    } catch {
      return false;
    }
  }
}
