'use client';

import { motion } from 'framer-motion';
import PriceOpinionSlider from '../PriceOpinionSlider';
import LikeButton from '../LikeButton';

/**
 * The visual centrepiece of the redesigned page — "Help the seller price
 * this property." Deliberately restrained: white card, charcoal type, and
 * the agency/Premarket accent colour used only on the price figure, the
 * slider fill/thumb, and the primary button — never as a big flood of
 * colour across the whole card.
 *
 * The explicit "Submit my price opinion" button and the automatic
 * confirm-on-release behaviour both open the exact same pre-existing
 * confirmation modal/save flow (see PropertyPageClient's
 * showConfirmOpinionModal + confirmPriceOpinion) — this component adds no
 * new submission logic, only a clearer, more deliberate call to action.
 *
 * `hasInteracted` controls whether a value has ever been deliberately
 * dragged for this visitor on this property (true immediately for a
 * returning visitor whose prior opinion was restored). Before that, no
 * dollar figure is shown and Submit stays disabled — the slider's
 * starting position is no longer anchored on the asking price, since an
 * untouched midpoint submission reads as a genuine opinion it never was.
 * The invitation copy ("Have a go — drag to find your number") exists
 * specifically so removing that default doesn't just read as a confusing
 * blank control.
 */
export default function PriceOpinionCard({
  propertyId,
  priceOpinion,
  minPrice,
  maxPrice,
  hasInteracted,
  isSliding,
  onChange,
  onSlideStart,
  onSlideEnd,
  onSubmitOpinion,
  onRegisterInterest,
  formatMoney,
  formatCompact,
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

      <div className="mb-5 min-h-[3.5rem] sm:min-h-[4rem] flex items-center justify-center">
        {hasInteracted ? (
          <motion.div
            key={isSliding ? 'dragging' : priceOpinion}
            initial={{ scale: 1.04 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.18 }}
            className="text-4xl sm:text-5xl font-semibold text-[var(--brand-primary,#c2410c)] tabular-nums"
          >
            {formatMoney(priceOpinion)}
          </motion.div>
        ) : (
          <p className="text-lg sm:text-xl font-semibold text-slate-400" style={{ fontFamily: 'var(--font-playfair, serif)' }}>
            Have a go — drag to find your number
          </p>
        )}
      </div>

      <div className="mb-2">
        <div className={!hasInteracted ? 'relative' : ''}>
          {!hasInteracted && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full animate-pulse-track pointer-events-none"
              style={{ background: 'linear-gradient(90deg, transparent, var(--brand-primary, #c2410c) 50%, transparent)', opacity: 0.18 }}
            />
          )}
          <PriceOpinionSlider
            min={minPrice}
            max={maxPrice}
            value={priceOpinion}
            onChange={onChange}
            onSlideStart={onSlideStart}
            onSlideEnd={onSlideEnd}
            className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer slider-thumb"
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-slate-400 font-medium">
          <span>{formatCompact(minPrice)}</span>
          <span>{formatCompact(maxPrice)}</span>
        </div>
      </div>

      <button
        onClick={onSubmitOpinion}
        disabled={!hasInteracted}
        className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold text-[15px] py-3.5 rounded-xl transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
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

      <style jsx>{`
        @keyframes pulseTrack {
          0%, 100% { opacity: 0.1; }
          50% { opacity: 0.3; }
        }
        .animate-pulse-track {
          animation: pulseTrack 2.2s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-pulse-track { animation: none; }
        }
      `}</style>
    </div>
  );
}
