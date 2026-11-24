'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { campaignPath, displayLink, useShortCode } from '../utils/useShortLinks';

/**
 * Opens a campaign's buyer page in a new tab at its short link (/p/{code}), so the short link is what the agent sees
 * in the address bar and gets from the browser's Share button. Uses the full link until the short one has loaded.
 */
export function CampaignPageLink({ propertyId, children, ...props }) {
  const code = useShortCode(propertyId);
  return (
    <a href={campaignPath(propertyId, code)} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  );
}

/** "Copied premarket.homes/p/x7k2m9q": shows exactly what went onto the clipboard, then fades after a few seconds. */
export function LinkCopiedToast({ link, onDone }) {
  const [shown, setShown] = useState(link);
  useEffect(() => {
    setShown(link);
    if (!link) return undefined;
    const t = setTimeout(() => { setShown(null); onDone?.(); }, 3500);
    return () => clearTimeout(t);
  }, [link]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return (
    <div role="status" data-testid="link-copied-toast"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 max-w-[92vw] px-4 py-2.5 rounded-full bg-slate-900 text-white text-sm shadow-lg">
      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
      <span className="truncate">Copied <span className="font-semibold">{displayLink(shown)}</span></span>
    </div>
  );
}
