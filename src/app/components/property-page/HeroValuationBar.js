'use client';

import ValuationSliderRow from './ValuationSliderRow';

/**
 * The primary valuation control — embedded directly into the bottom of
 * the hero photo (see PropertyHero.js) so a buyer can see the property
 * AND start giving their opinion in the very first screen, with no
 * scrolling. This is "the hero slider"; PersistentValuationBar is the
 * other interface to the same valuation state, for once this scrolls
 * out of view. See ValuationSliderRow.js for why both share one
 * implementation.
 *
 * Frosted/translucent rather than a solid card, so the photo stays
 * visible and prominent underneath — this is a control floating over
 * the image, not a panel replacing it. Edge-to-edge (no side inset),
 * deliberately distinct from the inset title/stats text above it, so
 * it reads as its own functional surface, not more overlay copy.
 */
export default function HeroValuationBar(props) {
  return (
    <div className="w-full bg-white/90 backdrop-blur-md border-t border-white/40 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] px-5 sm:px-8 py-3 sm:py-4">
      <ValuationSliderRow {...props} labelClassName="text-slate-600" trackClassName="bg-slate-300/70" />
    </div>
  );
}
