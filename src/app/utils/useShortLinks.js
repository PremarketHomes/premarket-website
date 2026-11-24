'use client';

import { useEffect, useState } from 'react';
import { auth } from '../firebase/clientApp';
import { authFetch } from './authFetch';
import { fullBuyerLink, isShortCode, shortLinkUrl } from './shortLinks';

const CHUNK = 50; // = MAX_SHORT_LINK_BATCH on the server
const ID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const cache = new Map(); // propertyId -> Promise<code|null>, per page load
const known = new Map(); // propertyId -> code, once any request has found it
const listeners = new Set(); // mounted useShortCodes hooks, told about every code found (by any request)
let batch = null; // ids asked for during the current tick, sent as one request

async function load(ids) {
  try {
    // A page can ask before Firebase has restored the signed-in session (e.g. the campaign page asks as soon as it
    // opens): wait for that instead of giving up, which used to leave the page on the full link.
    if (!auth.currentUser && typeof auth.authStateReady === 'function') await auth.authStateReady();
    if (!auth.currentUser) return {};
    const res = await authFetch('/api/short-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyIds: ids }),
    });
    if (!res.ok) return {};
    return (await res.json()).codes || {};
  } catch {
    return {};
  }
}

async function loadAll(ids) {
  const parts = [];
  for (let i = 0; i < ids.length; i += CHUNK) parts.push(load(ids.slice(i, i + CHUNK)));
  return Object.assign({}, ...(await Promise.all(parts)));
}

/** Every card on a page asks during the same render, so their ids are collected and sent together. */
function enqueue(id) {
  if (!batch) {
    const ids = [];
    const promise = new Promise((resolve) => setTimeout(resolve, 0)).then(() => { batch = null; return loadAll(ids); });
    batch = { ids, promise };
  }
  batch.ids.push(id);
  return batch.promise.then((codes) => (isShortCode(codes[id]) ? codes[id] : null));
}

function codeFor(id) {
  if (known.has(id)) return Promise.resolve(known.get(id));
  if (!cache.has(id)) {
    const request = enqueue(id);
    cache.set(id, request);
    request.then((code) => {
      if (!code) { cache.delete(id); return; } // a failure is asked again next time
      known.set(id, code);
      listeners.forEach((notify) => notify(id, code)); // every button/link showing this campaign updates
    });
  }
  return cache.get(id);
}

/** { [propertyId]: code | null }. Never throws: any failure is "no code", and the page uses the full link. */
export async function fetchShortCodes(propertyIds) {
  const ids = [...new Set((propertyIds || []).filter((id) => typeof id === 'string' && ID_RE.test(id)))];
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await codeFor(id)])));
}

const currentOrigin = () => (typeof window !== 'undefined' ? window.location.origin : undefined);

/**
 * The link to copy for a campaign: its short link once known, otherwise its full buyer link (always valid). Both are
 * built from the page's own origin, so a staging site hands out staging links.
 */
export function campaignLink(propertyId, code) {
  return isShortCode(code) ? shortLinkUrl(code, currentOrigin()) : fullBuyerLink(propertyId, currentOrigin());
}

/** The link as people should read it: no "https://" (e.g. premarket.homes/p/x7k2m9q). */
export const displayLink = (url) => String(url || '').replace(/^https?:\/\//, '');

/** Same-site address of a campaign's buyer page, for Open / Preview / View page links: /p/{code} once known. */
export const campaignPath = (propertyId, code) =>
  (isShortCode(code) ? `/p/${code}` : `/find-property?propertyId=${encodeURIComponent(propertyId)}`);

/** The campaign's code, waiting (up to timeoutMs) for one that is still loading or being created. Never throws. */
export function waitForShortCode(propertyId, timeoutMs = 6000) {
  if (typeof propertyId !== 'string' || !ID_RE.test(propertyId)) return Promise.resolve(null);
  return Promise.race([codeFor(propertyId), new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
}

/**
 * Copy a campaign's link: always the short link, waiting for it if the page hasn't got it yet (instead of quietly
 * copying the full link). Only if no short link can be had at all is the full link copied. Resolves to the link that
 * was copied, or null if the browser refused (the caller then shows the link to copy by hand).
 *
 * While the link is still loading, Safari only allows the copy through clipboard.write() with a pending item started
 * inside the click, so that is tried first; other browsers copy once the link is known.
 */
export async function copyCampaignLink(propertyId, knownCode) {
  if (isShortCode(knownCode)) {
    const link = campaignLink(propertyId, knownCode);
    return (await copyText(link)) ? link : null;
  }
  const linkPromise = waitForShortCode(propertyId).then((code) => campaignLink(propertyId, code));
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = linkPromise.then((link) => new Blob([link], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return await linkPromise;
    } catch { /* fall through */ }
  }
  const link = await linkPromise;
  return (await copyText(link)) ? link : null;
}

/** Short-link codes for the campaigns on screen: { [propertyId]: code } (empty until loaded). */
export function useShortCodes(propertyIds) {
  const key = [...new Set((propertyIds || []).filter(Boolean))].sort().join(',');
  // Codes already found on this page show immediately (no flash of the full link when a screen remounts).
  const [codes, setCodes] = useState(() => Object.fromEntries(key.split(',').filter((id) => known.has(id)).map((id) => [id, known.get(id)])));
  useEffect(() => {
    if (!key) return undefined;
    const ids = new Set(key.split(','));
    let active = true;
    // Any request that finds one of these codes (e.g. a Copy click retrying) updates this screen too.
    const notify = (id, code) => { if (active && ids.has(id)) setCodes((prev) => (prev[id] === code ? prev : { ...prev, [id]: code })); };
    listeners.add(notify);
    fetchShortCodes([...ids]).then((loaded) => {
      if (!active) return;
      const found = Object.entries(loaded).filter(([, code]) => code);
      if (found.length) setCodes((prev) => ({ ...prev, ...Object.fromEntries(found) }));
    });
    return () => { active = false; listeners.delete(notify); };
  }, [key]);
  return codes;
}

/** One campaign's short-link code, or null until (or unless) it is known. Pass null to skip. */
export function useShortCode(propertyId) {
  return useShortCodes(propertyId ? [propertyId] : [])[propertyId] || null;
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
