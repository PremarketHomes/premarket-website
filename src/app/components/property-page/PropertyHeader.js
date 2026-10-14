import Image from 'next/image';
import PremarketBadge from './PremarketBadge';

/**
 * Minimal campaign header for the redesigned public property page.
 *
 * Deliberately NOT the site-wide marketing <Nav> (mega dropdowns, login,
 * browse listings, etc.) — a buyer arriving from an SMS/email campaign
 * link is here to look at one property, not to explore the Premarket
 * marketing site. Matches the reference: agency identity on the left,
 * Premarket attribution on the right, nothing else competing for
 * attention.
 *
 * Hierarchy: PROPERTY → AGENT → AGENCY → PREMARKET. This header carries
 * the AGENCY and PREMARKET layers only; agent + property live below.
 *
 * Agency identity is logo OR name, never both — showing the name as
 * well when a logo already exists just duplicated the same identity
 * twice in a two-second-wide header. The name is only ever a fallback
 * for the agencies who haven't uploaded a logo.
 */
export default function PropertyHeader({ agencyName, agencyLogoUrl, onOpenIpadMode }) {
  return (
    <header className="border-b border-slate-100 bg-white">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 sm:h-20 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {agencyLogoUrl ? (
            // Fixed height, auto width — not a forced square box — so a
            // wide wordmark-style agency logo renders at its own natural
            // proportions instead of being squeezed small to fit a tile.
            // max-w keeps an unusually wide logo from colliding with the
            // Premarket badge on the right.
            <Image
              src={agencyLogoUrl}
              alt={agencyName ? `${agencyName} logo` : 'Agency logo'}
              width={200}
              height={60}
              className="h-10 sm:h-12 w-auto max-w-[140px] sm:max-w-[180px] rounded-md object-contain flex-shrink-0"
              unoptimized
            />
          ) : agencyName ? (
            <span className="font-semibold text-slate-900 text-base sm:text-lg tracking-tight truncate">
              {agencyName}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          <PremarketBadge variant="header" />
          {onOpenIpadMode && (
            <button
              onClick={onOpenIpadMode}
              title="Open Home iPad Mode"
              aria-label="Open Home iPad Mode"
              className="text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0"
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
