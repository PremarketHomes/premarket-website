'use client';

import { motion, AnimatePresence } from 'framer-motion';
import ValuationSliderRow from './ValuationSliderRow';

/**
 * The second half of the same valuation state as HeroValuationBar —
 * takes over the instant the hero (and its embedded slider) scrolls
 * out of view, so the interaction is always reachable without ever
 * having to scroll back to it. A real, directly-adjustable slider, not
 * a prompt that redirects elsewhere — dragging it updates the exact
 * same `priceOpinion` state the hero bar does, and its Submit button
 * opens the exact same confirmation flow (see ValuationSliderRow.js).
 *
 * Never visible at the same time as the hero bar or the lower recap
 * section — see utils/valuationBarVisibility.js, computed by the
 * caller. Unlike the hero bar, this floats over arbitrary page content
 * (the gallery, description, map), not a single photo, so it's a
 * solid surface rather than frosted glass — the slider itself still
 * uses the identical thumb styling, so it reads as the same control.
 */
export default function PersistentValuationBar({ visible, ...rowProps }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="fixed inset-x-0 bottom-0 z-40 bg-white border-t border-slate-200 shadow-[0_-4px_24px_rgba(0,0,0,0.1)] px-5 sm:px-8"
          style={{ paddingTop: '0.75rem', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <ValuationSliderRow {...rowProps} labelClassName="text-slate-400" trackClassName="bg-slate-200" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
