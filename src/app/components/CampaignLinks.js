'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Copy, Loader2, X } from 'lucide-react';
import {
  campaignLink, campaignPath, copyCampaignLink, copyText, displayLink, knownPropNumber, useCampaignLink, waitForPropNumber,
} from '../utils/useShortLinks';

/**
 * The share actions every agent/BSO/office screen uses, so they all behave the same:
 *   useCampaignLinkCopy()  Copy link: copies the campaign's prop link (waiting for it if needed), then shows exactly
 *                          what was copied, or an error with "Try again". Never copies the full link.
 *   <CampaignPageLink>     Open / Preview / View page: opens the buyer page at its prop link, so that is what the agent
 *                          sees in the address bar and gets from the browser's Share button.
 */

/** Bottom-of-screen feedback for a copy. Rendered into <body>, so a card's clipping or animation can't trap it. */
export function CampaignLinkToast({ toast, onRetry, onClose }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (toast?.status !== 'copied') return undefined;
    const t = setTimeout(() => onClose?.(), 3500);
    return () => clearTimeout(t);
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!toast || !mounted) return null;

  const shell = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 max-w-[94vw] px-4 py-2.5 rounded-full text-sm shadow-lg';
  let body;
  if (toast.status === 'working') {
    body = (
      <div role="status" data-testid="link-copy-working" className={`${shell} bg-slate-900 text-white`}>
        <Loader2 className="w-4 h-4 animate-spin shrink-0" /> Getting the campaign link…
      </div>
    );
  } else if (toast.status === 'copied') {
    body = (
      <div role="status" data-testid="link-copied-toast" className={`${shell} bg-slate-900 text-white`}>
        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
        <span className="truncate">Copied <span className="font-semibold">{displayLink(toast.link)}</span></span>
      </div>
    );
  } else if (toast.status === 'blocked') {
    // The browser refused the clipboard (rare: permissions, an old browser). A fresh click is always allowed.
    body = (
      <div role="alert" data-testid="link-copy-blocked" className={`${shell} bg-slate-900 text-white`}>
        <span className="truncate select-all">{displayLink(toast.link)}</span>
        <button type="button" onClick={() => copyText(toast.link).then((ok) => ok && onClose?.())}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-slate-900 text-xs font-semibold">
          <Copy className="w-3.5 h-3.5" /> Copy
        </button>
        <button type="button" aria-label="Dismiss" onClick={onClose} className="shrink-0 p-1 text-slate-300 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
    );
  } else {
    body = (
      <div role="alert" data-testid="link-copy-failed" className={`${shell} bg-red-700 text-white`}>
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>We couldn’t get this campaign’s link. Nothing was copied.</span>
        {onRetry && (
          <button type="button" onClick={onRetry} data-testid="link-copy-retry"
            className="shrink-0 px-2.5 py-1 rounded-full bg-white text-red-700 text-xs font-semibold">Try again</button>
        )}
        <button type="button" aria-label="Dismiss" onClick={onClose} className="shrink-0 p-1 text-red-100 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
    );
  }
  return createPortal(body, document.body);
}

/**
 * Copy link for any screen. `copy(propertyId)` must be called straight from the click. `copiedId` is the campaign whose
 * link was just copied (for a "Copied" tick on its button); `toast` is the feedback element to render once per screen.
 */
export function useCampaignLinkCopy() {
  const [state, setState] = useState(null); // { status, propertyId, link? }
  const copy = useCallback((propertyId) => {
    const copying = copyCampaignLink(propertyId); // starts inside the click (Safari needs that)
    if (!knownPropNumber(propertyId)) setState({ status: 'working', propertyId });
    return copying.then((outcome) => {
      setState({ ...outcome, propertyId });
      return outcome;
    });
  }, []);
  const close = useCallback(() => setState(null), []);
  const toast = <CampaignLinkToast toast={state} onRetry={state ? () => copy(state.propertyId) : undefined} onClose={close} />;
  return { copy, copiedId: state?.status === 'copied' ? state.propertyId : null, toast };
}

/**
 * Opens a campaign's buyer page in a new tab at its prop link. Before the number has loaded the link has no address
 * (so it can't be copied from a right-click either): a click opens the tab at once (so pop-up blockers allow it) and
 * points it at the prop link as soon as it is known. If no link can be had, the tab is closed and an error with
 * "Try again" is shown instead of opening the full link.
 */
export function CampaignPageLink({ propertyId, children, onClick, style, ...props }) {
  const number = useCampaignLink(propertyId);
  const [failed, setFailed] = useState(false);

  if (number) {
    return (
      <a href={campaignPath(propertyId, number)} target="_blank" rel="noopener noreferrer" onClick={onClick} style={style} {...props}>
        {children}
      </a>
    );
  }

  const openWhenReady = (event) => {
    event?.preventDefault?.();
    onClick?.(event);
    setFailed(false);
    const tab = window.open('', '_blank');
    waitForPropNumber(propertyId).then((n) => {
      const link = campaignLink(propertyId, n);
      if (!link) { tab?.close(); setFailed(true); return; }
      if (tab) { tab.opener = null; tab.location.replace(link); } else window.open(link, '_blank', 'noopener');
    });
  };
  return (
    <>
      <a role="link" tabIndex={0} aria-busy="true" data-campaign-link="pending" onClick={openWhenReady}
        onKeyDown={(e) => { if (e.key === 'Enter') openWhenReady(e); }} style={{ cursor: 'pointer', ...style }} {...props}>
        {children}
      </a>
      {failed && <CampaignLinkToast toast={{ status: 'failed', propertyId }} onRetry={openWhenReady} onClose={() => setFailed(false)} />}
    </>
  );
}
