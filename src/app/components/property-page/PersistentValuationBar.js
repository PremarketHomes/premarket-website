'use client';

import { motion, AnimatePresence } from 'framer-motion';
import ValuationSliderRow from './ValuationSliderRow';

/**
 * Premarket's primary valuation control — fixed to the bottom of the
 * viewport from the moment the property loads, through every bit of
 * scrolling (photos, description, location). This is deliberately the
 * single interactive slider on the page: the hero is purely
 * photographic now (see PropertyHero.js), and the read-only recap
 * further down the page (PriceOpinionCard.js) shows the same value and
 * offers its own Submit button, but never a second slider to drag —
 * so there is only ever one value and one submission flow, reached
 * from either place.
 *
 * Only ever hidden for two reasons — never for scroll position or
 * section visibility, see utils/persistentSliderVisibility.js:
 *   - a modal/overlay is open (can't sit under the keyboard or behind it)
 *   - an opinion has already been submitted this session
 *
 * Full-width bar flush with the bottom edge on mobile; a contained,
 * centred, rounded floating card above the bottom edge from `sm:` up
 * — "beautifully proportioned," not a full-width banner on desktop.
 * The outer element only ever carries position/opacity (via
 * framer-motion's own transform), so centering the inner card uses
 * flexbox rather than a translate-based centering trick, which would
 * otherwise fight framer-motion for the `transform` property.
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
          className="fixed inset-x-0 bottom-0 z-40 sm:flex sm:justify-center sm:px-4 sm:pb-6"
        >
          <div
            className="bg-white border-t border-slate-200 shadow-[0_-4px_24px_rgba(0,0,0,0.1)] px-5 sm:px-6 sm:w-full sm:max-w-xl sm:rounded-2xl sm:border sm:shadow-2xl"
            style={{ paddingTop: '0.75rem', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <ValuationSliderRow {...rowProps} labelClassName="text-slate-400" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
