'use client';

import { motion } from 'framer-motion';
import PriceOpinionSlider from '../PriceOpinionSlider';

/**
 * The inner content of PersistentValuationBar — the slider, its live
 * value, the selectable range, and the submit action. Kept separate
 * from PersistentValuationBar's own file so that component can focus
 * purely on fixed positioning / responsive chrome (full-width bar on
 * mobile, floating card on larger screens) without this content logic
 * getting lost in it.
 *
 * The min/max figures shown either side of the track are just the
 * slider's own selectable endpoints — not a formal price guide, and
 * never labelled or implied to be the vendor's expected range. The
 * midpoint is never marked or called out.
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
  formatCompact,
  labelClassName = 'text-slate-500',
}) {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 sm:gap-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className={`text-[11px] sm:text-xs font-semibold uppercase tracking-wide truncate ${labelClassName}`}>
              {hasInteracted ? 'Your valuation' : "What's this home worth to you?"}
            </span>
            {hasInteracted && (
              <motion.span
                key={isSliding ? 'dragging' : priceOpinion}
                initial={{ scale: 1.08 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.16 }}
                className="text-lg sm:text-xl font-semibold text-[var(--brand-primary,#c2410c)] tabular-nums flex-shrink-0"
                style={{ fontFamily: 'var(--font-inter, system-ui, sans-serif)' }}
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
            invitePulse={!hasInteracted}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer slider-thumb"
          />
          {typeof formatCompact === 'function' && (
            <div className="flex justify-between mt-1.5 text-[10px] sm:text-[11px] font-medium text-slate-400 tabular-nums">
              <span>{formatCompact(minPrice)}</span>
              <span>{formatCompact(maxPrice)}</span>
            </div>
          )}
        </div>
        <button
          onClick={onSubmit}
          disabled={!hasInteracted}
          aria-label="Submit my price opinion"
          className="flex-shrink-0 inline-flex items-center gap-1.5 h-11 pl-4 pr-4 sm:pr-5 rounded-full bg-[var(--brand-primary,#c2410c)] text-white shadow-lg disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-semibold">Submit</span>
        </button>
      </div>
    </div>
  );
}
