'use client';

import { motion } from 'framer-motion';
import PriceOpinionSlider from '../PriceOpinionSlider';

/**
 * The shared inner content of HeroValuationBar (embedded in the bottom
 * of the hero photo, visible on first paint) and PersistentValuationBar
 * (takes over the instant the hero scrolls away). Pulled into one file
 * so both surfaces are structurally guaranteed to look and behave
 * identically — "the same premium visual language" — rather than two
 * copies that could quietly drift apart.
 *
 * Both callers bind this to the exact same lifted `priceOpinion` state
 * in PropertyPageClient.js (same onChange/onSlideStart/onSlideEnd/
 * onSubmit), so there is only ever one valuation in play — dragging
 * either rendered instance updates the one shared value, and either
 * Submit button opens the exact same confirmation flow. Nothing here
 * writes to Firestore directly.
 */
export default function ValuationSliderRow({
  priceOpinion,
  hasInteracted,
  isSliding,
  minPrice,
  maxPrice,
  onChange,
  onSlideStart,
  onSlideEnd,
  onSubmit,
  formatMoney,
  labelClassName = 'text-slate-500',
  trackClassName = 'bg-slate-300/70',
}) {
  return (
    <div className="max-w-6xl mx-auto flex items-center gap-3 sm:gap-5">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          <span className={`text-[11px] sm:text-xs font-semibold uppercase tracking-wide ${labelClassName}`}>
            {hasInteracted ? 'Your opinion' : "What's it worth to you?"}
          </span>
          {hasInteracted && (
            <motion.span
              key={isSliding ? 'dragging' : priceOpinion}
              initial={{ scale: 1.08 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.16 }}
              className="text-lg sm:text-xl font-semibold text-[var(--brand-primary,#c2410c)] tabular-nums"
              style={{ fontFamily: 'var(--font-playfair, serif)' }}
            >
              {formatMoney(priceOpinion)}
            </motion.span>
          )}
        </div>
        <PriceOpinionSlider
          min={minPrice}
          max={maxPrice}
          value={priceOpinion}
          onChange={onChange}
          onSlideStart={onSlideStart}
          onSlideEnd={onSlideEnd}
          ariaLabel="Price opinion"
          className={`w-full h-1.5 rounded-full appearance-none cursor-pointer slider-thumb ${trackClassName}`}
        />
      </div>
      <button
        onClick={onSubmit}
        disabled={!hasInteracted}
        aria-label="Submit my price opinion"
        className="flex-shrink-0 w-11 h-11 rounded-full bg-[var(--brand-primary,#c2410c)] text-white flex items-center justify-center shadow-lg disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </button>
    </div>
  );
}
