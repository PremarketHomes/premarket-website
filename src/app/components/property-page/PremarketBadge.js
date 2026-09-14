import BrandMark from '../BrandMark';

/**
 * "Powered by Premarket" lockup used on the redesigned property page.
 *
 * Two sizes only, both used exactly once per page:
 *   - "header": the prominent top-right mark. Per the approved design
 *     reference, this is ~25% larger than a typical subtle attribution —
 *     it should read clearly at a glance without competing with the
 *     agency's own branding or the property itself.
 *   - "footer": a small, quiet sign-off mark at the very bottom of the
 *     page, after the agent/agency details.
 *
 * Never recolours the Premarket mark to match agency branding — Premarket's
 * own mark stays Premarket orange regardless of which agency is viewing,
 * exactly like a "Powered by Stripe"/"Built on Shopify" badge would.
 */
export default function PremarketBadge({ variant = 'header', className = '' }) {
  if (variant === 'footer') {
    return (
      <span className={`inline-flex items-center gap-2 text-slate-400 ${className}`}>
        <span className="text-[11px] uppercase tracking-wider">Powered by</span>
        <span className="inline-flex items-center gap-1.5">
          <BrandMark size={14} />
          <span className="font-semibold text-slate-500 text-[13px] tracking-tight">Premarket</span>
        </span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="text-[11px] sm:text-xs uppercase tracking-wider text-slate-400 font-medium hidden sm:inline">
        Powered by
      </span>
      <span className="inline-flex items-center gap-2">
        <BrandMark size={22} />
        <span className="font-bold text-slate-900 text-lg tracking-tight">Premarket</span>
      </span>
    </span>
  );
}
