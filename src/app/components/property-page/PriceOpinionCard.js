'use client';

import { motion } from 'framer-motion';
import LikeButton from '../LikeButton';
import PriceOpinionSlider from '../PriceOpinionSlider';

/**
 * The main valuation control, further down the page — a second, fully
 * interactive slider bound to the exact same lifted `priceOpinion`
 * (plus `hasInteracted`/`isSliding`/`minPrice`/`maxPrice`) state as the
 * fixed PersistentValuationBar. Moving either slider moves both,
 * instantly, because both read from and write to the one shared state
 * in PropertyPageClient — there is no second value to keep in sync.
 *
 * Both this card's "Submit my price opinion" button and the floating
 * bar's compact Submit button call the exact same
 * openConfirmOpinion → confirmPriceOpinion → savePriceOpinion chain,
 * which itself updates the existing `offers` doc (via `savedOfferId`)
 * rather than creating a new one on a second submission — so there is
 * no route to a duplicate regardless of which control was used first.
 *
 * `hasInteracted` controls whether a value has ever been deliberately
 * dragged for this visitor on this property (true immediately for a
 * returning visitor whose prior opinion was restored). Before that, no
 * dollar figure is shown and Submit stays disabled on both sliders —
 * an untouched midpoint submission would read as a genuine opinion it
 * never was. The invitation copy below exists so removing that default
 * doesn't just read as a confusing blank control.
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
            style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)' }}
          >
            {formatMoney(priceOpinion)}
          </motion.div>
        ) : (
          <p
            className="text-lg sm:text-xl font-semibold text-slate-400"
            style={{ fontFamily: 'var(--font-playfair, serif)' }}
          >
            Have a go &mdash; drag to find your number
          </p>
        )}
      </div>

      <div className="mb-2">
        <PriceOpinionSlider
          min={minPrice}
          max={maxPrice}
          value={priceOpinion}
          onChange={onChange}
          onSlideStart={onSlideStart}
          onSlideEnd={onSlideEnd}
          ariaLabel="Price opinion"
          invitePulse={!hasInteracted}
          className="w-full h-2 rounded-full appearance-none cursor-pointer slider-thumb"
        />
        {typeof formatCompact === 'function' && (
          <div className="flex justify-between mt-2 text-xs text-slate-400 font-medium tabular-nums">
            <span>{formatCompact(minPrice)}</span>
            <span>{formatCompact(maxPrice)}</span>
          </div>
        )}
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
    </div>
  );
}
