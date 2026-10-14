'use client';

import LikeButton from '../LikeButton';

/**
 * Recap + considered-submission section, further down the page. The
 * actual slider now lives in HeroValuationBar (visible on first paint,
 * in the hero) and PersistentValuationBar (while scrolling) — both
 * bound to the exact same lifted `priceOpinion` state as this
 * section's read-only display, so there is only ever one valuation in
 * play, never a second slider to keep in sync.
 *
 * This section exists for buyers who want the fuller context — the
 * explicit question, the anonymity/not-an-offer note, formal interest
 * — before confirming, or who scroll straight down before ever
 * touching a slider. Its own "Submit my price opinion" button opens
 * the exact same confirmation flow as the two sliders' compact submit
 * buttons (see PropertyPageClient's showConfirmOpinionModal +
 * confirmPriceOpinion) — one submission flow, reached from three
 * places.
 */
export default function PriceOpinionCard({
  propertyId,
  priceOpinion,
  hasInteracted,
  onSubmitOpinion,
  onRegisterInterest,
  formatMoney,
  heading,
  subcopy,
  interestSubcopy,
}) {
  return (
    <div className="relative bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 text-center">
      {propertyId && (
        <div className="absolute top-5 right-5 sm:top-6 sm:right-6">
          <LikeButton propertyId={propertyId} size="sm" />
        </div>
      )}

      <h2
        className="text-slate-900 text-xl sm:text-2xl font-semibold px-8"
        style={{ fontFamily: 'var(--font-playfair, serif)' }}
      >
        {heading}
      </h2>
      <p className="text-slate-500 text-sm leading-relaxed mt-2 mb-6 sm:mb-8 max-w-md mx-auto">
        {subcopy}
      </p>

      <div className="mb-6 min-h-[3.5rem] sm:min-h-[4rem] flex items-center justify-center">
        {hasInteracted ? (
          <div
            className="text-4xl sm:text-5xl font-semibold text-[var(--brand-primary,#c2410c)] tabular-nums"
            style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)' }}
          >
            {formatMoney(priceOpinion)}
          </div>
        ) : (
          <p className="text-lg sm:text-xl font-semibold text-slate-400">
            Drag the valuation slider above to set your price
          </p>
        )}
      </div>

      <button
        onClick={onSubmitOpinion}
        disabled={!hasInteracted}
        className="w-full inline-flex items-center justify-center gap-2 bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold text-[15px] py-3.5 rounded-xl transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Submit my price opinion
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </button>
      <p className="mt-2.5 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Anonymous &middot; this is your opinion, not an offer
      </p>

      <button
        onClick={onRegisterInterest}
        className="mt-5 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors underline underline-offset-2"
      >
        Already know you&rsquo;re interested? Register formal interest instead
      </button>
      {interestSubcopy && (
        <p className="mt-2 text-center text-xs text-slate-400">
          {interestSubcopy}
        </p>
      )}
    </div>
  );
}
