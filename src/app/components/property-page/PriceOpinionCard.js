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
 */
export default function PriceOpinionCard({
  propertyId,
  priceOpinion,
  minPrice,
  maxPrice,
  onChange,
  onSlideStart,
  onSlideEnd,
  onSubmitOpinion,
  onRegisterInterest,
  formatMoney,
  formatCompact,
  heading,
  subcopy,
  interestHeading,
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

      <div className="mb-5">
        <motion.div
          key={priceOpinion}
          initial={{ scale: 1.04 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.18 }}
          className="text-4xl sm:text-5xl font-semibold text-[var(--brand-primary,#c2410c)] tabular-nums"
        >
          {formatMoney(priceOpinion)}
        </motion.div>
      </div>

      <div className="mb-2">
        <PriceOpinionSlider
          min={minPrice}
          max={maxPrice}
          value={priceOpinion}
          onChange={onChange}
          onSlideStart={onSlideStart}
          onSlideEnd={onSlideEnd}
          className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer slider-thumb"
        />
        <div className="flex justify-between mt-2 text-xs text-slate-400 font-medium">
          <span>{formatCompact(minPrice)}</span>
          <span>{formatCompact(maxPrice)}</span>
        </div>
      </div>

      <button
        onClick={onSubmitOpinion}
        className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold text-[15px] py-3.5 rounded-xl transition-opacity"
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
        Your response is anonymous
      </p>

      <div className="flex items-center gap-3 my-6">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Or</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      {interestHeading && (
        <p className="font-semibold text-slate-900 text-[15px] mb-3">
          {interestHeading}
        </p>
      )}
      <button
        onClick={onRegisterInterest}
        className="w-full py-3.5 rounded-xl border border-slate-300 text-slate-800 font-semibold text-[15px] hover:border-slate-400 transition-colors"
      >
        Register formal interest
      </button>
      {interestSubcopy && (
        <p className="mt-2.5 text-center text-xs text-slate-400">
          {interestSubcopy}
        </p>
      )}
    </div>
  );
}
