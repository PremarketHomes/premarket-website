'use client';

import { useEffect, useState } from 'react';
import { auth } from '../firebase/clientApp';
import { authFetch } from './authFetch';
import { fullBuyerLink, isShortCode, shortLinkUrl } from './shortLinks';

const CHUNK = 50; // = MAX_SHORT_LINK_BATCH on the server
const ID_RE = /^[A-Za-z0-9_-]{6,128}$/;
const cache = new Map(); // propertyId -> Promise<code|null>, per page load
let batch = null; // ids asked for during the current tick, sent as one request

async function load(ids) {
  try {
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
  if (!cache.has(id)) {
    const request = enqueue(id);
    cache.set(id, request);
    request.then((code) => { if (!code) cache.delete(id); }); // a failure is asked again next time
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

/** Short-link codes for the campaigns on screen: { [propertyId]: code } (empty until loaded). */
export function useShortCodes(propertyIds) {
  const key = [...new Set((propertyIds || []).filter(Boolean))].sort().join(',');
  const [codes, setCodes] = useState({});
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    fetchShortCodes(key.split(',')).then((loaded) => {
      if (cancelled) return;
      const found = Object.entries(loaded).filter(([, code]) => code);
      if (found.length) setCodes((prev) => ({ ...prev, ...Object.fromEntries(found) }));
    });
    return () => { cancelled = true; };
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
